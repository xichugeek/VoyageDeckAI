import asyncio
from pathlib import Path

import httpx
import pytest

from app.main import create_app


def test_same_origin_static_console_and_api(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "index.html").write_text("<title>VoyageDeck AI</title>", encoding="utf-8")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "console.js").write_text("console.log('online')", encoding="utf-8")
    monkeypatch.setenv("VOYAGEDECK_STATIC_DIR", str(tmp_path))
    monkeypatch.setenv("VOYAGEDECK_API_DOCS", "0")

    async def run() -> None:
        transport = httpx.ASGITransport(app=create_app())
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            index = await client.get("/")
            assert index.status_code == 200 and "VoyageDeck AI" in index.text
            assert index.headers["Cache-Control"] == "no-cache"
            static = await client.get("/assets/console.js")
            assert static.status_code == 200 and "javascript" in static.headers["Content-Type"]
            assert "immutable" in static.headers["Cache-Control"]
            assert (await client.get("/missions/replay")).text == index.text
            assert (await client.get("/assets/missing")).status_code == 404
            assert (await client.get("/api/health")).json()["status"] == "ok"
            for path in ("/api", "/api/docs", "/api/openapi.json", "/api/no-such-endpoint"):
                missing = await client.get(path)
                assert missing.status_code == 404, path
                assert missing.headers["Content-Type"] == "application/json"
                assert missing.headers["Cache-Control"] == "no-store"

    asyncio.run(run())
