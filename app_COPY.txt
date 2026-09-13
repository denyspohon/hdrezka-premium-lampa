from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, PlainTextResponse

APP_VERSION = "7.0.0"
BASE = Path(__file__).resolve().parent
PLUGIN = BASE / "plugin.js"

app = FastAPI(title="HDREZKA DENYS Adapter", version=APP_VERSION)


@app.get("/health")
async def health():
    return {
        "ok": True,
        "version": APP_VERSION,
        "mode": "online-mod-adapter",
        "rezka_network_in_denys": False,
        "engine": "nb557 Online Mod / rezka2",
    }


@app.get("/plugin.js")
async def plugin_js():
    return PlainTextResponse(
        PLUGIN.read_text(encoding="utf-8"),
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
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HDREZKA Premium • by DENYS</title>
<body style="font-family:Arial;background:#111;color:#fff;padding:30px">
<div style="max-width:760px;margin:auto;background:#1d2027;padding:28px;border-radius:18px">
<h1>HDREZKA Premium • by DENYS</h1>
<p>v{APP_VERSION} • Online Mod adapter</p>
<p>Эта версия не содержит своего HDRezka parser/proxy/player.</p>
<p>Она принудительно запускает источник <b>rezka2</b> установленного Online Mod.</p>
<code style="display:block;padding:14px;background:#0d0f13;border-radius:10px;word-break:break-all">https://hdrezka-premium-lampa.onrender.com/plugin.js?v=70</code>
</div>
</body></html>"""
    )
