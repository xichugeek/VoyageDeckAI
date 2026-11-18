from fastapi import FastAPI
from pydantic import BaseModel


class Health(BaseModel):
    status: str = "ok"
    service: str = "voyagedeck-ai"


def create_app() -> FastAPI:
    app = FastAPI(
        title="VoyageDeck AI",
        version="0.1.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )

    @app.get("/api/health", tags=["system"])
    async def health() -> Health:
        return Health()

    return app


app = create_app()
