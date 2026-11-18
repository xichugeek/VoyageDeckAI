import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.admin import AdminState, router
from app.config import Settings
from app.database import Capacity, Conflict, Missing


class Health(BaseModel):
    status: str = "ok"
    service: str = "voyagedeck-ai"


class ConsoleFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope):
        web_path = Path(path).as_posix()
        is_asset = web_path == "assets" or web_path.startswith("assets/")
        if web_path == "api" or web_path.startswith("api/"):
            return JSONResponse({"detail": "没有找到请求的接口。"}, status_code=404)
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or is_asset or Path(path).suffix:
                raise
            response = await super().get_response("index.html", scope)
        response.headers["Cache-Control"] = (
            "public, max-age=31536000, immutable" if is_asset else "no-cache"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        return response


class APIProtection:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not (scope["path"] == "/api" or scope["path"].startswith("/api/")):
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

    show_docs = os.getenv("VOYAGEDECK_API_DOCS", "1") == "1"
    app = FastAPI(
        title="VoyageDeck AI",
        version="0.1.0",
        docs_url="/api/docs" if show_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if show_docs else None,
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

    static_dir = os.getenv("VOYAGEDECK_STATIC_DIR")
    if static_dir:
        app.mount("/", ConsoleFiles(directory=static_dir, html=True), name="console")

    return app


app = create_app()
