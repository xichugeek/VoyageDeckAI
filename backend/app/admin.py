import asyncio
import logging
import secrets
import time
from collections import deque
from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.config import ProviderSettings, ProviderStatus, Settings, normalize_endpoint
from app.database import SESSION_AGE, Database
from app.password import verify_password
from app.providers import ProviderError, generate_draft
from app.schemas import (
    AGENTS, AgentList, EventPage, InferenceRequest, Login, Output, ReviewRequest,
    SessionStatus, Workflow, WorkflowList,
)


log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")
COOKIE = "voyagedeck_admin"


class RateLimit:
    def __init__(self, limit: int, seconds: int) -> None:
        self.limit = limit
        self.seconds = seconds
        self.attempts: deque[float] = deque()

    def check(self) -> None:
        timestamp = time.monotonic()
        while self.attempts and self.attempts[0] <= timestamp - self.seconds:
            self.attempts.popleft()
        if len(self.attempts) >= self.limit:
            retry = max(1, int(self.attempts[0] + self.seconds - timestamp) + 1)
            raise HTTPException(429, "操作太频繁，请稍后重试。", headers={"Retry-After": str(retry)})
        self.attempts.append(timestamp)


class AdminState:
    def __init__(self, config: Settings) -> None:
        self.config = config
        self.db = Database(config.db_path)
        self.login_rate = RateLimit(8, 300)
        self.inference_rate = RateLimit(8, 60)
        self.login_lock = asyncio.Lock()
        self.inference_lock = asyncio.Lock()
        self.stream_slots = asyncio.Semaphore(4)

    def status(self, request: Request) -> SessionStatus:
        token = request.cookies.get(COOKIE, "")
        enabled = bool(self.config.password_hash)
        authenticated = enabled and len(token) == 43 and self.db.has_session(token, self.config.password_hash)
        return SessionStatus(enabled=enabled, authenticated=authenticated)

    def provider(self) -> ProviderSettings:
        return self.db.provider(self.config.initial_provider)

    def provider_status(self, provider: ProviderSettings) -> ProviderStatus:
        values = provider.model_dump()
        if self.config.api_key:
            for field, replacement in (("endpoint", ""), ("model", "redacted")):
                if self.config.api_key in values[field]:
                    values[field] = replacement
        return ProviderStatus(**values, key_configured=bool(self.config.api_key))

    def reject_secret(self, text: str, request: Request) -> None:
        secrets_in_use = (self.config.api_key, self.config.password_hash, request.cookies.get(COOKIE, ""))
        if any(value and value in text for value in secrets_in_use):
            raise HTTPException(422, "输入包含已配置的凭据，请移除后重试。")


def get_state(request: Request) -> AdminState:
    return request.app.state.admin


State = Annotated[AdminState, Depends(get_state)]


def authenticated(request: Request, state: State) -> AdminState:
    if not state.status(request).authenticated:
        raise HTTPException(401, "请先登录管理员模式。")
    return state


Admin = Annotated[AdminState, Depends(authenticated)]


def require_cockpit_header(x_voyagedeck_request: Annotated[str | None, Header()] = None) -> None:
    if x_voyagedeck_request != "cockpit":
        raise HTTPException(403, "请求缺少同源操作标记。")


write = [Depends(require_cockpit_header)]


@router.get("/agents", tags=["system"])
async def agents() -> AgentList:
    return AgentList(agents=AGENTS)


@router.get("/admin/session", tags=["admin"])
async def session(request: Request, state: State) -> SessionStatus:
    return state.status(request)


@router.post("/admin/session", dependencies=write, tags=["admin"])
async def login(payload: Login, request: Request, response: Response, state: State) -> SessionStatus:
    if not state.config.password_hash:
        raise HTTPException(503, "请先在服务端初始化管理员口令。")
    if state.login_lock.locked():
        raise HTTPException(429, "登录正在处理，请稍后重试。")
    async with state.login_lock:
        state.login_rate.check()
        valid = await run_in_threadpool(verify_password, payload.password, state.config.password_hash)
    if not valid:
        raise HTTPException(401, "管理员口令无效。")
    previous = request.cookies.get(COOKIE, "")
    if len(previous) == 43:
        state.db.remove_session(previous)
    token = secrets.token_urlsafe(32)
    state.db.add_session(token, state.config.password_hash)
    response.set_cookie(
        COOKIE, token, max_age=SESSION_AGE, httponly=True, secure=state.config.secure_cookie,
        samesite="strict", path="/api",
    )
    return SessionStatus(enabled=True, authenticated=True)


@router.delete("/admin/session", dependencies=write, tags=["admin"])
async def logout(request: Request, response: Response, state: State) -> SessionStatus:
    token = request.cookies.get(COOKIE, "")
    if len(token) == 43:
        state.db.remove_session(token)
    response.delete_cookie(COOKIE, httponly=True, secure=state.config.secure_cookie, samesite="strict", path="/api")
    return SessionStatus(enabled=bool(state.config.password_hash), authenticated=False)


@router.get("/settings/provider", tags=["provider"])
async def provider(state: Admin) -> ProviderStatus:
    return state.provider_status(state.provider())


@router.put("/settings/provider", dependencies=write, tags=["provider"])
async def update_provider(payload: ProviderSettings, request: Request, state: Admin) -> ProviderStatus:
    state.reject_secret(payload.endpoint, request)
    state.reject_secret(payload.model, request)
    try:
        endpoint = normalize_endpoint(payload.endpoint)
    except ValueError:
        raise HTTPException(422, "模型端点必须使用获准的 HTTPS 基础地址。") from None
    if endpoint and endpoint != state.config.allowed_endpoint:
        raise HTTPException(422, "端点未获批准，请先在服务端配置。")
    if payload.mode == "openai_compatible" and not endpoint:
        raise HTTPException(422, "真实推理需要获准的服务端 HTTPS 基础地址。")
    saved = payload.model_copy(update={"endpoint": endpoint})
    state.db.update_provider(saved)
    return state.provider_status(saved)


@router.post("/admin/inferences", dependencies=write, tags=["workflows"])
async def inference(payload: InferenceRequest, request: Request, state: Admin) -> Workflow:
    state.reject_secret(payload.context, request)
    replay = state.db.get_by_request(payload)
    if replay:
        return replay
    if state.inference_lock.locked():
        raise HTTPException(429, "已有推理正在执行，请在其结束后重试。")
    async with state.inference_lock:
        state.inference_rate.check()
        settings = state.provider()
        workflow_id = state.db.start(payload, settings)
        try:
            if settings.mode == "openai_compatible" and (
                not settings.endpoint or settings.endpoint != state.config.allowed_endpoint
                or not state.config.api_key or state.config.api_key in settings.model
                or state.config.api_key in settings.endpoint
            ):
                raise ProviderError("configuration", "模型端点或服务端 API Key 尚未配置或已失效。")
            draft = await generate_draft(
                payload.agent, payload.context, mode=settings.mode, endpoint=settings.endpoint,
                model=settings.model, timeout_seconds=settings.timeout_seconds, max_tokens=settings.max_tokens,
                api_key=state.config.api_key,
            )
        except ProviderError as exc:
            return state.db.finish(workflow_id, failure=str(exc))
        except asyncio.CancelledError:
            state.db.interrupt(workflow_id)
            raise
        except Exception:
            log.error("Unexpected provider error for workflow %s", workflow_id)
            return state.db.finish(workflow_id, failure="模型推理异常，未产生草稿。")
        return state.db.finish(workflow_id, draft=draft)


@router.get("/workflows", tags=["workflows"])
async def workflows(
    state: Admin, limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0, le=1000)] = 0,
) -> WorkflowList:
    return WorkflowList(workflows=state.db.list_workflows(limit, offset))


@router.get("/workflows/{workflow_id}", tags=["workflows"])
async def workflow(workflow_id: UUID, state: Admin) -> Workflow:
    return state.db.workflow(workflow_id)


@router.get("/outputs/{output_id}", tags=["workflows"])
async def output(output_id: UUID, state: Admin) -> Output:
    return state.db.output(output_id)


@router.post("/workflows/{workflow_id}/approve", dependencies=write, tags=["workflows"])
async def approve(workflow_id: UUID, payload: ReviewRequest, request: Request, state: Admin) -> Workflow:
    state.reject_secret(payload.note, request)
    return state.db.review(workflow_id, payload)


@router.get("/workflows/{workflow_id}/events", tags=["events"])
async def events(
    workflow_id: UUID, state: Admin, after: Annotated[int, Query(ge=0, le=1000000)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
) -> EventPage:
    return state.db.events(workflow_id, after, limit)


@router.get("/events/stream", tags=["events"], response_class=StreamingResponse)
async def stream(
    workflow_id: UUID, request: Request, state: Admin, after: Annotated[int, Query(ge=0, le=1000000)] = 0,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    if last_event_id is not None:
        if len(last_event_id) > 7 or not last_event_id.isascii() or not last_event_id.isdecimal():
            raise HTTPException(400, "无效的事件游标。")
        after = int(last_event_id)
    state.db.workflow(workflow_id)
    if state.stream_slots.locked():
        raise HTTPException(429, "实时连接数已达上限，可使用事件历史。")
    async def chunks() -> AsyncIterator[str]:
        cursor = after
        deadline = time.monotonic() + 30
        if state.stream_slots.locked():
            return
        async with state.stream_slots:
            yield "retry: 1200\n\n"
            while time.monotonic() < deadline and not await request.is_disconnected():
                if not state.status(request).authenticated:
                    break
                page = state.db.events(workflow_id, cursor)
                for item in page.events:
                    yield f"id: {item.seq}\ndata: {item.model_dump_json()}\n\n"
                if not page.events:
                    yield ": heartbeat\n\n"
                cursor = page.after
                await asyncio.sleep(1)

    return StreamingResponse(
        chunks(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no", "Cache-Control": "no-store"},
    )
