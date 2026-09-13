import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, PlainTextResponse, JSONResponse

APP_VERSION = "6.0.0"
AUTHOR = "DENYS"

BASE = Path(__file__).resolve().parent
PLUGIN = BASE / "plugin.js"

app = FastAPI(
    title="HDREZKA Premium • DENYS Edition",
    version=APP_VERSION,
)


@app.get("/health")
async def health():
    return {
        "ok": True,
        "version": APP_VERSION,
        "author": AUTHOR,
        "mode": "plugin-only",
        "rezka_backend": False,
        "note": "Render serves plugin only; HDRezka requests are made by Lampa/TV route.",
    }


@app.get("/plugin.js")
async def plugin_js():
    source = PLUGIN.read_text(encoding="utf-8")
    return PlainTextResponse(
        source,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.get("/")
async def root():
    return HTMLResponse(
        f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HDREZKA Premium • by DENYS</title>
<style>
body{{font-family:Arial,sans-serif;background:#111318;color:#fff;margin:0;padding:30px}}
.card{{max-width:760px;margin:auto;background:#1d2027;padding:28px;border-radius:18px}}
code{{display:block;background:#0d0f13;padding:14px;border-radius:10px;word-break:break-all}}
.ok{{color:#7ee787}}
</style>
</head>
<body>
<div class="card">
<h1>HDREZKA Premium • by DENYS</h1>
<p class="ok">v{APP_VERSION} • plugin-only architecture</p>
<p>Render больше не ходит на HDRezka. Он только раздаёт plugin.js.</p>
<p>Добавьте в обычную Lampa:</p>
<code>https://hdrezka-premium-lampa.onrender.com/plugin.js?v=60</code>
<p>Ваши Online Mod, Filmix и остальные плагины остаются в той же Lampa.</p>
</div>
</body>
</html>"""
    )
