import base64
import hashlib
import hmac
import json
import os
import re
import time
import secrets
import html as html_lib
import unicodedata
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import urljoin, parse_qs, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, PlainTextResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel

from hdrezka import HDRezkaClient
from hdrezka.post.urls import urls_from_ajax_response


APP_VERSION = "5.1.0"
AUTHOR = "DENYS"
STARTED_AT = time.time()

# ВАЖНО:
# standby-rezka.tv в 2026 больше нельзя использовать как "поисковое зеркало":
# сейчас это страница входа. Контент и поиск берём с рабочего контентного зеркала.
CONTENT_HOST = "https://rezka-ua.tv/"

# Логин пробуем на контентном зеркале первым.
# Если его IP-защита не отдаст cookie серверу Render,
# берём cookie с login-портала и используем их на CONTENT_HOST.
AUTH_HOSTS = (
    "https://rezka-ua.tv/",
    "https://rezka.si/",
    "https://standby-rezka.tv/",
)

SESSION_SECRET = os.getenv(
    "SESSION_SECRET",
    "hdrezka-lampa-change-this-secret-2026"
).encode("utf-8")


# Lightweight in-memory cache. Render may restart the process at any time,
# so this is only a speed optimization, never persistent state.
SEARCH_CACHE_TTL = 30 * 60
SEARCH_CACHE_MAX = 200
_SEARCH_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}


# Session-scoped short caches for premium UX.
# Keys include a hash of the signed user session, so accounts never share
# translator/stream data with each other.
_API_CACHE: dict[str, tuple[float, Any]] = {}
API_CACHE_MAX = 400


PAIR_TTL = 10 * 60
_PAIRINGS: dict[str, dict[str, Any]] = {}
_PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
LAMPA_DIR = os.getenv("LAMPA_DIR", "/app/lampa")


def _pair_cleanup() -> None:
    now = time.time()

    expired = [
        code
        for code, item
        in _PAIRINGS.items()
        if item.get("expires", 0) <= now
    ]

    for code in expired:
        _PAIRINGS.pop(code, None)


def _pair_code() -> str:
    _pair_cleanup()

    for _ in range(30):
        code = "".join(
            secrets.choice(_PAIR_ALPHABET)
            for _ in range(6)
        )

        if code not in _PAIRINGS:
            return code

    raise RuntimeError("Не удалось создать код подключения")


def _api_cache_get(key: str) -> Any | None:
    item = _API_CACHE.get(key)
    if not item:
        return None

    expires, value = item
    if time.time() >= expires:
        _API_CACHE.pop(key, None)
        return None

    return value


def _api_cache_set(key: str, value: Any, ttl: int) -> None:
    if len(_API_CACHE) >= API_CACHE_MAX:
        now = time.time()
        for old_key, (expires, _) in list(_API_CACHE.items()):
            if expires <= now:
                _API_CACHE.pop(old_key, None)

        while len(_API_CACHE) >= API_CACHE_MAX:
            try:
                _API_CACHE.pop(next(iter(_API_CACHE)))
            except StopIteration:
                break

    _API_CACHE[key] = (time.time() + ttl, value)


def _session_cache_id(session: str) -> str:
    return hashlib.sha1(session.encode('utf-8')).hexdigest()[:16]


def _cache_get(key: str) -> list[dict[str, Any]] | None:
    item = _SEARCH_CACHE.get(key)

    if not item:
        return None

    expires, value = item

    if expires <= time.time():
        _SEARCH_CACHE.pop(key, None)
        return None

    # callers add score to rows, so return copies
    return [dict(row) for row in value]


def _cache_set(key: str, value: list[dict[str, Any]]) -> None:
    if len(_SEARCH_CACHE) >= SEARCH_CACHE_MAX:
        # Drop expired entries first, then oldest arbitrary keys.
        now = time.time()
        expired = [
            k for k, (expires, _) in _SEARCH_CACHE.items()
            if expires <= now
        ]

        for k in expired:
            _SEARCH_CACHE.pop(k, None)

        while len(_SEARCH_CACHE) >= SEARCH_CACHE_MAX:
            try:
                _SEARCH_CACHE.pop(next(iter(_SEARCH_CACHE)))
            except StopIteration:
                break

    _SEARCH_CACHE[key] = (
        time.time() + SEARCH_CACHE_TTL,
        [dict(row) for row in value],
    )


app = FastAPI(
    title="HDREZKA Premium for Lampa",
    version=APP_VERSION
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    login: str
    password: str


class SessionRequest(BaseModel):
    session: str


class ResolveRequest(BaseModel):
    session: str
    title: str = ""
    original_title: str = ""
    year: int | None = None


class DetailsRequest(BaseModel):
    session: str
    url: str


class EpisodesRequest(BaseModel):
    session: str
    url: str
    translator_id: int


class StreamRequest(BaseModel):
    session: str
    url: str
    translator_id: int
    season: int | None = None
    episode: int | None = None


class PairStatusRequest(BaseModel):
    code: str


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(value: str) -> bytes:
    value += "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value.encode("ascii"))


def make_session(host: str, cookies: dict[str, str]) -> str:
    payload = {
        "host": host.rstrip("/") + "/",
        "cookies": cookies,
    }

    raw = json.dumps(
        payload,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")

    body = _b64e(raw)

    sig = hmac.new(
        SESSION_SECRET,
        body.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()

    return body + "." + sig


def read_session(token: str) -> tuple[str, dict[str, str]]:
    try:
        body, sig = token.rsplit(".", 1)
    except ValueError:
        raise HTTPException(401, "Некорректная сессия")

    expected = hmac.new(
        SESSION_SECRET,
        body.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(sig, expected):
        raise HTTPException(401, "Повреждённая сессия")

    try:
        payload = json.loads(_b64d(body))
    except Exception:
        raise HTTPException(401, "Не удалось прочитать сессию")

    host = str(payload.get("host") or "")
    cookies = payload.get("cookies") or {}

    if not host.startswith("https://"):
        raise HTTPException(401, "Некорректный host в сессии")

    if not isinstance(cookies, dict):
        raise HTTPException(401, "Некорректные cookies")

    return (
        host.rstrip("/") + "/",
        {
            str(k): str(v)
            for k, v in cookies.items()
            if k and v
        },
    )


def client_from_session(token: str) -> HDRezkaClient:
    host, cookies = read_session(token)

    return HDRezkaClient(
        host=host,
        cookies=cookies,
        impersonate=True,
    )


def cookie_dict(client: HDRezkaClient) -> dict[str, str]:
    out: dict[str, str] = {}

    for cookie in client.cookies.jar:
        if cookie.name and cookie.value:
            out[cookie.name] = cookie.value

    return out


def has_auth_cookies(cookies: dict[str, str]) -> bool:
    return bool(
        cookies.get("dle_user_id")
        and cookies.get("dle_password")
    )


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = value.casefold()
    value = re.sub(r"[\W_]+", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def similarity(a: str, b: str) -> float:
    a = normalized(a)
    b = normalized(b)

    if not a or not b:
        return 0.0

    if a == b:
        return 1.0

    if a in b or b in a:
        return 0.92

    return SequenceMatcher(None, a, b).ratio()


def item_score(
    name: str,
    item_year: int | None,
    title: str,
    original_title: str,
    wanted_year: int | None,
) -> float:
    title_score = max(
        similarity(name, title),
        similarity(name, original_title) if original_title else 0.0,
    )

    year_bonus = 0.0

    if wanted_year and item_year:
        diff = abs(int(wanted_year) - int(item_year))

        if diff == 0:
            year_bonus = 0.18
        elif diff == 1:
            year_bonus = 0.06
        elif diff >= 3:
            year_bonus = -0.20

    return title_score + year_bonus


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _year(text: str) -> int | None:
    match = re.search(r"\b((?:19|20)\d{2})\b", text or "")
    return int(match.group(1)) if match else None


def _absolute(
    client: HDRezkaClient,
    href: str,
) -> str:
    return urljoin(
        client.host,
        href,
    )


def _post_url(
    client: HDRezkaClient,
    href: str,
) -> str:
    """
    Search responses can contain an absolute URL from another Rezka mirror.
    We keep its path/query but force the authenticated content host.
    """
    joined = urljoin(
        client.host,
        href or "",
    )

    target = urlsplit(
        joined
    )

    base = urlsplit(
        client.host
    )

    return urlunsplit(
        (
            base.scheme,
            base.netloc,
            target.path or "/",
            target.query,
            target.fragment,
        )
    )


def parse_live_search(
    html: str,
    client: HDRezkaClient,
) -> list[dict[str, Any]]:
    """
    Текущая структура fast-search HDRezka.
    Реальные рабочие реализации парсят .b-search__section_list li.
    Дополнительно поддерживаем старое имя .b-search__live_section.
    """
    soup = BeautifulSoup(html or "", "html.parser")

    nodes = soup.select(
        ".b-search__section_list li, "
        ".b-search__live_section li"
    )

    # Если зеркало немного поменяло обёртку —
    # используем безопасный fallback, но только внутри поискового блока.
    if not nodes:
        section = (
            soup.select_one(".b-search__section_list")
            or soup.select_one(".b-search__live_section")
        )
        if section:
            nodes = section.find_all("li")

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    for node in nodes:
        anchor = node.find("a", href=True)
        if not anchor:
            continue

        href = (anchor.get("href") or "").strip()
        if not href:
            continue

        url = _post_url(client, href)

        if url in seen:
            continue

        enty = anchor.find("span", class_="enty")
        name = _clean(
            enty.get_text(" ", strip=True)
            if enty
            else anchor.get_text(" ", strip=True)
        )

        if not name:
            continue

        text = _clean(anchor.get_text(" ", strip=True))

        rating_node = anchor.find("span", class_="rating")
        if rating_node:
            rating_node.extract()

        rows.append({
            "url": url,
            "name": name,
            "year": _year(text),
            "country": "",
            "genre": "",
            "poster": "",
        })

        seen.add(url)

    return rows


def parse_full_search(
    html: str,
    client: HDRezkaClient,
) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html or "", "html.parser")
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    for item in soup.select(".b-content__inline_item"):
        link_block = item.select_one(".b-content__inline_item-link")
        if not link_block:
            continue

        anchor = link_block.find("a", href=True)
        if not anchor:
            continue

        href = (anchor.get("href") or "").strip()
        if not href:
            continue

        url = _post_url(client, href)

        if url in seen:
            continue

        name = _clean(anchor.get_text(" ", strip=True))
        if not name:
            continue

        info_node = link_block.find("div")
        info_text = _clean(
            info_node.get_text(" ", strip=True)
            if info_node
            else ""
        )

        parts = [
            x.strip()
            for x in info_text.split(",")
            if x.strip()
        ]

        country = parts[1] if len(parts) > 1 else ""
        genre = ", ".join(parts[2:]) if len(parts) > 2 else ""

        cover = item.select_one(
            ".b-content__inline_item-cover img"
        )

        poster = (
            (cover.get("src") or "").strip()
            if cover
            else ""
        )

        rows.append({
            "url": url,
            "name": name,
            "year": _year(info_text),
            "country": country,
            "genre": genre,
            "poster": _absolute(client, poster) if poster else "",
        })

        seen.add(url)

    return rows


async def search_one(
    client: HDRezkaClient,
    query: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Не используем client.search() из библиотеки:
    её auto-host в текущем 2026 состоянии ведёт через standby login-page,
    а ошибки парсера раньше ещё и проглатывались.

    Запросы здесь повторяют текущие рабочие реализации HDRezka.
    """

    debug: dict[str, Any] = {
        "host": client.host,
        "query": query,
    }

    # 1) Fast search — текущая реализация SuperZombi/HdRezkaApi:
    # POST /engine/ajax/search.php, data q=<query>
    live_url = client.host_join("engine/ajax/search.php")

    try:
        live = await client.get_response(
            "POST",
            live_url,
            data={"q": query},
            headers={
                "Referer": client.host,
                "Origin": client.host.rstrip("/"),
                "X-Requested-With": "XMLHttpRequest",
            },
        )

        debug["live_status"] = live.status_code
        debug["live_url"] = str(live.url)
        debug["live_length"] = len(live.text or "")

        if live.status_code < 400:
            rows = parse_live_search(
                live.text,
                client,
            )

            debug["live_results"] = len(rows)

            if rows:
                return rows, debug
    except Exception as exc:
        debug["live_error"] = (
            f"{type(exc).__name__}: {exc}"
        )

    # 2) Обычная страница поиска — fallback.
    full_url = client.host_join("search/")

    try:
        full = await client.get_response(
            "GET",
            full_url,
            params={
                "do": "search",
                "subaction": "search",
                "q": query,
            },
            headers={
                "Referer": client.host,
            },
        )

        debug["full_status"] = full.status_code
        debug["full_url"] = str(full.url)
        debug["full_length"] = len(full.text or "")

        if full.status_code < 400:
            rows = parse_full_search(
                full.text,
                client,
            )

            debug["full_results"] = len(rows)

            if rows:
                return rows, debug
    except Exception as exc:
        debug["full_error"] = (
            f"{type(exc).__name__}: {exc}"
        )

    return [], debug


async def search_candidates(
    client: HDRezkaClient,
    title: str,
    original_title: str,
    year: int | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    queries: list[str] = []

    for query in (title, original_title):
        query = (query or "").strip()

        if query and query not in queries:
            queries.append(query)

    found: dict[str, dict[str, Any]] = {}
    diagnostics: list[dict[str, Any]] = []

    for query in queries:
        cache_key = (
            client.host.rstrip("/")
            + "|"
            + normalized(query)
        )

        cached = _cache_get(cache_key)

        if cached is not None:
            rows = cached
            debug = {
                "host": client.host,
                "query": query,
                "cache": "hit",
                "cached_results": len(rows),
            }
        else:
            rows, debug = await search_one(
                client,
                query,
            )

            debug["cache"] = "miss"

            if rows:
                _cache_set(
                    cache_key,
                    rows,
                )

        diagnostics.append(debug)

        for row in rows:
            row["score"] = item_score(
                row["name"],
                row.get("year"),
                title,
                original_title,
                year,
            )

            old = found.get(row["url"])

            if (
                not old
                or row["score"] > old["score"]
            ):
                found[row["url"]] = row

    rows = sorted(
        found.values(),
        key=lambda x: x["score"],
        reverse=True,
    )

    return rows[:12], diagnostics


async def login_against(
    auth_host: str,
    login: str,
    password: str,
) -> dict[str, str]:
    """
    Логинимся именно на указанном host.
    redirect_url=auth_host не даёт библиотеке снова уйти
    на устаревший standby auto-discovery.
    """
    async with HDRezkaClient(
        host=auth_host,
        redirect_url=auth_host,
        impersonate=True,
    ) as client:
        await client.login(
            login,
            password,
        )

        return cookie_dict(client)


async def verify_content_host(
    cookies: dict[str, str],
) -> dict[str, Any]:
    async with HDRezkaClient(
        host=CONTENT_HOST,
        cookies=cookies,
        impersonate=True,
    ) as client:
        response = await client.get_response(
            "GET",
            client.host,
        )

        html = response.text or ""

        return {
            "status": response.status_code,
            "url": str(response.url),
            "has_catalog": (
                "b-content__inline_item" in html
                or "b-content__inline_items" in html
                or "b-topnav" in html
            ),
            "length": len(html),
        }


async def login_and_build_session(
    login: str,
    password: str,
) -> tuple[str, dict[str, Any]]:
    attempts: list[dict[str, Any]] = []

    for auth_host in AUTH_HOSTS:
        try:
            cookies = await login_against(
                auth_host,
                login,
                password,
            )

            auth_ok = has_auth_cookies(
                cookies
            )

            verify = await verify_content_host(
                cookies
            )

            attempts.append({
                "auth_host": auth_host,
                "auth_cookie": auth_ok,
                "content_verify": verify,
            })

            if (
                auth_ok
                and verify["status"] < 400
                and verify["length"] > 500
            ):
                return (
                    make_session(
                        CONTENT_HOST,
                        cookies,
                    ),
                    {
                        "auth_host": auth_host,
                        "content_host": CONTENT_HOST,
                        "verify": verify,
                        "attempts": attempts,
                    },
                )

        except Exception as exc:
            attempts.append({
                "auth_host": auth_host,
                "error": (
                    f"{type(exc).__name__}: {exc}"
                ),
            })

    raise HTTPException(
        502,
        "Не удалось получить рабочую сессию HDRezka. "
        + " | ".join(
            (
                item.get("auth_host", "?")
                + ": "
                + (
                    item.get("error")
                    or (
                        "auth_cookie="
                        + str(item.get("auth_cookie"))
                        + ", content_status="
                        + str(
                            item.get(
                                "content_verify",
                                {},
                            ).get("status")
                        )
                    )
                )
            )
            for item in attempts
        ),
    )



def _safe_int(
    value: Any,
) -> int | None:
    try:
        if value is None:
            return None

        text = str(
            value
        ).strip()

        if not text:
            return None

        return int(
            text
        )
    except Exception:
        return None


def _page_title(
    soup: BeautifulSoup,
) -> str:
    node = soup.select_one(
        ".b-post__title"
    )

    if node:
        title = _clean(
            node.get_text(
                " ",
                strip=True,
            )
        )

        if title:
            return title

    meta = soup.find(
        "meta",
        property="og:title",
    )

    if meta:
        title = _clean(
            str(
                meta.get(
                    "content",
                    ""
                )
            )
        )

        if title:
            return title

    title_tag = soup.find(
        "title"
    )

    if title_tag:
        return _clean(
            title_tag.get_text(
                " ",
                strip=True,
            )
        )

    return ""


def parse_post_meta(
    html: str,
    url: str,
) -> dict[str, Any]:
    """
    Defensive parser based on the same core markers current Online Mod
    uses for HDRezka:
      .initCDNSeriesEvents(post, translator, season, episode, ...)
      .initCDNMoviesEvents(post, translator, ...)
      #translators-list .b-translator__item[data-translator_id]
    """
    raw = (
        html or ""
    ).replace(
        "\r",
        " ",
    ).replace(
        "\n",
        " ",
    )

    soup = BeautifulSoup(
        html or "",
        "html.parser",
    )

    series_match = re.search(
        r"\.initCDNSeriesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,",
        raw,
    )

    movie_match = re.search(
        r"\.initCDNMoviesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,",
        raw,
    )

    post_id = None
    default_voice = None
    is_series = False
    default_season = None
    default_episode = None

    if series_match:
        is_series = True
        post_id = _safe_int(
            series_match.group(1)
        )
        default_voice = _safe_int(
            series_match.group(2)
        )
        default_season = _safe_int(
            series_match.group(3)
        )
        default_episode = _safe_int(
            series_match.group(4)
        )

    elif movie_match:
        post_id = _safe_int(
            movie_match.group(1)
        )
        default_voice = _safe_int(
            movie_match.group(2)
        )

    post_id_node = soup.find(
        id="post_id"
    )

    if (
        post_id is None
        and post_id_node
    ):
        post_id = _safe_int(
            post_id_node.get(
                "value"
            )
        )

    og_type = ""
    og_node = soup.find(
        "meta",
        property="og:type",
    )

    if og_node:
        og_type = str(
            og_node.get(
                "content",
                ""
            )
            or ""
        ).casefold()

    if (
        not is_series
        and (
            "tv_series"
            in og_type
            or "tv.series"
            in og_type
            or soup.select_one(
                ".b-simple_season__item"
            )
        )
    ):
        is_series = True

    voices: list[dict[str, Any]] = []
    seen_voice: set[int] = set()

    for node in soup.select(
        "#translators-list "
        ".b-translator__item"
        "[data-translator_id]"
    ):
        translator_id = _safe_int(
            node.get(
                "data-translator_id"
            )
        )

        if (
            translator_id is None
            or translator_id
            in seen_voice
        ):
            continue

        name = _clean(
            str(
                node.get(
                    "title",
                    ""
                )
                or node.get_text(
                    " ",
                    strip=True,
                )
                or ""
            )
        )

        lang = ""

        img = node.find(
            "img"
        )

        if img:
            lang = _clean(
                str(
                    img.get(
                        "title",
                        ""
                    )
                    or img.get(
                        "alt",
                        ""
                    )
                    or ""
                )
            )

        if (
            lang
            and lang.casefold()
            not in name.casefold()
        ):
            name = (
                (
                    name
                    or "Оригинал"
                )
                + " ("
                + lang
                + ")"
            )

        voices.append({
            "id":
                translator_id,

            "name":
                (
                    name
                    or "Оригинал"
                ),
        })

        seen_voice.add(
            translator_id
        )

    if (
        default_voice is not None
        and default_voice
        not in seen_voice
    ):
        voices.insert(
            0,
            {
                "id":
                    default_voice,

                "name":
                    "Оригинал",
            },
        )

        seen_voice.add(
            default_voice
        )

    if (
        default_voice is None
        and voices
    ):
        default_voice = voices[0][
            "id"
        ]

    return {
        "url":
            url,

        "name":
            (
                _page_title(
                    soup
                )
                or "HDRezka"
            ),

        "id":
            post_id,

        "is_series":
            bool(
                is_series
            ),

        "voices":
            voices,

        "default_voice_id":
            default_voice,

        "default_season":
            default_season,

        "default_episode":
            default_episode,

        "markers": {
            "series_init":
                bool(
                    series_match
                ),

            "movie_init":
                bool(
                    movie_match
                ),

            "post_id":
                bool(
                    post_id_node
                ),

            "og_type":
                og_type,
        },
    }


async def fetch_post_meta(
    client: HDRezkaClient,
    url: str,
) -> dict[str, Any]:
    """
    Validate the page before parsing. If Rezka returns a login/mirror/
    anti-bot page, return a useful diagnostic instead of None['content'].
    """
    normalized_url = _post_url(
        client,
        url,
    )

    response = await client.get_response(
        "GET",
        normalized_url,
    )

    html = response.text or ""

    meta = parse_post_meta(
        html,
        normalized_url,
    )

    markers = meta.get(
        "markers",
        {},
    )

    if (
        response.status_code >= 400
        or meta.get("id")
        is None
        or not (
            markers.get(
                "series_init"
            )
            or markers.get(
                "movie_init"
            )
            or markers.get(
                "post_id"
            )
        )
    ):
        soup = BeautifulSoup(
            html,
            "html.parser",
        )

        raise HTTPException(
            502,
            (
                "HDRezka вернула не страницу фильма. "
                "status="
                + str(
                    response.status_code
                )
                + ", requested="
                + normalized_url
                + ", final="
                + str(
                    response.url
                )
                + ", title="
                + repr(
                    _page_title(
                        soup
                    )
                )
                + ", length="
                + str(
                    len(html)
                )
                + ", markers="
                + json.dumps(
                    markers,
                    ensure_ascii=False,
                )
            ),
        )

    return meta


def parse_episodes_payload(
    data: dict[str, Any],
) -> tuple[list[dict], list[dict]]:
    seasons: dict[int, dict] = {}
    episodes: list[dict] = []

    seasons_html = str(
        data.get("seasons") or ""
    )

    episodes_html = str(
        data.get("episodes") or ""
    )

    if seasons_html:
        soup = BeautifulSoup(
            "<ul>" + seasons_html + "</ul>",
            "html.parser",
        )

        for node in soup.select(
            ".b-simple_season__item"
        ):
            raw_id = node.get("data-tab_id")

            try:
                season_id = int(raw_id)
            except (TypeError, ValueError):
                continue

            seasons[season_id] = {
                "id": season_id,
                "name": (
                    node.get_text(
                        " ",
                        strip=True,
                    )
                    or f"Сезон {season_id}"
                ),
            }

    if episodes_html:
        soup = BeautifulSoup(
            "<div>" + episodes_html + "</div>",
            "html.parser",
        )

        for node in soup.select(
            ".b-simple_episode__item"
        ):
            try:
                season_id = int(
                    node.get(
                        "data-season_id"
                    )
                )

                episode_id = int(
                    node.get(
                        "data-episode_id"
                    )
                )

            except (
                TypeError,
                ValueError,
            ):
                continue

            if season_id not in seasons:
                seasons[season_id] = {
                    "id": season_id,
                    "name": (
                        f"Сезон {season_id}"
                    ),
                }

            episodes.append({
                "season_id": season_id,
                "episode_id": episode_id,
                "name": (
                    node.get_text(
                        " ",
                        strip=True,
                    )
                    or f"Серия {episode_id}"
                ),
            })

    season_list = sorted(
        seasons.values(),
        key=lambda x: x["id"],
    )

    episodes.sort(
        key=lambda x: (
            x["season_id"],
            x["episode_id"],
        )
    )

    return season_list, episodes


async def build_details(
    client: HDRezkaClient,
    url: str,
) -> dict[str, Any]:
    meta = await fetch_post_meta(
        client,
        url,
    )

    seasons: list[dict] = []
    episodes: list[dict] = []

    default_voice = meta.get(
        "default_voice_id"
    )

    if (
        meta.get(
            "is_series"
        )
        and default_voice
        is not None
    ):
        payload = (
            await client.ajax.get_episodes(
                meta["id"],
                default_voice,
            )
        )

        seasons, episodes = (
            parse_episodes_payload(
                payload
            )
        )

    return {
        "url":
            meta["url"],

        "name":
            meta["name"],

        "id":
            int(
                meta["id"]
            ),

        "is_series":
            bool(
                meta["is_series"]
            ),

        "voices":
            meta["voices"],

        "default_voice_id":
            default_voice,

        "seasons":
            seasons,

        "episodes":
            episodes,
    }


def streams_to_json(
    streams,
) -> dict[str, Any]:
    quality_rows: list[
        tuple[int, str, str]
    ] = []

    for (
        quality,
        urls,
    ) in streams.video.raw_data.items():
        if not urls:
            continue

        label = str(quality)
        url = str(urls[0])

        try:
            numeric = int(quality)
        except Exception:
            numeric = 0

        quality_rows.append(
            (
                numeric,
                label,
                url,
            )
        )

    quality_rows.sort(
        key=lambda row: row[0]
    )

    if not quality_rows:
        raise HTTPException(
            502,
            "HDRezka не вернула видеопоток",
        )

    quality = {
        label: url
        for _, label, url
        in quality_rows
    }

    subtitles = []

    for sub in streams.subtitles.subtitles:
        if not sub.url:
            continue

        subtitles.append({
            "label": (
                sub.name or sub.code
            ),
            "url": sub.url,
        })

    return {
        "url": quality_rows[-1][2],
        "quality": quality,
        "subtitles": subtitles,
    }


@app.exception_handler(Exception)
async def unhandled_exception(
    request: Request,
    exc: Exception,
):
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "error": (
                f"{type(exc).__name__}: "
                f"{exc}"
            ),
            "path": request.url.path,
            "version": APP_VERSION,
        },
    )



async def _rpc_payload(
    request: Request,
) -> dict[str, str]:
    raw = (
        await request.body()
    ).decode(
        "utf-8",
        errors="replace",
    )

    parsed = parse_qs(
        raw,
        keep_blank_values=True,
    )

    return {
        str(key):
            str(values[-1])
            if values
            else ""
        for key, values
        in parsed.items()
    }


def _rpc_int(
    value: str | None,
) -> int | None:
    if (
        value is None
        or str(value).strip() == ""
    ):
        return None

    try:
        return int(
            str(value).strip()
        )
    except Exception:
        return None


@app.post("/api/pair/start")
async def api_pair_start(
    request: Request,
):
    _pair_cleanup()

    code = _pair_code()
    expires = time.time() + PAIR_TTL

    _PAIRINGS[code] = {
        "created": time.time(),
        "expires": expires,
        "status": "pending",
        "session": "",
        "login": "",
    }

    base = str(
        request.base_url
    ).rstrip("/")

    return {
        "ok": True,
        "code": code,
        "expires_in": PAIR_TTL,
        "short_url": base + "/connect",
        "connect_url": (
            base
            + "/connect?code="
            + code
        ),
    }


@app.post("/api/pair/status")
async def api_pair_status(
    data: PairStatusRequest,
):
    _pair_cleanup()

    code = (
        data.code
        or ""
    ).strip().upper()

    item = _PAIRINGS.get(
        code
    )

    if not item:
        return {
            "ok": True,
            "status": "expired",
        }

    if (
        item.get("expires", 0)
        <= time.time()
    ):
        _PAIRINGS.pop(
            code,
            None,
        )

        return {
            "ok": True,
            "status": "expired",
        }

    if (
        item.get("status")
        == "connected"
        and item.get("session")
    ):
        return {
            "ok": True,
            "status": "connected",
            "session": item["session"],
            "login": item.get("login", ""),
        }

    return {
        "ok": True,
        "status": "pending",
        "expires_in": max(
            0,
            int(
                item["expires"]
                - time.time()
            ),
        ),
    }


def _connect_page(
    code: str = "",
    message: str = "",
    success: bool = False,
) -> str:
    code = html_lib.escape(
        code or ""
    )

    message = html_lib.escape(
        message or ""
    )

    status = ""

    if message:
        status = (
            '<div class="status '
            + (
                "ok"
                if success
                else "bad"
            )
            + '">'
            + message
            + "</div>"
        )

    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HDREZKA Premium • DENYS</title>
<style>
*{{box-sizing:border-box}}
body{{margin:0;background:#101114;color:#fff;font-family:Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}}
.card{{width:min(520px,100%);background:#1a1c21;border:1px solid #323640;border-radius:20px;padding:28px;box-shadow:0 20px 70px rgba(0,0,0,.35)}}
.brand{{font-size:13px;opacity:.55;letter-spacing:.12em;text-transform:uppercase;margin-bottom:9px}}
h1{{margin:0 0 8px;font-size:28px}}
p{{opacity:.72;line-height:1.45;margin:0 0 22px}}
label{{display:block;font-size:13px;opacity:.7;margin:14px 0 7px}}
input{{width:100%;padding:14px 15px;border-radius:11px;border:1px solid #3a3f49;background:#101216;color:#fff;font-size:17px;outline:none}}
input:focus{{border-color:#fff}}
button{{width:100%;margin-top:20px;padding:15px;border:0;border-radius:11px;font-weight:700;font-size:16px;cursor:pointer}}
.status{{margin:0 0 18px;padding:13px;border-radius:10px;line-height:1.4}}
.status.ok{{background:#173522}}
.status.bad{{background:#421d22}}
.small{{font-size:12px;opacity:.45;margin-top:18px;text-align:center}}
</style>
</head>
<body>
<div class="card">
<div class="brand">HDREZKA PREMIUM • DENYS EDITION</div>
<h1>Подключить телевизор</h1>
<p>Введите код с экрана TV и данные вашего аккаунта HDRezka. Пароль используется только для входа и не отправляется обратно на телевизор.</p>
{status}
<form method="post" action="/connect">
<label>Код с телевизора</label>
<input name="code" value="{code}" maxlength="6" autocomplete="one-time-code" required>
<label>Логин / E-mail HDRezka</label>
<input name="login" type="text" autocomplete="username" required>
<label>Пароль HDRezka</label>
<input name="password" type="password" autocomplete="current-password" required>
<button type="submit">Подключить HDRezka</button>
</form>
<div class="small">Сессия передаётся на TV после успешной авторизации • пароль не сохраняется в pairing</div>
</div>
</body>
</html>"""


@app.get("/connect")
async def connect_get(
    request: Request,
):
    code = (
        request.query_params.get(
            "code",
            "",
        )
        or ""
    ).strip().upper()

    return HTMLResponse(
        _connect_page(
            code=code,
        ),
        headers={
            "Cache-Control": "no-store",
        },
    )


@app.post("/connect")
async def connect_post(
    request: Request,
):
    raw = (
        await request.body()
    ).decode(
        "utf-8",
        errors="replace",
    )

    form = parse_qs(
        raw,
        keep_blank_values=True,
    )

    def one(name: str) -> str:
        values = form.get(
            name,
            [""],
        )

        return (
            str(
                values[-1]
            )
            if values
            else ""
        )

    code = (
        one("code")
        .strip()
        .upper()
    )

    login_value = (
        one("login")
        .strip()
    )

    password_value = one(
        "password"
    )

    _pair_cleanup()

    item = _PAIRINGS.get(
        code
    )

    if not item:
        return HTMLResponse(
            _connect_page(
                code=code,
                message=(
                    "Код не найден или уже истёк. "
                    "Создайте новый код на телевизоре."
                ),
            ),
            status_code=400,
            headers={
                "Cache-Control": "no-store",
            },
        )

    try:
        session, _ = (
            await login_and_build_session(
                login_value,
                password_value,
            )
        )
    except Exception as exc:
        detail = (
            getattr(
                exc,
                "detail",
                None,
            )
            or str(exc)
            or "Ошибка авторизации"
        )

        return HTMLResponse(
            _connect_page(
                code=code,
                message=(
                    "Не удалось войти в HDRezka: "
                    + str(detail)
                ),
            ),
            status_code=400,
            headers={
                "Cache-Control": "no-store",
            },
        )

    item["status"] = "connected"
    item["session"] = session
    item["login"] = login_value

    return HTMLResponse(
        _connect_page(
            code=code,
            message=(
                "Готово. HDRezka подключена. "
                "Можно вернуться к телевизору."
            ),
            success=True,
        ),
        headers={
            "Cache-Control": "no-store",
        },
    )


# ------------------------------------------------------------
# SAME-ORIGIN RPC FOR MEDIA STATION X
# Lampa.Reguest sends regular form-urlencoded POST.
# ------------------------------------------------------------

@app.post("/rpc/login")
async def rpc_login(
    request: Request,
):
    data = await _rpc_payload(
        request
    )

    return await api_login(
        LoginRequest(
            login=data.get(
                "login",
                "",
            ),
            password=data.get(
                "password",
                "",
            ),
        )
    )


@app.post("/rpc/status")
async def rpc_status(
    request: Request,
):
    data = await _rpc_payload(
        request
    )

    return await api_status(
        SessionRequest(
            session=data.get(
                "session",
                "",
            ),
        )
    )


@app.post("/rpc/resolve")
async def rpc_resolve(
    request: Request,
):
    data = await _rpc_payload(
        request
    )

    return await api_resolve(
        ResolveRequest(
            session=data.get(
                "session",
                "",
            ),
            title=data.get(
                "title",
                "",
            ),
            original_title=data.get(
                "original_title",
                "",
            ),
            year=_rpc_int(
                data.get(
                    "year"
                )
            ),
        )
    )


@app.post("/rpc/details")
async def rpc_details(
    request: Request,
):
    data = await _rpc_payload(
        request
    )

    return await api_details(
        DetailsRequest(
            session=data.get(
                "session",
                "",
            ),
            url=data.get(
                "url",
                "",
            ),
        )
    )


@app.post("/rpc/episodes")
async def rpc_episodes(
    request: Request,
):
    data = await _rpc_payload(
        request
    )

    translator_id = _rpc_int(
        data.get(
            "translator_id"
        )
    )

    if translator_id is None:
        raise HTTPException(
            400,
            "Не передана озвучка",
        )

    return await api_episodes(
        EpisodesRequest(
            session=data.get(
                "session",
                "",
            ),
            url=data.get(
                "url",
                "",
            ),
            translator_id=translator_id,
        )
    )


@app.post("/rpc/stream")
async def rpc_stream(
    request: Request,
):
    data = await _rpc_payload(
        request
    )

    translator_id = _rpc_int(
        data.get(
            "translator_id"
        )
    )

    if translator_id is None:
        raise HTTPException(
            400,
            "Не передана озвучка",
        )

    return await api_stream(
        StreamRequest(
            session=data.get(
                "session",
                "",
            ),
            url=data.get(
                "url",
                "",
            ),
            translator_id=translator_id,
            season=_rpc_int(
                data.get(
                    "season"
                )
            ),
            episode=_rpc_int(
                data.get(
                    "episode"
                )
            ),
        )
    )


@app.post("/rpc/pair/start")
async def rpc_pair_start(
    request: Request,
):
    return await api_pair_start(
        request
    )


@app.post("/rpc/pair/status")
async def rpc_pair_status(
    request: Request,
):
    data = await _rpc_payload(
        request
    )

    return await api_pair_status(
        PairStatusRequest(
            code=data.get(
                "code",
                "",
            ),
        )
    )


@app.get("/msx/start.json")
async def msx_start(
    request: Request,
):
    base = str(
        request.base_url
    ).rstrip("/")

    return {
        "name":
            "Lampa • HDREZKA Premium • DENYS",

        "version":
            APP_VERSION,

        "parameter":
            "content:"
            + base
            + "/msx/start.json",

        "action":
            "link:"
            + base
            + "/",
    }


@app.get("/denys-init.js")
async def denys_init_js():
    path = os.path.join(
        os.path.dirname(__file__),
        "denys-init.js",
    )

    with open(
        path,
        "r",
        encoding="utf-8",
    ) as file:
        source = file.read()

    return PlainTextResponse(
        source,
        media_type="application/javascript",
        headers={
            "Cache-Control":
                "no-store, no-cache, must-revalidate, max-age=0",
        },
    )


@app.get("/about")
async def root(
    request: Request,
):
    base = str(
        request.base_url
    ).rstrip("/")

    return {
        "ok": True,
        "service": (
            "HDREZKA Premium for Lampa"
        ),
        "version": APP_VERSION,
        "author": AUTHOR,
        "edition": "DENYS EDITION",
        "content_host": CONTENT_HOST,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "plugin": (
            base + "/plugin.js"
        ),
    }


@app.get("/health")
async def health():
    return {
        "ok": True,
        "version": APP_VERSION,
        "author": AUTHOR,
        "content_host": CONTENT_HOST,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "search_cache_entries": len(_SEARCH_CACHE),
        "api_cache_entries": len(_API_CACHE),
    }


@app.get("/api/about")
async def about():
    return {
        "ok": True,
        "name": "HDREZKA Premium",
        "edition": "DENYS EDITION",
        "author": AUTHOR,
        "version": APP_VERSION,
        "content_host": CONTENT_HOST,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "search_cache_entries": len(_SEARCH_CACHE),
        "api_cache_entries": len(_API_CACHE),
    }


@app.get("/plugin.js")
async def plugin_js(
    request: Request,
):
    base = str(
        request.base_url
    ).rstrip("/")

    plugin_path = os.path.join(
        os.path.dirname(__file__),
        "plugin.js",
    )

    with open(
        plugin_path,
        "r",
        encoding="utf-8",
    ) as file:
        source = file.read()

    source = source.replace(
        "__API_BASE__",
        base,
    )

    return PlainTextResponse(
        source,
        media_type=(
            "application/javascript"
        ),
        headers={
            "Cache-Control": (
                "no-store, no-cache, "
                "must-revalidate, max-age=0"
            )
        },
    )


@app.post("/api/login")
async def api_login(
    data: LoginRequest,
):
    login = data.login.strip()
    password = data.password

    if (
        not login
        or not password
    ):
        raise HTTPException(
            400,
            "Введите логин и пароль",
        )

    session, debug = (
        await login_and_build_session(
            login,
            password,
        )
    )

    return {
        "ok": True,
        "session": session,
        "host": CONTENT_HOST,
        "authenticated": True,
        "debug": debug,
    }


@app.post("/api/status")
async def api_status(
    data: SessionRequest,
):
    async with client_from_session(
        data.session
    ) as client:
        response = (
            await client.get_response(
                "GET",
                client.host,
            )
        )

        html = response.text or ""

        return {
            "ok": True,
            "authenticated": (
                response.status_code < 400
                and len(html) > 500
            ),
            "host": client.host,
            "http_status": (
                response.status_code
            ),
            "length": len(html),
        }


@app.post("/api/resolve")
async def api_resolve(
    data: ResolveRequest,
):
    if not (
        data.title.strip()
        or data.original_title.strip()
    ):
        raise HTTPException(
            400,
            "Не передано название фильма",
        )

    async with client_from_session(
        data.session
    ) as client:
        (
            candidates,
            diagnostics,
        ) = await search_candidates(
            client,
            data.title,
            data.original_title,
            data.year,
        )

        if not candidates:
            # Теперь НЕ скрываем причину.
            # Она попадёт прямо на экран Lampa.
            diagnostic_text = " | ".join(
                (
                    "host="
                    + str(
                        item.get("host")
                    )
                    + ", q="
                    + repr(
                        item.get("query")
                    )
                    + ", live="
                    + str(
                        item.get(
                            "live_status",
                            item.get(
                                "live_error",
                                "?",
                            ),
                        )
                    )
                    + "/"
                    + str(
                        item.get(
                            "live_results",
                            0,
                        )
                    )
                    + ", full="
                    + str(
                        item.get(
                            "full_status",
                            item.get(
                                "full_error",
                                "?",
                            ),
                        )
                    )
                    + "/"
                    + str(
                        item.get(
                            "full_results",
                            0,
                        )
                    )
                )
                for item in diagnostics
            )

            raise HTTPException(
                404,
                "HDRezka: поиск вернул 0 результатов. "
                + diagnostic_text,
            )

        best = candidates[0]

        auto_select = (
            best["score"] >= 0.78
            or (
                best["score"] >= 0.70
                and data.year
                and best.get("year")
                == data.year
            )
        )

        if not auto_select:
            return {
                "ok": True,
                "select": True,
                "results": candidates[:8],
                "debug": diagnostics,
            }

        details = await build_details(
            client,
            best["url"],
        )

        return {
            "ok": True,
            "select": False,
            "match": best,
            "details": details,
            "debug": diagnostics,
        }


@app.post("/api/details")
async def api_details(
    data: DetailsRequest,
):
    cache_key = (
        "details|"
        + _session_cache_id(data.session)
        + "|"
        + data.url
    )

    cached = _api_cache_get(cache_key)
    if cached is not None:
        return {
            "ok": True,
            "details": cached,
            "cache": "hit",
        }

    async with client_from_session(
        data.session
    ) as client:
        details = await build_details(
            client,
            data.url,
        )

        _api_cache_set(
            cache_key,
            details,
            30 * 60,
        )

        return {
            "ok": True,
            "details": details,
            "cache": "miss",
        }


@app.post("/api/episodes")
async def api_episodes(
    data: EpisodesRequest,
):
    episode_cache_key = (
        "episodes|"
        + _session_cache_id(
            data.session
        )
        + "|"
        + data.url
        + "|"
        + str(
            data.translator_id
        )
    )

    cached = _api_cache_get(
        episode_cache_key
    )

    if cached is not None:
        return cached

    async with client_from_session(
        data.session
    ) as client:
        meta = await fetch_post_meta(
            client,
            data.url,
        )

        if not meta.get(
            "is_series"
        ):
            return {
                "ok":
                    True,

                "seasons":
                    [],

                "episodes":
                    [],
            }

        payload = (
            await client.ajax.get_episodes(
                meta["id"],
                data.translator_id,
            )
        )

        seasons, episodes = (
            parse_episodes_payload(
                payload
            )
        )

        result = {
            "ok":
                True,

            "seasons":
                seasons,

            "episodes":
                episodes,
        }

        _api_cache_set(
            episode_cache_key,
            result,
            15 * 60,
        )

        return result


@app.post("/api/stream")
async def api_stream(
    data: StreamRequest,
):
    stream_cache_key = (
        "stream|"
        + _session_cache_id(
            data.session
        )
        + "|"
        + data.url
        + "|"
        + str(
            data.translator_id
        )
        + "|"
        + str(
            data.season
            or 0
        )
        + "|"
        + str(
            data.episode
            or 0
        )
    )

    cached = _api_cache_get(
        stream_cache_key
    )

    if cached is not None:
        return {
            "ok":
                True,

            **cached,

            "cache":
                "hit",
        }

    async with client_from_session(
        data.session
    ) as client:
        meta = await fetch_post_meta(
            client,
            data.url,
        )

        if meta.get(
            "is_series"
        ):
            if (
                data.season
                is None
                or data.episode
                is None
            ):
                raise HTTPException(
                    400,
                    (
                        "Для сериала не указан "
                        "сезон/эпизод"
                    ),
                )

            response = (
                await client.ajax.get_stream(
                    meta["id"],
                    data.translator_id,
                    data.season,
                    data.episode,
                )
            )

        else:
            response = (
                await client.ajax.get_movie(
                    meta["id"],
                    data.translator_id,
                )
            )

        streams = (
            urls_from_ajax_response(
                response,
                client=client,
            )
        )

        result = streams_to_json(
            streams
        )

        _api_cache_set(
            stream_cache_key,
            result,
            8 * 60,
        )

        return {
            "ok":
                True,

            **result,

            "cache":
                "miss",
        }


@app.get("/")
async def lampa_home():
    index_path = os.path.join(
        LAMPA_DIR,
        "index.html",
    )

    if not os.path.isfile(
        index_path
    ):
        return HTMLResponse(
            "<h1>Lampa bundle not found</h1>",
            status_code=503,
        )

    with open(
        index_path,
        "r",
        encoding="utf-8",
    ) as file:
        source = file.read()

    injection = (
        '<script src="/denys-init.js?v='
        + APP_VERSION
        + '"></script>'
    )

    if (
        injection
        not in source
    ):
        source = source.replace(
            "</body>",
            injection
            + "</body>",
        )

    return HTMLResponse(
        source,
        headers={
            "Cache-Control":
                "no-store, no-cache, must-revalidate, max-age=0",
        },
    )


# IMPORTANT: mount LAST so /api, /rpc, /connect, /plugin.js,
# /health and /msx/start.json keep priority.
app.mount(
    "/",
    StaticFiles(
        directory=LAMPA_DIR,
        html=True,
        check_dir=False,
    ),
    name="lampa-static",
)
