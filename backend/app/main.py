from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.admin import AdminState, router
from app.config import Settings
from app.database import Capacity, Conflict, Missing


class Health(BaseModel):
    status: str = "ok"
    service: str = "voyagedeck-ai"


class APIProtection:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def send_private(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [(key, value) for key, value in message["headers"] if key != b"cache-control"]
                headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        if scope["method"] not in ("POST", "PUT", "DELETE"):
            await self.app(scope, receive, send_private)
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > 16_384:
                response = JSONResponse({"detail": "请求内容超过大小上限。"}, status_code=413)
                await response(scope, receive, send_private)
                return
            if not message.get("more_body"):
                break

        delivered = False

        async def replay_once() -> Message:
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay_once, send_private)


def create_app(config: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(instance: FastAPI):
        state = AdminState(config or Settings.from_env())
        state.db.initialize()
        instance.state.admin = state
        yield

    app = FastAPI(
        title="VoyageDeck AI",
        version="0.1.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.add_middleware(APIProtection)
    app.include_router(router)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"detail": "请求字段不符合接口约束。"}, status_code=422)

    @app.exception_handler(Conflict)
    async def conflict(_request: Request, exc: Conflict) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(Missing)
    async def missing(_request: Request, _exc: Missing) -> JSONResponse:
        return JSONResponse({"detail": "没有找到请求的记录。"}, status_code=404)

    @app.exception_handler(Capacity)
    async def capacity(_request: Request, _exc: Capacity) -> JSONResponse:
        return JSONResponse({"detail": "已达到持久化工作流上限。"}, status_code=409)

    @app.get("/api/health", tags=["system"])
    async def health() -> Health:
        return Health()

    return app


app = create_app()
