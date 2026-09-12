import base64
import hashlib
import hmac
import json
import os
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

from hdrezka import HDRezkaClient
from hdrezka.stream.player import PlayerSeries


APP_VERSION = "1.1.0"

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


def _absolute(client: HDRezkaClient, href: str) -> str:
    return urljoin(client.host, href)


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

        url = _absolute(client, href)

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

        url = _absolute(client, href)

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
        rows, debug = await search_one(
            client,
            query,
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
    player = await client.player(url)
    post = player.post

    voices = [
        {
            "id": int(translator_id),
            "name": (
                str(name).strip()
                or "Оригинал"
            ),
        }
        for name, translator_id
        in post.translators.name_id.items()
        if translator_id is not None
    ]

    default_voice = post.translator_id

    if (
        default_voice is None
        and voices
    ):
        default_voice = voices[0]["id"]

    seasons: list[dict] = []
    episodes: list[dict] = []

    if (
        isinstance(
            player,
            PlayerSeries,
        )
        and default_voice is not None
    ):
        payload = (
            await client.ajax.get_episodes(
                post.id,
                default_voice,
            )
        )

        seasons, episodes = (
            parse_episodes_payload(
                payload
            )
        )

    return {
        "url": str(post.url),
        "name": str(post.name),
        "id": int(post.id),
        "is_series": isinstance(
            player,
            PlayerSeries,
        ),
        "voices": voices,
        "default_voice_id": (
            default_voice
        ),
        "seasons": seasons,
        "episodes": episodes,
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
        },
    )


@app.get("/")
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
        "content_host": CONTENT_HOST,
        "plugin": (
            base + "/plugin.js"
        ),
    }


@app.get("/health")
async def health():
    return {
        "ok": True,
        "version": APP_VERSION,
        "content_host": CONTENT_HOST,
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
    async with client_from_session(
        data.session
    ) as client:
        details = await build_details(
            client,
            data.url,
        )

        return {
            "ok": True,
            "details": details,
        }


@app.post("/api/episodes")
async def api_episodes(
    data: EpisodesRequest,
):
    async with client_from_session(
        data.session
    ) as client:
        player = await client.player(
            data.url
        )

        if not isinstance(
            player,
            PlayerSeries,
        ):
            return {
                "ok": True,
                "seasons": [],
                "episodes": [],
            }

        payload = (
            await client.ajax.get_episodes(
                player.post.id,
                data.translator_id,
            )
        )

        seasons, episodes = (
            parse_episodes_payload(
                payload
            )
        )

        return {
            "ok": True,
            "seasons": seasons,
            "episodes": episodes,
        }


@app.post("/api/stream")
async def api_stream(
    data: StreamRequest,
):
    async with client_from_session(
        data.session
    ) as client:
        player = await client.player(
            data.url
        )

        if isinstance(
            player,
            PlayerSeries,
        ):
            if (
                data.season is None
                or data.episode is None
            ):
                raise HTTPException(
                    400,
                    (
                        "Для сериала не указан "
                        "сезон/эпизод"
                    ),
                )

            streams = (
                await player.get_stream(
                    data.season,
                    data.episode,
                    data.translator_id,
                )
            )

        else:
            streams = (
                await player.get_stream(
                    data.translator_id
                )
            )

        result = streams_to_json(
            streams
        )

        return {
            "ok": True,
            **result,
        }
