import asyncio
import base64
import hashlib
import html as html_lib
import json
import os
import re
import secrets
import time
import unicodedata
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import quote, urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup
from cryptography.fernet import Fernet, InvalidToken
from fastapi import FastAPI, Form, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel

from hdrezka import HDRezkaClient
from hdrezka.post.urls import urls_from_ajax_response


APP_VERSION = "8.0.0"
AUTHOR = "DENYS"
EDITION = "DENYS EDITION"
STARTED_AT = time.time()

# Current Lampac NextGen uses rezka.ag as its Rezka host. We keep a small
# fallback pool because mirrors change, but we do NOT mix hosts inside a
# session after login.
MIRRORS = tuple(
    x.rstrip("/") + "/"
    for x in (
        "https://rezka.ag",
        "https://rezka-ua.tv",
        "https://rezkery.com",
        "https://hdrezka.ag",
        "https://hdrezka.co",
        "https://hdrzk.org",
        "https://kvk.zone",
    )
)

SESSION_SECRET = os.getenv(
    "SESSION_SECRET",
    "denys-hdrezka-v8-change-me-in-render-environment-2026",
)
FERNET_KEY = base64.urlsafe_b64encode(
    hashlib.sha256(SESSION_SECRET.encode("utf-8")).digest()
)
FERNET = Fernet(FERNET_KEY)

PAIR_TTL = 10 * 60
PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
PAIRINGS: dict[str, dict[str, Any]] = {}
PAIR_LOCK = asyncio.Lock()

SEARCH_CACHE_TTL = 30 * 60
SEARCH_CACHE_MAX = 300
SEARCH_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}

DETAIL_CACHE_TTL = 15 * 60
DETAIL_CACHE_MAX = 300
DETAIL_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

ANUBIS_MAX_HASHES = int(os.getenv("ANUBIS_MAX_HASHES", str(1 << 26)))

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/150.0.0.0 Safari/537.36"
)

app = FastAPI(
    title="HDREZKA Premium for Lampa",
    version=APP_VERSION,
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


# ---------------------------------------------------------------------------
# Small caches
# ---------------------------------------------------------------------------

def _cache_get(store: dict, key: str):
    row = store.get(key)
    if not row:
        return None
    expires, value = row
    if expires <= time.time():
        store.pop(key, None)
        return None
    if isinstance(value, list):
        return [dict(x) for x in value]
    if isinstance(value, dict):
        return json.loads(json.dumps(value, ensure_ascii=False))
    return value


def _cache_set(store: dict, key: str, value: Any, ttl: int, max_size: int):
    now = time.time()
    expired = [k for k, (expires, _) in store.items() if expires <= now]
    for k in expired:
        store.pop(k, None)
    while len(store) >= max_size:
        try:
            store.pop(next(iter(store)))
        except StopIteration:
            break
    store[key] = (now + ttl, value)


# ---------------------------------------------------------------------------
# Encrypted stateless user session
# ---------------------------------------------------------------------------

def cookie_dict(client: HDRezkaClient) -> dict[str, str]:
    out: dict[str, str] = {}
    host_name = (urlsplit(client.host).hostname or "").casefold()

    for cookie in client.cookies.jar:
        if not cookie.name or not cookie.value:
            continue

        cookie_domain = str(getattr(cookie, "domain", "") or "").lstrip(".").casefold()
        if host_name and cookie_domain:
            if not (host_name == cookie_domain or host_name.endswith("." + cookie_domain)):
                continue

        name = str(cookie.name)
        # Keep auth / anti-bot / session cookies. Drop common analytics noise so
        # the encrypted token stays short enough for JSONP URLs on old TV WebViews.
        if (
            name.startswith("_ym_")
            or name in {"CLID", "MUID", "_clck", "_clsk", "_ga", "_gid"}
        ):
            continue
        out[name] = str(cookie.value)
    return out


def has_auth_cookies(cookies: dict[str, str]) -> bool:
    return bool(cookies.get("dle_user_id") and cookies.get("dle_password"))


def make_session(host: str, cookies: dict[str, str]) -> str:
    payload = {
        "v": 1,
        "host": host.rstrip("/") + "/",
        "cookies": cookies,
        "iat": int(time.time()),
    }
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return FERNET.encrypt(raw).decode("ascii")


def read_session(token: str) -> tuple[str, dict[str, str]]:
    if not token:
        raise HTTPException(401, "Сессия HDRezka отсутствует")
    try:
        raw = FERNET.decrypt(token.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
    except (InvalidToken, ValueError, json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(401, "Сессия HDRezka повреждена или создана другим ключом")

    host = str(payload.get("host") or "")
    cookies = payload.get("cookies") or {}
    if not host.startswith("https://") or not isinstance(cookies, dict):
        raise HTTPException(401, "Некорректная сессия HDRezka")

    return host.rstrip("/") + "/", {
        str(k): str(v)
        for k, v in cookies.items()
        if k and v
    }


def client_from_session(token: str) -> HDRezkaClient:
    host, cookies = read_session(token)
    return HDRezkaClient(
        host=host,
        redirect_url=host,
        cookies=cookies,
        headers={"User-Agent": BROWSER_UA},
        impersonate=True,
    )


def refreshed_session(client: HDRezkaClient) -> str:
    return make_session(client.host, cookie_dict(client))


# ---------------------------------------------------------------------------
# Anubis proof-of-work. Ported from the current public Lampac NextGen Rezka
# implementation and cross-checked against current standalone Python solvers.
# ---------------------------------------------------------------------------

ANUBIS_RE = re.compile(
    r"\bid\s*=\s*[\"']anubis_challenge[\"'][^>]*>(?P<json>.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)
ANUBIS_BASE_RE = re.compile(
    r"\bid\s*=\s*[\"']anubis_base_prefix[\"'][^>]*>(?P<json>.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)


def _deep_string(obj: Any, name: str) -> str:
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == name and isinstance(value, str):
                return value
            found = _deep_string(value, name)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = _deep_string(value, name)
            if found:
                return found
    return ""


def parse_anubis_challenge(text: str) -> dict[str, Any] | None:
    if not text or "anubis_challenge" not in text:
        return None
    match = ANUBIS_RE.search(text)
    if not match:
        return None
    try:
        raw = html_lib.unescape(match.group("json")).strip()
        data = json.loads(raw)
        challenge = data.get("challenge") or {}
        rules = data.get("rules") or {}
        challenge_id = str(challenge.get("id") or "")
        random_data = str(challenge.get("randomData") or "")
        algorithm = str(rules.get("algorithm") or "fast")
        difficulty = int(rules.get("difficulty") or 0)
        if not challenge_id or not random_data or difficulty < 0:
            return None

        base_prefix = ""
        base_match = ANUBIS_BASE_RE.search(text)
        if base_match:
            try:
                base_prefix = json.loads(html_lib.unescape(base_match.group("json")).strip()) or ""
            except Exception:
                base_prefix = ""

        return {
            "raw": data,
            "id": challenge_id,
            "random_data": random_data,
            "algorithm": algorithm,
            "difficulty": difficulty,
            "user_agent": _deep_string(data, "User-Agent"),
            "base_prefix": str(base_prefix or ""),
        }
    except Exception:
        return None


def _has_required_difficulty(digest: bytes, difficulty: int) -> bool:
    full_zero_bytes = difficulty // 2
    if any(digest[i] != 0 for i in range(full_zero_bytes)):
        return False
    if difficulty & 1:
        return (digest[full_zero_bytes] & 0xF0) == 0
    return True


def solve_anubis_pow(random_data: str, difficulty: int) -> tuple[int, str, int]:
    if difficulty < 0 or difficulty > 10:
        raise RuntimeError(f"Неподдерживаемая сложность Anubis: {difficulty}")

    prefix = random_data.encode("utf-8")
    started = time.perf_counter()

    for nonce in range(ANUBIS_MAX_HASHES):
        digest = hashlib.sha256(prefix + str(nonce).encode("ascii")).digest()
        if _has_required_difficulty(digest, difficulty):
            elapsed_ms = max(1, int((time.perf_counter() - started) * 1000))
            return nonce, digest.hex(), elapsed_ms

    raise RuntimeError(
        f"Anubis PoW не решён за {ANUBIS_MAX_HASHES:,} попыток (difficulty={difficulty})"
    )


def _origin(url: str) -> str:
    parts = urlsplit(str(url))
    return f"{parts.scheme}://{parts.netloc}"


def _navigation_headers(referer: str | None = None, user_agent: str | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": user_agent or BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "DNT": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Upgrade-Insecure-Requests": "1",
    }
    if referer:
        headers["Referer"] = referer
    return headers


def _ajax_headers(host: str, referer: str | None = None) -> dict[str, str]:
    origin = host.rstrip("/")
    return {
        "User-Agent": BROWSER_UA,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Origin": origin,
        "Referer": referer or origin + "/",
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }


async def pass_anubis(client: HDRezkaClient, response) -> bool:
    challenge = parse_anubis_challenge(response.text or "")
    if not challenge:
        return False

    algorithm = challenge["algorithm"]
    if algorithm not in {"fast", "slow"}:
        raise RuntimeError(f"Anubis algorithm={algorithm!r} пока не поддержан")

    nonce, hash_hex, elapsed_ms = await asyncio.to_thread(
        solve_anubis_pow,
        challenge["random_data"],
        challenge["difficulty"],
    )

    site = _origin(str(response.url))
    prefix = challenge.get("base_prefix", "").rstrip("/")
    endpoint = f"{prefix}/.within.website/x/cmd/anubis/api/pass-challenge"
    pass_url = urljoin(site + "/", endpoint.lstrip("/"))

    # Lampac sets this verification cookie before pass-challenge.
    host_name = urlsplit(site).hostname or ""
    if host_name:
        try:
            client.cookies.set(
                "techaro.lol-anubis-cookie-verification",
                challenge["id"],
                domain=host_name,
                path="/",
            )
        except Exception:
            client.cookies.set(
                "techaro.lol-anubis-cookie-verification",
                challenge["id"],
            )

    params = {
        "id": challenge["id"],
        "response": hash_hex,
        "nonce": nonce,
        "redir": str(response.url),
        "elapsedTime": elapsed_ms,
    }

    ua = challenge.get("user_agent") or BROWSER_UA
    passed = await client.get_response(
        "GET",
        pass_url,
        params=params,
        headers=_navigation_headers(site + "/", ua),
        follow_redirects=True,
    )

    return "anubis_challenge" not in (passed.text or "")


async def rezka_request(
    client: HDRezkaClient,
    method: str,
    url: str,
    *,
    attempts: int = 2,
    **kwargs,
):
    """Request a Rezka page/AJAX route and transparently pass Anubis."""
    last = None
    for _ in range(max(1, attempts + 1)):
        response = await client.get_response(method, url, **kwargs)
        last = response
        text = response.text or ""
        if "anubis_challenge" not in text:
            return response
        if not await pass_anubis(client, response):
            break
    return last


def _challenge_title(html: str) -> str:
    try:
        soup = BeautifulSoup(html or "", "html.parser")
        if soup.title:
            return soup.title.get_text(" ", strip=True)
    except Exception:
        pass
    return ""


def ensure_real_page(response, *, context: str):
    html = response.text or ""
    if "anubis_challenge" in html:
        raise HTTPException(502, f"HDRezka Anubis не прошёл: {context}")

    title = _challenge_title(html).casefold()
    if "проверяем, что вы не бот" in title or "making sure you're not a bot" in title:
        raise HTTPException(502, f"HDRezka всё ещё вернула антибот-страницу: {context}")

    low = html.casefold()
    if "ошибка доступа" in low and "error-code" in low:
        code = ""
        match = re.search(r"ошибка доступа[^0-9]{0,20}([0-9]{3})", html, re.I)
        if not match:
            match = re.search(r'class=["\']error-code["\'][^>]*>\s*([0-9]{3})', html, re.I)
        if match:
            code = match.group(1)

        if code == "105" or code == "403":
            raise HTTPException(502, f"HDRezka: IP зеркала заблокировал сервер (код {code}) • {context}")
        if code == "101":
            raise HTTPException(401, f"HDRezka: аккаунт заблокирован (код 101) • {context}")
        raise HTTPException(502, f"HDRezka: ошибка доступа {code or '?'} • {context}")

    if response.status_code >= 400:
        raise HTTPException(response.status_code, f"HDRezka HTTP {response.status_code}: {context}")
    return html


# ---------------------------------------------------------------------------
# Login / mirror selection
# ---------------------------------------------------------------------------

async def login_on_mirror(mirror: str, login: str, password: str) -> tuple[str, dict[str, str], dict[str, Any]]:
    client = HDRezkaClient(
        host=mirror,
        redirect_url=mirror,
        headers={"User-Agent": BROWSER_UA},
        impersonate=True,
    )

    try:
        root = await rezka_request(
            client,
            "GET",
            mirror,
            headers=_navigation_headers(mirror),
            attempts=2,
        )
        ensure_real_page(root, context=f"открытие {mirror}")

        # If a mirror redirected to another real Rezka host, bind this session to it.
        final_origin = _origin(str(root.url))
        if final_origin.startswith("https://"):
            client.host = final_origin

        login_url = client.host_join("ajax/login/")
        response = await rezka_request(
            client,
            "POST",
            login_url,
            data={
                "login_name": login,
                "login_password": password,
                "login_not_save": "0",
                "login": "submit",
            },
            headers=_ajax_headers(client.host, client.host),
            attempts=2,
        )

        # Some mirrors reply JSON; others only set cookies.
        message = ""
        try:
            payload = response.json()
            if isinstance(payload, dict):
                message = str(payload.get("message") or "")
        except Exception:
            payload = None

        cookies = cookie_dict(client)
        if not has_auth_cookies(cookies):
            raise RuntimeError(message or "HDRezka не вернула dle_user_id/dle_password")

        verify = await rezka_request(
            client,
            "GET",
            client.host,
            headers=_navigation_headers(client.host),
            attempts=2,
        )
        verify_html = ensure_real_page(verify, context="проверка авторизации")
        if re.search(r'<form[^>]+id=["\']check-form["\']', verify_html, re.I):
            raise RuntimeError("HDRezka вернула форму входа после авторизации")

        return client.host, cookie_dict(client), {
            "mirror": mirror,
            "host": client.host,
            "anubis": "techaro.lol-anubis-cookie-verification" in cookie_dict(client),
        }
    finally:
        await client.aclose()


async def login_and_build_session(login: str, password: str) -> tuple[str, dict[str, Any]]:
    login = (login or "").strip()
    if not login or not password:
        raise HTTPException(400, "Введите логин и пароль HDRezka")

    errors = []
    for mirror in MIRRORS:
        try:
            host, cookies, debug = await login_on_mirror(mirror, login, password)
            return make_session(host, cookies), debug
        except Exception as exc:
            detail = getattr(exc, "detail", None) or str(exc) or type(exc).__name__
            errors.append({"mirror": mirror, "error": detail[:240]})

    raise HTTPException(
        502,
        "Не удалось войти ни через одно зеркало HDRezka. "
        + " | ".join(f"{x['mirror']} → {x['error']}" for x in errors[:5]),
    )


# ---------------------------------------------------------------------------
# Search / details / AJAX streams
# ---------------------------------------------------------------------------

def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = value.casefold().replace("ё", "е")
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


def _post_url(host: str, href: str) -> str:
    joined = urljoin(host, href or "")
    parts = urlsplit(joined)
    base = urlsplit(host)
    return f"{base.scheme}://{base.netloc}{parts.path or '/'}" + (
        f"?{parts.query}" if parts.query else ""
    )


def parse_search_html(html: str, host: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html or "", "html.parser")
    rows: list[dict[str, Any]] = []
    seen = set()

    for node in soup.select(".b-content__inline_item"):
        link_block = node.select_one(".b-content__inline_item-link")
        a = link_block.find("a") if link_block else None
        if not a or not a.get("href"):
            continue
        title = a.get_text(" ", strip=True)
        info = link_block.find("div").get_text(" ", strip=True) if link_block and link_block.find("div") else ""
        year_match = re.search(r"\b((?:19|20)\d{2})\b", info)
        year = int(year_match.group(1)) if year_match else None
        href = _post_url(host, a.get("href"))
        if href in seen:
            continue
        seen.add(href)
        cover = node.select_one(".b-content__inline_item-cover img")
        rows.append({
            "title": title,
            "original_title": "",
            "year": year,
            "url": href,
            "cover": urljoin(host, cover.get("src")) if cover and cover.get("src") else "",
        })

    # Fast-search format fallback.
    for node in soup.select(".b-search__section_list li, .b-search__live_section li"):
        a = node.find("a")
        if not a or not a.get("href"):
            continue
        enty = a.select_one(".enty")
        title = enty.get_text(" ", strip=True) if enty else a.get_text(" ", strip=True)
        text = a.get_text(" ", strip=True)
        year_match = re.search(r"\b((?:19|20)\d{2})\b", text)
        year = int(year_match.group(1)) if year_match else None
        href = _post_url(host, a.get("href"))
        if href in seen:
            continue
        seen.add(href)
        rows.append({
            "title": title,
            "original_title": "",
            "year": year,
            "url": href,
            "cover": "",
        })

    return rows


async def search_one(client: HDRezkaClient, query: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    query = (query or "").strip()
    if not query:
        return [], {"query": query, "mode": "empty"}

    cache_key = f"{client.host}|{normalized(query)}"
    cached = _cache_get(SEARCH_CACHE, cache_key)
    if cached is not None:
        return cached, {"query": query, "mode": "cache", "count": len(cached)}

    params = {
        "do": "search",
        "subaction": "search",
        "q": query,
    }
    url = client.host_join("search/")
    response = await rezka_request(
        client,
        "GET",
        url,
        params=params,
        headers=_navigation_headers(client.host),
        attempts=2,
    )
    html = ensure_real_page(response, context=f"поиск {query!r}")
    rows = parse_search_html(html, client.host)
    mode = "full"

    if not rows:
        fast = await rezka_request(
            client,
            "POST",
            client.host_join("engine/ajax/search.php"),
            data={"q": query},
            headers=_ajax_headers(client.host, client.host),
            attempts=2,
        )
        fast_html = ensure_real_page(fast, context=f"быстрый поиск {query!r}")
        rows = parse_search_html(fast_html, client.host)
        mode = "fast"

    _cache_set(SEARCH_CACHE, cache_key, rows, SEARCH_CACHE_TTL, SEARCH_CACHE_MAX)
    return rows, {
        "query": query,
        "mode": mode,
        "count": len(rows),
        "host": client.host,
    }


def score_candidate(row: dict[str, Any], title: str, original: str, year: int | None) -> float:
    scores = [similarity(row.get("title", ""), title)]
    if original:
        scores.append(similarity(row.get("title", ""), original))
        scores.append(similarity(row.get("original_title", ""), original))
    score = max(scores) if scores else 0.0

    row_year = row.get("year")
    if year and row_year:
        diff = abs(int(year) - int(row_year))
        if diff == 0:
            score += 0.15
        elif diff == 1:
            score += 0.04
        elif diff >= 3:
            score -= 0.15
    return round(score, 4)


async def resolve_with_client(client: HDRezkaClient, title: str, original_title: str, year: int | None):
    queries = []
    for query in (title, original_title):
        query = (query or "").strip()
        if query and query not in queries:
            queries.append(query)

    collected: list[dict[str, Any]] = []
    seen = set()
    diagnostics = []

    for query in queries:
        rows, debug = await search_one(client, query)
        diagnostics.append(debug)
        for row in rows:
            if row["url"] not in seen:
                seen.add(row["url"])
                collected.append(dict(row))
        if collected:
            # One good query is normally enough; original title is fallback.
            break

    for row in collected:
        row["score"] = score_candidate(row, title, original_title, year)

    collected.sort(key=lambda row: row.get("score", 0), reverse=True)
    return collected, diagnostics


def _int(value: Any) -> int | None:
    try:
        if value is None or str(value).strip() == "":
            return None
        return int(str(value).strip())
    except Exception:
        return None


def page_title(soup: BeautifulSoup) -> str:
    node = soup.select_one(".b-post__title")
    if node:
        text = node.get_text(" ", strip=True)
        if text:
            return text
    meta = soup.find("meta", property="og:title")
    if meta and meta.get("content"):
        return str(meta.get("content")).strip()
    if soup.title:
        return soup.title.get_text(" ", strip=True)
    return "HDRezka"


def parse_post_meta(html: str, url: str) -> dict[str, Any]:
    soup = BeautifulSoup(html or "", "html.parser")
    flat = (html or "").replace("\r", " ").replace("\n", " ")

    id_match = re.search(r"/(\d+)-[^/?#]+\.html", url)
    post_id = _int(id_match.group(1)) if id_match else None

    series_match = re.search(
        r"\.initCDNSeriesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,",
        flat,
    )
    movie_match = re.search(
        r"\.initCDNMoviesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,",
        flat,
    )

    is_series = bool(series_match or soup.select_one("[data-season_id]"))
    default_voice = None
    default_camrip = 0
    default_ads = 0
    default_director = 0

    if series_match:
        post_id = _int(series_match.group(1)) or post_id
        default_voice = _int(series_match.group(2))
    elif movie_match:
        post_id = _int(movie_match.group(1)) or post_id
        default_voice = _int(movie_match.group(2))
        default_camrip = _int(movie_match.group(3)) or 0
        default_ads = _int(movie_match.group(4)) or 0
        default_director = _int(movie_match.group(5)) or 0

    hidden_id = soup.find(id="post_id")
    if post_id is None and hidden_id:
        post_id = _int(hidden_id.get("value"))

    voices: list[dict[str, Any]] = []
    seen_voice = set()
    for node in soup.select("#translators-list .b-translator__item[data-translator_id]"):
        translator_id = _int(node.get("data-translator_id"))
        if translator_id is None or translator_id in seen_voice:
            continue
        name = str(node.get("title") or node.get_text(" ", strip=True) or "Оригинал").strip()
        img = node.find("img")
        if img:
            lang = str(img.get("title") or img.get("alt") or "").strip()
            if lang and lang.casefold() not in name.casefold():
                name += f" ({lang})"
        voices.append({
            "id": translator_id,
            "name": name or "Оригинал",
            "is_camrip": _int(node.get("data-camrip")) or 0,
            "is_ads": _int(node.get("data-ads")) or 0,
            "is_director": _int(node.get("data-director")) or 0,
            "premium": "prem_translator" in (node.get("class") or []),
        })
        seen_voice.add(translator_id)

    if default_voice is not None and default_voice not in seen_voice:
        voices.insert(0, {
            "id": default_voice,
            "name": "Оригинал",
            "is_camrip": default_camrip,
            "is_ads": default_ads,
            "is_director": default_director,
            "premium": False,
        })

    if default_voice is None and voices:
        default_voice = voices[0]["id"]

    favs_node = soup.find(id="ctrl_favs")
    favs = str(favs_node.get("value") or "") if favs_node else ""

    restricted = bool(soup.select_one(".b-player__restricted__block_message"))

    if post_id is None:
        raise HTTPException(
            502,
            f"HDRezka: страница открылась, но post id не найден. url={url!r}, title={page_title(soup)!r}",
        )

    return {
        "url": url,
        "name": page_title(soup),
        "id": int(post_id),
        "is_series": is_series,
        "voices": voices,
        "default_voice_id": default_voice,
        "favs": favs,
        "restricted": restricted,
    }


async def rezka_ajax(client: HDRezkaClient, data: dict[str, Any], referer: str) -> dict[str, Any]:
    response = await rezka_request(
        client,
        "POST",
        client.host_join(f"ajax/get_cdn_series/?t={int(time.time() * 1000)}"),
        data={k: v for k, v in data.items() if v is not None},
        headers=_ajax_headers(client.host, referer),
        attempts=2,
    )
    text = response.text or ""
    if "anubis_challenge" in text:
        raise HTTPException(502, "HDRezka Anubis заблокировал AJAX")
    try:
        payload = response.json()
    except Exception:
        raise HTTPException(
            502,
            f"HDRezka AJAX вернул не JSON: status={response.status_code}, title={_challenge_title(text)!r}",
        )
    if isinstance(payload, dict) and payload.get("success") is False:
        raise HTTPException(502, str(payload.get("message") or "HDRezka AJAX error"))
    if not isinstance(payload, dict):
        raise HTTPException(502, "HDRezka AJAX вернул неожиданный ответ")
    return payload


def parse_episodes_payload(payload: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    seasons_html = str(payload.get("seasons") or "")
    episodes_html = str(payload.get("episodes") or "")
    seasons: dict[int, dict] = {}
    episodes: list[dict] = []

    if seasons_html:
        soup = BeautifulSoup("<ul>" + seasons_html + "</ul>", "html.parser")
        for node in soup.select(".b-simple_season__item"):
            sid = _int(node.get("data-tab_id"))
            if sid is None:
                continue
            seasons[sid] = {
                "id": sid,
                "name": node.get_text(" ", strip=True) or f"Сезон {sid}",
            }

    if episodes_html:
        soup = BeautifulSoup("<div>" + episodes_html + "</div>", "html.parser")
        for node in soup.select(".b-simple_episode__item"):
            sid = _int(node.get("data-season_id"))
            eid = _int(node.get("data-episode_id"))
            if sid is None or eid is None:
                continue
            seasons.setdefault(sid, {"id": sid, "name": f"Сезон {sid}"})
            episodes.append({
                "season_id": sid,
                "episode_id": eid,
                "name": node.get_text(" ", strip=True) or f"Серия {eid}",
            })

    season_list = sorted(seasons.values(), key=lambda x: x["id"])
    episodes.sort(key=lambda x: (x["season_id"], x["episode_id"]))
    return season_list, episodes


async def fetch_post_meta(client: HDRezkaClient, url: str) -> dict[str, Any]:
    normalized_url = _post_url(client.host, url)
    cache_key = f"{client.host}|{normalized_url}|{hashlib.sha1(json.dumps(cookie_dict(client), sort_keys=True).encode()).hexdigest()[:12]}"
    cached = _cache_get(DETAIL_CACHE, cache_key)
    if cached is not None:
        return cached

    response = await rezka_request(
        client,
        "GET",
        normalized_url,
        headers=_navigation_headers(client.host),
        attempts=2,
    )
    html = ensure_real_page(response, context=f"карточка {normalized_url}")
    final_url = _post_url(client.host, str(response.url))
    meta = parse_post_meta(html, final_url)
    _cache_set(DETAIL_CACHE, cache_key, meta, DETAIL_CACHE_TTL, DETAIL_CACHE_MAX)
    return meta


async def build_details(client: HDRezkaClient, url: str) -> dict[str, Any]:
    meta = await fetch_post_meta(client, url)
    seasons: list[dict] = []
    episodes: list[dict] = []
    default_voice = meta.get("default_voice_id")

    if meta.get("is_series") and default_voice is not None:
        payload = await rezka_ajax(
            client,
            {
                "action": "get_episodes",
                "id": meta["id"],
                "translator_id": default_voice,
                "favs": meta.get("favs", ""),
            },
            meta["url"],
        )
        seasons, episodes = parse_episodes_payload(payload)

    return {
        **meta,
        "seasons": seasons,
        "episodes": episodes,
    }


async def streams_to_json(streams) -> dict[str, Any]:
    rows: list[tuple[int, str, str]] = []
    for quality, urls in streams.video.raw_data.items():
        if not urls:
            continue
        label = str(quality)
        # Keep the raw HLS URL. Current Rezka URLs can redirect, and the Lampa
        # player/browser is better placed to follow the CDN redirect for that device.
        url = str(urls[0])
        try:
            numeric = int(quality)
        except Exception:
            numeric = 0
        rows.append((numeric, label, url))

    rows.sort(key=lambda row: row[0])
    if not rows:
        raise HTTPException(502, "HDRezka не вернула HLS-поток")

    subtitles = []
    for sub in streams.subtitles.subtitles:
        if sub.url:
            subtitles.append({
                "label": sub.name or sub.code,
                "url": sub.url,
            })

    return {
        "url": rows[-1][2],
        "quality": {label: url for _, label, url in rows},
        "subtitles": subtitles,
    }


# ---------------------------------------------------------------------------
# Core API functions shared by POST and JSONP transports
# ---------------------------------------------------------------------------

async def core_status(session: str) -> dict[str, Any]:
    client = client_from_session(session)
    try:
        response = await rezka_request(
            client,
            "GET",
            client.host,
            headers=_navigation_headers(client.host),
            attempts=2,
        )
        html = ensure_real_page(response, context="status")
        authenticated = has_auth_cookies(cookie_dict(client)) and not bool(
            re.search(r'<form[^>]+id=["\']check-form["\']', html, re.I)
        )
        return {
            "ok": True,
            "authenticated": authenticated,
            "host": client.host,
            "anubis": "techaro.lol-anubis-cookie-verification" in cookie_dict(client),
            "session": refreshed_session(client),
        }
    finally:
        await client.aclose()


async def core_resolve(data: ResolveRequest) -> dict[str, Any]:
    client = client_from_session(data.session)
    try:
        candidates, diagnostics = await resolve_with_client(
            client,
            data.title,
            data.original_title,
            data.year,
        )
        if not candidates:
            raise HTTPException(
                404,
                "HDRezka: поиск вернул 0 результатов. "
                + json.dumps(diagnostics, ensure_ascii=False),
            )

        best = candidates[0]
        second = candidates[1] if len(candidates) > 1 else None
        auto = best.get("score", 0) >= 0.90 and (
            second is None or best.get("score", 0) - second.get("score", 0) >= 0.06
        )

        compat_results = [
            {
                "name": row.get("title", "HDRezka"),
                "title": row.get("title", "HDRezka"),
                "year": row.get("year"),
                "country": "",
                "genre": "",
                "url": row.get("url", ""),
                "cover": row.get("cover", ""),
                "score": row.get("score", 0),
            }
            for row in candidates[:12]
        ]

        result: dict[str, Any] = {
            "ok": True,
            "select": not auto,
            "results": compat_results,
            "candidates": candidates[:12],
            "match": best,
            "debug": diagnostics,
            "session": refreshed_session(client),
        }

        if auto:
            result["details"] = await build_details(client, best["url"])
            result["session"] = refreshed_session(client)

        return result
    finally:
        await client.aclose()


async def core_details(data: DetailsRequest) -> dict[str, Any]:
    client = client_from_session(data.session)
    try:
        details = await build_details(client, data.url)
        return {
            "ok": True,
            "details": details,
            "session": refreshed_session(client),
        }
    finally:
        await client.aclose()


async def core_episodes(data: EpisodesRequest) -> dict[str, Any]:
    client = client_from_session(data.session)
    try:
        meta = await fetch_post_meta(client, data.url)
        if not meta.get("is_series"):
            return {
                "ok": True,
                "seasons": [],
                "episodes": [],
                "session": refreshed_session(client),
            }
        payload = await rezka_ajax(
            client,
            {
                "action": "get_episodes",
                "id": meta["id"],
                "translator_id": data.translator_id,
                "favs": meta.get("favs", ""),
            },
            meta["url"],
        )
        seasons, episodes = parse_episodes_payload(payload)
        return {
            "ok": True,
            "seasons": seasons,
            "episodes": episodes,
            "session": refreshed_session(client),
        }
    finally:
        await client.aclose()


async def core_stream(data: StreamRequest) -> dict[str, Any]:
    client = client_from_session(data.session)
    try:
        meta = await fetch_post_meta(client, data.url)
        voice = next(
            (v for v in meta.get("voices", []) if int(v.get("id")) == int(data.translator_id)),
            None,
        ) or {
            "id": data.translator_id,
            "is_camrip": 0,
            "is_ads": 0,
            "is_director": 0,
        }

        if meta.get("is_series"):
            if data.season is None or data.episode is None:
                raise HTTPException(400, "Для сериала не указан сезон/эпизод")
            payload = await rezka_ajax(
                client,
                {
                    "action": "get_stream",
                    "id": meta["id"],
                    "translator_id": data.translator_id,
                    "season": data.season,
                    "episode": data.episode,
                    "favs": meta.get("favs", ""),
                },
                meta["url"],
            )
        else:
            payload = await rezka_ajax(
                client,
                {
                    "action": "get_movie",
                    "id": meta["id"],
                    "translator_id": data.translator_id,
                    "is_camrip": voice.get("is_camrip", 0),
                    "is_ads": voice.get("is_ads", 0),
                    "is_director": voice.get("is_director", 0),
                    "favs": meta.get("favs", ""),
                },
                meta["url"],
            )

        streams = urls_from_ajax_response(payload, client=client)
        result = await streams_to_json(streams)
        return {
            "ok": True,
            **result,
            "session": refreshed_session(client),
        }
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------
# Pairing: TV receives only a short code and later an encrypted session token.
# Login/password are entered on phone/PC directly into this backend.
# ---------------------------------------------------------------------------

def _pair_cleanup_unlocked():
    now = time.time()
    for code in [c for c, row in PAIRINGS.items() if row.get("expires", 0) <= now]:
        PAIRINGS.pop(code, None)


def _pair_code() -> str:
    for _ in range(100):
        code = "".join(secrets.choice(PAIR_ALPHABET) for _ in range(6))
        if code not in PAIRINGS:
            return code
    raise RuntimeError("Не удалось создать код подключения")


async def pair_start(request: Request) -> dict[str, Any]:
    async with PAIR_LOCK:
        _pair_cleanup_unlocked()
        code = _pair_code()
        PAIRINGS[code] = {
            "status": "pending",
            "created": time.time(),
            "expires": time.time() + PAIR_TTL,
            "session": "",
            "login": "",
            "error": "",
        }

    base = str(request.base_url).rstrip("/")
    return {
        "ok": True,
        "code": code,
        "expires_in": PAIR_TTL,
        "connect_url": f"{base}/connect?code={quote(code)}",
        "short_url": f"{base}/connect",
    }


async def pair_status(code: str) -> dict[str, Any]:
    code = (code or "").strip().upper()
    async with PAIR_LOCK:
        _pair_cleanup_unlocked()
        row = PAIRINGS.get(code)
        if not row:
            return {"ok": True, "status": "expired"}
        result = {
            "ok": True,
            "status": row.get("status", "pending"),
            "expires_in": max(0, int(row.get("expires", 0) - time.time())),
        }
        if row.get("status") == "connected":
            result["session"] = row.get("session", "")
            result["login"] = row.get("login", "")
            result["host"] = row.get("host", "")
        elif row.get("status") == "error":
            result["error"] = row.get("error", "Ошибка подключения")
        return result


def connect_page(code: str = "", message: str = "", success: bool = False) -> str:
    code = html_lib.escape(code or "")
    message = html_lib.escape(message or "")
    status = ""
    if message:
        status = f'<div class="status {"ok" if success else "bad"}">{message}</div>'

    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HDREZKA Premium • by DENYS</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#101114;color:#fff;font-family:Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}}.card{{width:min(520px,100%);background:#1a1c21;border:1px solid #343842;border-radius:20px;padding:28px;box-shadow:0 20px 70px rgba(0,0,0,.38)}}.brand{{font-size:12px;opacity:.55;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}}h1{{margin:0 0 8px;font-size:28px}}p{{opacity:.72;line-height:1.45;margin:0 0 22px}}label{{display:block;font-size:13px;opacity:.72;margin:14px 0 7px}}input{{width:100%;padding:14px 15px;border-radius:11px;border:1px solid #3b404b;background:#101216;color:#fff;font-size:17px;outline:none}}input:focus{{border-color:#fff}}button{{width:100%;margin-top:20px;padding:15px;border:0;border-radius:11px;font-weight:700;font-size:16px;cursor:pointer}}.status{{margin:0 0 18px;padding:13px;border-radius:10px;line-height:1.4}}.status.ok{{background:#173522}}.status.bad{{background:#421d22}}.small{{font-size:12px;opacity:.45;margin-top:18px;text-align:center}}
</style>
</head>
<body><div class="card">
<div class="brand">HDREZKA PREMIUM • DENYS EDITION v{APP_VERSION}</div>
<h1>Подключить телевизор</h1>
<p>Введите код с TV и данные вашего аккаунта HDRezka. Пароль используется только для входа и не сохраняется. Телевизор получит только зашифрованную сессию.</p>
{status}
<form method="post" action="/connect">
<label>Код с телевизора</label><input name="code" value="{code}" maxlength="6" autocomplete="one-time-code" required>
<label>Логин / E-mail HDRezka</label><input name="login" type="text" autocomplete="username" required>
<label>Пароль HDRezka</label><input name="password" type="password" autocomplete="current-password" required>
<button type="submit">Подключить HDRezka</button>
</form>
<div class="small">Anubis anti-bot решается на сервере • пароль не сохраняется</div>
</div></body></html>"""


# ---------------------------------------------------------------------------
# JSONP transport for Media Station X / VIDAA.
# Cross-origin script tags are already how Lampa plugins are loaded, so this
# avoids the exact XHR/fetch CORS limitation that breaks Online Mod login in MSX.
# ---------------------------------------------------------------------------

CALLBACK_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]{0,80}$")


def jsonp(callback: str, payload: dict[str, Any], status_code: int = 200):
    callback = str(callback or "")
    if not CALLBACK_RE.match(callback):
        return PlainTextResponse("/* invalid callback */", status_code=400, media_type="application/javascript")
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return PlainTextResponse(
        f"{callback}({body});",
        status_code=status_code,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "X-Content-Type-Options": "nosniff",
        },
    )


async def jsonp_guard(callback: str, coro):
    try:
        payload = await coro
        return jsonp(callback, payload)
    except HTTPException as exc:
        return jsonp(callback, {"ok": False, "status": exc.status_code, "error": str(exc.detail)})
    except Exception as exc:
        return jsonp(callback, {"ok": False, "status": 500, "error": f"{type(exc).__name__}: {exc}"})


# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "path": request.url.path,
            "version": APP_VERSION,
        },
    )


@app.get("/")
async def root(request: Request):
    base = str(request.base_url).rstrip("/")
    return {
        "ok": True,
        "service": "HDREZKA Premium for Lampa",
        "version": APP_VERSION,
        "author": AUTHOR,
        "edition": EDITION,
        "architecture": "v2 PC baseline + Anubis backend + JSONP MSX transport",
        "plugin": base + "/plugin.js?v=80",
        "connect": base + "/connect",
        "uptime_seconds": int(time.time() - STARTED_AT),
    }


@app.get("/health")
async def health():
    return {
        "ok": True,
        "version": APP_VERSION,
        "author": AUTHOR,
        "anubis_solver": True,
        "tv_transport": "jsonp-script",
        "mirrors": list(MIRRORS),
        "uptime_seconds": int(time.time() - STARTED_AT),
        "pairings": len(PAIRINGS),
    }


@app.get("/plugin.js")
async def plugin_js(request: Request):
    base = str(request.base_url).rstrip("/")
    path = os.path.join(os.path.dirname(__file__), "plugin.js")
    with open(path, "r", encoding="utf-8") as fh:
        source = fh.read()
    source = source.replace("__API_BASE__", base)
    return PlainTextResponse(
        source,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.post("/api/login")
async def api_login(data: LoginRequest):
    session, debug = await login_and_build_session(data.login, data.password)
    return {
        "ok": True,
        "session": session,
        "host": debug.get("host"),
        "authenticated": True,
        "debug": debug,
    }


@app.post("/api/status")
async def api_status(data: SessionRequest):
    return await core_status(data.session)


@app.post("/api/resolve")
async def api_resolve(data: ResolveRequest):
    return await core_resolve(data)


@app.post("/api/details")
async def api_details(data: DetailsRequest):
    return await core_details(data)


@app.post("/api/episodes")
async def api_episodes(data: EpisodesRequest):
    return await core_episodes(data)


@app.post("/api/stream")
async def api_stream(data: StreamRequest):
    return await core_stream(data)


@app.get("/connect")
async def connect_get(request: Request):
    code = (request.query_params.get("code") or "").strip().upper()
    return HTMLResponse(connect_page(code=code), headers={"Cache-Control": "no-store"})


@app.post("/connect")
async def connect_post(
    code: str = Form(...),
    login: str = Form(...),
    password: str = Form(...),
):
    code = (code or "").strip().upper()
    async with PAIR_LOCK:
        _pair_cleanup_unlocked()
        row = PAIRINGS.get(code)
        if not row:
            return HTMLResponse(
                connect_page(code=code, message="Код не найден или уже истёк. Создайте новый код на телевизоре."),
                status_code=400,
                headers={"Cache-Control": "no-store"},
            )
        row["status"] = "working"

    try:
        session, debug = await login_and_build_session(login, password)
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc) or "Ошибка входа"
        async with PAIR_LOCK:
            row = PAIRINGS.get(code)
            if row:
                row["status"] = "pending"
                row["error"] = str(detail)[:500]
        return HTMLResponse(
            connect_page(code=code, message="Не удалось войти: " + str(detail)),
            status_code=400,
            headers={"Cache-Control": "no-store"},
        )

    async with PAIR_LOCK:
        row = PAIRINGS.get(code)
        if row:
            row.update({
                "status": "connected",
                "session": session,
                "login": login.strip(),
                "host": debug.get("host", ""),
                "error": "",
            })

    return HTMLResponse(
        connect_page(
            code=code,
            message="Готово. HDRezka подключена. Можно возвращаться к телевизору.",
            success=True,
        ),
        headers={"Cache-Control": "no-store"},
    )


@app.get("/jsonp/pair/start")
async def jsonp_pair_start(request: Request, callback: str = Query(...)):
    return await jsonp_guard(callback, pair_start(request))


@app.get("/jsonp/pair/status")
async def jsonp_pair_status(callback: str = Query(...), code: str = Query(...)):
    return await jsonp_guard(callback, pair_status(code))


@app.get("/jsonp/status")
async def jsonp_status(callback: str = Query(...), session: str = Query(...)):
    return await jsonp_guard(callback, core_status(session))


@app.get("/jsonp/resolve")
async def jsonp_resolve(
    callback: str = Query(...),
    session: str = Query(...),
    title: str = Query(""),
    original_title: str = Query(""),
    year: int | None = Query(None),
):
    return await jsonp_guard(callback, core_resolve(ResolveRequest(
        session=session,
        title=title,
        original_title=original_title,
        year=year,
    )))


@app.get("/jsonp/details")
async def jsonp_details(callback: str = Query(...), session: str = Query(...), url: str = Query(...)):
    return await jsonp_guard(callback, core_details(DetailsRequest(session=session, url=url)))


@app.get("/jsonp/episodes")
async def jsonp_episodes(
    callback: str = Query(...),
    session: str = Query(...),
    url: str = Query(...),
    translator_id: int = Query(...),
):
    return await jsonp_guard(callback, core_episodes(EpisodesRequest(
        session=session,
        url=url,
        translator_id=translator_id,
    )))


@app.get("/jsonp/stream")
async def jsonp_stream(
    callback: str = Query(...),
    session: str = Query(...),
    url: str = Query(...),
    translator_id: int = Query(...),
    season: int | None = Query(None),
    episode: int | None = Query(None),
):
    return await jsonp_guard(callback, core_stream(StreamRequest(
        session=session,
        url=url,
        translator_id=translator_id,
        season=season,
        episode=episode,
    )))
