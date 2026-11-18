import asyncio

import httpx

from app.main import create_app


async def request(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


def test_health() -> None:
    response = asyncio.run(request("/api/health"))
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "voyagedeck-ai"}


def test_openapi() -> None:
    response = asyncio.run(request("/api/openapi.json"))
    assert response.status_code == 200
    assert "/api/health" in response.json()["paths"]
