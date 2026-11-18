import asyncio
import json
import secrets
import socket
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
import uvicorn

from app import admin
from app.config import ProviderSettings, Settings, normalize_endpoint
from app.main import create_app
from app.password import hash_password
from app.providers import generate_draft
from app.schemas import InferenceRequest

WRITE = {"X-VoyageDeck-Request": "cockpit"}
TEST_PASSWORD = secrets.token_urlsafe(24)
TEST_KEY = secrets.token_urlsafe(24)


@pytest.fixture(scope="module")
def encoded_password() -> str:
    return hash_password(TEST_PASSWORD)


@asynccontextmanager
async def client_for(settings: Settings):
    app = create_app(settings)
    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://cockpit.test",
    ) as client:
        yield app, client


async def login(client: httpx.AsyncClient) -> httpx.Response:
    response = await client.post("/api/admin/session", json={"password": TEST_PASSWORD}, headers=WRITE)
    assert response.status_code == 200, response.text
    assert response.json() == {"authenticated": True, "enabled": True}
    return response


def new_inference(context: str = "模拟北美旅行收纳配件，整理三项需求。") -> dict[str, str]:
    return {"agent": "scout", "context": context, "request_id": str(uuid4())}


def test_admin_disabled_and_anonymous_permissions(tmp_path: Path) -> None:
    async def run() -> None:
        async with client_for(Settings(db_path=tmp_path / "data.sqlite")) as (_, client):
            response = await client.get("/api/admin/session")
            assert response.json() == {"authenticated": False, "enabled": False}
            assert len((await client.get("/api/agents")).json()["agents"]) == 6
            for path in (
                "/api/workflows", f"/api/workflows/{uuid4()}", f"/api/outputs/{uuid4()}", "/api/settings/provider",
                f"/api/workflows/{uuid4()}/events", f"/api/events/stream?workflow_id={uuid4()}",
            ):
                result = await client.get(path)
                assert result.status_code == 401, path
                assert result.headers["Cache-Control"] == "no-store"
            assert (await client.post("/api/admin/inferences", json=new_inference(), headers=WRITE)).status_code == 401
            assert (await client.post("/api/admin/session", json={"password": TEST_PASSWORD}, headers=WRITE)).status_code == 503

    asyncio.run(run())


def test_cookie_csrf_rate_and_no_validation_echo(tmp_path: Path, encoded_password: str) -> None:
    async def run() -> None:
        async with client_for(Settings(db_path=tmp_path / "data.sqlite", password_hash=encoded_password)) as (app, client):
            assert (await client.post("/api/admin/session", json={"password": TEST_PASSWORD})).status_code == 403
            bad = TEST_PASSWORD * 40
            invalid = await client.post("/api/admin/session", json={"password": bad}, headers=WRITE)
            assert invalid.status_code == 422 and TEST_PASSWORD not in invalid.text
            big = await client.post("/api/admin/session", content=b"x" * 20_000, headers=WRITE)
            assert big.status_code == 413
            response = await login(client)
            header = response.headers["Set-Cookie"].lower()
            assert all(flag in header for flag in ("httponly", "secure", "samesite=strict"))
            token = response.cookies[admin.COOKIE]
            assert token.encode() not in b"".join(p.read_bytes() for p in tmp_path.iterdir() if p.is_file())
            assert (await client.put("/api/settings/provider", json=ProviderSettings().model_dump())).status_code == 403
            signed_out = await client.delete("/api/admin/session", headers=WRITE)
            assert signed_out.json()["authenticated"] is False
            with_cookie = {"Cookie": f"{admin.COOKIE}={token}"}
            assert (await client.get("/api/workflows", headers=with_cookie)).status_code == 401
            app.state.admin.login_rate.limit = 2
            wrong = await client.post("/api/admin/session", json={"password": "invalid"}, headers=WRITE)
            assert wrong.status_code == 401
            throttled = await client.post("/api/admin/session", json={"password": TEST_PASSWORD}, headers=WRITE)
            assert throttled.status_code == 429 and int(throttled.headers["Retry-After"]) > 0

    asyncio.run(run())


def test_persistence_review_idempotency_and_sequential_events(tmp_path: Path, encoded_password: str) -> None:
    async def run() -> None:
        settings = Settings(db_path=tmp_path / "data.sqlite", password_hash=encoded_password)
        async with client_for(settings) as (_, client):
            await login(client)
            payload = new_inference()
            submitted = await client.post("/api/admin/inferences", json=payload, headers=WRITE)
            assert submitted.status_code == 200, submitted.text
            workflow = submitted.json()
            assert workflow["status"] == "succeeded" and workflow["data_source"] == "mock_simulated"
            assert workflow["id"] != workflow["task_id"] and workflow["failure"] is None
            assert workflow["output"]["sections"]
            path = f"/api/workflows/{workflow['id']}"
            assert (await client.get(f"/api/outputs/{workflow['output']['id']}")).json() == workflow["output"]
            replay = await client.post("/api/admin/inferences", json=payload, headers=WRITE)
            assert replay.json() == workflow
            wrong_payload = {**payload, "context": "另一项任务"}
            assert (await client.post("/api/admin/inferences", json=wrong_payload, headers=WRITE)).status_code == 409
            approval = {"decision": "approved", "note": "稿件复核通过"}
            decided = (await client.post(f"{path}/approve", json=approval, headers=WRITE)).json()
            assert decided["review"]["note"] == approval["note"]
            assert (await client.post(f"{path}/approve", json=approval, headers=WRITE)).json() == decided
            rejected = await client.post(f"{path}/approve", json={"decision": "rejected"}, headers=WRITE)
            assert rejected.status_code == 409
            events = (await client.get(f"{path}/events")).json()
            assert events["after"] == 3
            assert [(e["seq"], e["kind"]) for e in events["events"]] == [(1, "started"), (2, "succeeded"), (3, "approved")]
            page = (await client.get(f"{path}/events?after=1&limit=1")).json()
            assert page["events"][0]["seq"] == page["after"] == 2
            assert (await client.get("/api/workflows")).json() == {"workflows": [decided]}

        async with client_for(settings) as (_, client):
            await login(client)
            assert (await client.get(path)).json() == decided

    asyncio.run(run())


def test_provider_preconditions_and_failure_without_fabrication(tmp_path: Path, encoded_password: str) -> None:
    async def run() -> None:
        settings = Settings(
            db_path=tmp_path / "data.sqlite", password_hash=encoded_password,
            allowed_endpoint="https://api.example.com/v1",
        )
        async with client_for(settings) as (_, client):
            await login(client)
            prepared = ProviderSettings(
                mode="openai_compatible", model="example-model", endpoint="https://api.example.com/v1/",
            ).model_dump()
            for endpoint in ("https://10.0.0.1/v1", "https://different.example.com/v1", "https://api.example.com/v1?q=1"):
                blocked = await client.put("/api/settings/provider", json={**prepared, "endpoint": endpoint}, headers=WRITE)
                assert blocked.status_code == 422
            setting = await client.put("/api/settings/provider", json=prepared, headers=WRITE)
            assert setting.json() == {**prepared, "endpoint": "https://api.example.com/v1", "key_configured": False}
            failed = (await client.post("/api/admin/inferences", json=new_inference(), headers=WRITE)).json()
            assert failed["status"] == "failed" and failed["output"] is None
            assert "API Key" in failed["failure"]
            assert failed["data_source"] == "ai_generated_draft"

        async with client_for(settings) as (_, client):
            await login(client)
            assert (await client.get("/api/settings/provider")).json()["mode"] == "openai_compatible"

    asyncio.run(run())


def test_http_provider_contract_and_secret_redaction(tmp_path: Path, encoded_password: str, monkeypatch) -> None:
    api_calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == f"Bearer {TEST_KEY}"
        assert str(request.url) == "https://api.example.com/v1/chat/completions"
        api_calls.append(json.loads(request.content))
        draft = {"title": "模型草稿", "summary": "拟定旅行收纳定位", "sections": [{"heading": "人工复核", "items": ["核实材质"]}]}
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(draft)}}]})

    async def fake_transport(*args, **kwargs):
        return await generate_draft(*args, **kwargs, transport=httpx.MockTransport(upstream))

    monkeypatch.setattr(admin, "generate_draft", fake_transport)

    async def run() -> None:
        saved = ProviderSettings(mode="openai_compatible", endpoint="https://api.example.com/v1", model="example-model")
        settings = Settings(
            db_path=tmp_path / "data.sqlite", password_hash=encoded_password,
            api_key=TEST_KEY, allowed_endpoint=saved.endpoint, initial_provider=saved,
        )
        async with client_for(settings) as (_, client):
            await login(client)
            visible = await client.get("/api/settings/provider")
            assert visible.json()["key_configured"] is True and TEST_KEY not in visible.text
            refused = await client.post("/api/admin/inferences", json=new_inference(TEST_KEY), headers=WRITE)
            assert refused.status_code == 422 and TEST_KEY not in refused.text
            assert (await client.get("/api/workflows")).json() == {"workflows": []}
            payload = new_inference()
            result = (await client.post("/api/admin/inferences", json=payload, headers=WRITE)).json()
            assert result["status"] == "succeeded" and result["data_source"] == "ai_generated_draft"
            assert result["output"]["title"] == "模型草稿" and len(api_calls) == 1
            assert (await client.post("/api/admin/inferences", json=payload, headers=WRITE)).json() == result
            assert len(api_calls) == 1
            review = await client.post(
                f"/api/workflows/{result['id']}/approve", json={"decision": "approved", "note": TEST_KEY}, headers=WRITE,
            )
            assert review.status_code == 422 and TEST_KEY not in review.text
            assert TEST_KEY.encode() not in b"".join(p.read_bytes() for p in tmp_path.iterdir() if p.is_file())

    asyncio.run(run())


def test_startup_marks_abandoned_work_interrupted(tmp_path: Path, encoded_password: str) -> None:
    async def run() -> None:
        settings = Settings(db_path=tmp_path / "data.sqlite", password_hash=encoded_password)
        async with client_for(settings) as (app, _):
            pending = app.state.admin.db.start(InferenceRequest(**new_inference()), settings.initial_provider)
        async with client_for(settings) as (_, client):
            await login(client)
            path = f"/api/workflows/{pending}"
            record = (await client.get(path)).json()
            assert record["status"] == "interrupted" and record["output"] is None
            assert (await client.get(f"{path}/events?after=1")).json()["events"][0]["kind"] == "interrupted"

    asyncio.run(run())


def test_concurrent_inference_replay_does_not_duplicate_upstream(tmp_path: Path, encoded_password: str, monkeypatch) -> None:
    async def run() -> None:
        started, release = asyncio.Event(), asyncio.Event()
        calls = 0

        async def delayed(*args, **kwargs):
            nonlocal calls
            calls += 1
            started.set()
            await release.wait()
            return await generate_draft(*args, **kwargs)

        monkeypatch.setattr(admin, "generate_draft", delayed)
        settings = Settings(db_path=tmp_path / "data.sqlite", password_hash=encoded_password)
        async with client_for(settings) as (_, client):
            await login(client)
            payload = new_inference()
            active = asyncio.create_task(client.post("/api/admin/inferences", json=payload, headers=WRITE))
            try:
                await asyncio.wait_for(started.wait(), timeout=5)
                repeat = await client.post("/api/admin/inferences", json=payload, headers=WRITE)
                assert repeat.json()["status"] == "running"
                blocked = await client.post("/api/admin/inferences", json=new_inference(), headers=WRITE)
                assert blocked.status_code == 429
            finally:
                release.set()
                finished = await active
            assert finished.json()["id"] == repeat.json()["id"] and calls == 1
            assert finished.json()["status"] == "succeeded"

    asyncio.run(run())


def test_initial_provider_fields_never_echo_configured_key(monkeypatch) -> None:
    monkeypatch.setenv("VOYAGEDECK_ADMIN_PASSWORD_HASH", "")
    monkeypatch.setenv("VOYAGEDECK_PROVIDER_API_KEY", TEST_KEY)
    monkeypatch.setenv("VOYAGEDECK_PROVIDER_MODEL", TEST_KEY)
    with pytest.raises(ValueError, match="dedicated setting") as exc:
        Settings.from_env()
    assert TEST_KEY not in str(exc.value)


def test_sse_loopback_order_reconnection_and_polling(tmp_path: Path, encoded_password: str) -> None:
    async def run() -> None:
        app = create_app(Settings(db_path=tmp_path / "data.sqlite", password_hash=encoded_password, secure_cookie=False))
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            address, port = listener.getsockname()
            server = uvicorn.Server(uvicorn.Config(app, access_log=False, log_level="warning"))
            server_task = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async with asyncio.timeout(15):
                    while not server.started:
                        await asyncio.sleep(0.05)
                    async with httpx.AsyncClient(base_url=f"http://{address}:{port}", trust_env=False) as client:
                        await login(client)
                        result = (await client.post("/api/admin/inferences", json=new_inference(), headers=WRITE)).json()
                        url = f"/api/events/stream?workflow_id={result['id']}"
                        async with client.stream("GET", url) as first:
                            assert first.status_code == 200 and first.headers["content-type"].startswith("text/event-stream")
                            async for line in first.aiter_lines():
                                if line.startswith("id: "):
                                    assert line == "id: 1"
                                    break
                        async with client.stream("GET", url, headers={"Last-Event-ID": "1"}) as resumed:
                            async for line in resumed.aiter_lines():
                                if line.startswith("id: "):
                                    assert line == "id: 2"
                                    break
                        polled = (await client.get(f"/api/workflows/{result['id']}/events?after=1")).json()
                        assert [event["seq"] for event in polled["events"]] == [2]
            finally:
                server.should_exit = True
                await server_task

    asyncio.run(run())


@pytest.mark.parametrize("unsafe", ["http://api.example.com", "https://localhost", "https://127.0.0.1", "https://api.example.com:8443", "https://api.example.com/v1/../private", "https://trusted@example.com"])
def test_unsafe_base_addresses_refused(unsafe: str) -> None:
    with pytest.raises(ValueError):
        normalize_endpoint(unsafe)
