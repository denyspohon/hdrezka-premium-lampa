import base64
import hashlib
import hmac
import json
import os
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any

from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

from hdrezka import HDRezkaClient
from hdrezka.errors import EmptyPage
from hdrezka.stream.player import PlayerSeries


APP_VERSION = "1.0.0"
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
        "cookies": cookies
    }
    raw = json.dumps(
        payload,
        separators=(",", ":"),
        ensure_ascii=False
    ).encode("utf-8")
    body = _b64e(raw)
    sig = hmac.new(
        SESSION_SECRET,
        body.encode("ascii"),
        hashlib.sha256
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
        hashlib.sha256
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

    return host, {
        str(k): str(v)
        for k, v in cookies.items()
        if k and v
    }


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
        similarity(name, original_title)
        if original_title else 0.0
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


async def search_candidates(
    client: HDRezkaClient,
    title: str,
    original_title: str,
    year: int | None,
) -> list[dict[str, Any]]:
    queries: list[str] = []

    for query in (title, original_title):
        query = (query or "").strip()

        if query and query not in queries:
            queries.append(query)

    found: dict[str, dict[str, Any]] = {}

    for query in queries:
        try:
            items = await client.search(query).get_page(1)
        except EmptyPage:
            items = []
        except Exception:
            items = []

        for item in items:
            item_year = getattr(item.info, "year", None)

            row = {
                "url": str(item.url),
                "name": str(item.name).strip(),
                "year": item_year,
                "country": getattr(item.info, "country", "") or "",
                "genre": getattr(item.info, "genre", "") or "",
                "poster": str(item.poster or ""),
            }

            row["score"] = item_score(
                row["name"],
                item_year,
                title,
                original_title,
                year
            )

            old = found.get(row["url"])

            if not old or row["score"] > old["score"]:
                found[row["url"]] = row

    rows = sorted(
        found.values(),
        key=lambda x: x["score"],
        reverse=True
    )

    return rows[:12]


def parse_episodes_payload(data: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    seasons: dict[int, dict] = {}
    episodes: list[dict] = []

    seasons_html = str(data.get("seasons") or "")
    episodes_html = str(data.get("episodes") or "")

    if seasons_html:
        soup = BeautifulSoup(
            "<ul>" + seasons_html + "</ul>",
            "html.parser"
        )

        for node in soup.select(".b-simple_season__item"):
            raw_id = node.get("data-tab_id")

            try:
                season_id = int(raw_id)
            except (TypeError, ValueError):
                continue

            seasons[season_id] = {
                "id": season_id,
                "name": node.get_text(" ", strip=True)
                or f"Сезон {season_id}"
            }

    if episodes_html:
        soup = BeautifulSoup(
            "<div>" + episodes_html + "</div>",
            "html.parser"
        )

        for node in soup.select(".b-simple_episode__item"):
            try:
                season_id = int(
                    node.get("data-season_id")
                )
                episode_id = int(
                    node.get("data-episode_id")
                )
            except (TypeError, ValueError):
                continue

            if season_id not in seasons:
                seasons[season_id] = {
                    "id": season_id,
                    "name": f"Сезон {season_id}"
                }

            episodes.append({
                "season_id": season_id,
                "episode_id": episode_id,
                "name": node.get_text(" ", strip=True)
                or f"Серия {episode_id}"
            })

    season_list = sorted(
        seasons.values(),
        key=lambda x: x["id"]
    )

    episodes.sort(
        key=lambda x: (
            x["season_id"],
            x["episode_id"]
        )
    )

    return season_list, episodes


async def build_details(
    client: HDRezkaClient,
    url: str
) -> dict[str, Any]:
    player = await client.player(url)
    post = player.post

    voices = [
        {
            "id": int(translator_id),
            "name": str(name).strip() or "Оригинал"
        }
        for name, translator_id
        in post.translators.name_id.items()
        if translator_id is not None
    ]

    default_voice = post.translator_id

    if default_voice is None and voices:
        default_voice = voices[0]["id"]

    seasons: list[dict] = []
    episodes: list[dict] = []

    if isinstance(player, PlayerSeries) and default_voice is not None:
        payload = await client.ajax.get_episodes(
            post.id,
            default_voice
        )
        seasons, episodes = parse_episodes_payload(payload)

    return {
        "url": str(post.url),
        "name": str(post.name),
        "id": int(post.id),
        "is_series": isinstance(player, PlayerSeries),
        "voices": voices,
        "default_voice_id": default_voice,
        "seasons": seasons,
        "episodes": episodes,
    }


def streams_to_json(streams) -> dict[str, Any]:
    quality_rows: list[tuple[int, str, str]] = []

    for quality, urls in streams.video.raw_data.items():
        if not urls:
            continue

        label = str(quality)
        url = str(urls[0])

        try:
            numeric = int(quality)
        except Exception:
            numeric = 0

        quality_rows.append(
            (numeric, label, url)
        )

    quality_rows.sort(
        key=lambda row: row[0]
    )

    if not quality_rows:
        raise HTTPException(
            502,
            "HDRezka не вернула видеопоток"
        )

    quality = {
        label: url
        for _, label, url in quality_rows
    }

    subtitles = []

    for sub in streams.subtitles.subtitles:
        if not sub.url:
            continue

        subtitles.append({
            "label": sub.name or sub.code,
            "url": sub.url
        })

    return {
        "url": quality_rows[-1][2],
        "quality": quality,
        "subtitles": subtitles
    }


@app.exception_handler(Exception)
async def unhandled_exception(
    request: Request,
    exc: Exception
):
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}"
        }
    )


@app.get("/")
async def root(request: Request):
    base = str(request.base_url).rstrip("/")

    return {
        "ok": True,
        "service": "HDREZKA Premium for Lampa",
        "version": APP_VERSION,
        "plugin": base + "/plugin.js"
    }


@app.get("/health")
async def health():
    return {
        "ok": True,
        "version": APP_VERSION
    }


@app.get("/plugin.js")
async def plugin_js(request: Request):
    base = str(request.base_url).rstrip("/")
    plugin_path = os.path.join(
        os.path.dirname(__file__),
        "plugin.js"
    )

    with open(
        plugin_path,
        "r",
        encoding="utf-8"
    ) as file:
        source = file.read()

    source = source.replace(
        "__API_BASE__",
        base
    )

    return PlainTextResponse(
        source,
        media_type="application/javascript",
        headers={
            "Cache-Control":
                "no-store, no-cache, must-revalidate, max-age=0"
        }
    )


@app.post("/api/login")
async def api_login(data: LoginRequest):
    login = data.login.strip()
    password = data.password

    if not login or not password:
        raise HTTPException(
            400,
            "Введите логин и пароль"
        )

    async with HDRezkaClient(
        impersonate=True
    ) as client:
        await client.login(
            login,
            password
        )

        cookies = cookie_dict(client)

        if (
            "dle_user_id" not in cookies or
            "dle_password" not in cookies
        ):
            raise HTTPException(
                401,
                "HDRezka не подтвердила авторизацию"
            )

        session = make_session(
            client.host,
            cookies
        )

        return {
            "ok": True,
            "session": session,
            "host": client.host,
            "authenticated": True
        }


@app.post("/api/status")
async def api_status(data: SessionRequest):
    async with client_from_session(
        data.session
    ) as client:
        response = await client.get_response(
            "GET",
            client.host
        )

        html = response.text

        logged = not (
            'action="/ajax/login/"' in html or
            'id="check-form"' in html
        )

        return {
            "ok": True,
            "authenticated": logged,
            "host": client.host,
            "http_status": response.status_code
        }


@app.post("/api/resolve")
async def api_resolve(
    data: ResolveRequest
):
    if not (
        data.title.strip() or
        data.original_title.strip()
    ):
        raise HTTPException(
            400,
            "Не передано название фильма"
        )

    async with client_from_session(
        data.session
    ) as client:
        candidates = await search_candidates(
            client,
            data.title,
            data.original_title,
            data.year
        )

        if not candidates:
            raise HTTPException(
                404,
                "На HDRezka ничего не найдено"
            )

        best = candidates[0]

        # Не выбираем рандомный фильм.
        # Если совпадение слабое, Lampa покажет список пользователю.
        auto_select = (
            best["score"] >= 0.78 or
            (
                best["score"] >= 0.70 and
                data.year and
                best.get("year") == data.year
            )
        )

        if not auto_select:
            return {
                "ok": True,
                "select": True,
                "results": candidates[:8]
            }

        details = await build_details(
            client,
            best["url"]
        )

        return {
            "ok": True,
            "select": False,
            "match": best,
            "details": details
        }


@app.post("/api/details")
async def api_details(
    data: DetailsRequest
):
    async with client_from_session(
        data.session
    ) as client:
        details = await build_details(
            client,
            data.url
        )

        return {
            "ok": True,
            "details": details
        }


@app.post("/api/episodes")
async def api_episodes(
    data: EpisodesRequest
):
    async with client_from_session(
        data.session
    ) as client:
        player = await client.player(
            data.url
        )

        if not isinstance(
            player,
            PlayerSeries
        ):
            return {
                "ok": True,
                "seasons": [],
                "episodes": []
            }

        payload = await client.ajax.get_episodes(
            player.post.id,
            data.translator_id
        )

        seasons, episodes = parse_episodes_payload(
            payload
        )

        return {
            "ok": True,
            "seasons": seasons,
            "episodes": episodes
        }


@app.post("/api/stream")
async def api_stream(
    data: StreamRequest
):
    async with client_from_session(
        data.session
    ) as client:
        player = await client.player(
            data.url
        )

        if isinstance(
            player,
            PlayerSeries
        ):
            if (
                data.season is None or
                data.episode is None
            ):
                raise HTTPException(
                    400,
                    "Для сериала не указан сезон/эпизод"
                )

            streams = await player.get_stream(
                data.season,
                data.episode,
                data.translator_id
            )
        else:
            streams = await player.get_stream(
                data.translator_id
            )

        result = streams_to_json(
            streams
        )

        return {
            "ok": True,
            **result
        }
