import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field

from app.password import validate_hash


Mode = Literal["mock", "openai_compatible"]
_HOST = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}\Z")
_PATH = re.compile(r"[A-Za-z0-9/_.-]*\Z")


class ProviderSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    mode: Mode = "mock"
    endpoint: str = Field(default="", max_length=300)
    model: str = Field(default="mock-v1", min_length=1, max_length=120, pattern=r"^[A-Za-z0-9._:/-]+$")
    timeout_seconds: int = Field(default=20, strict=True, ge=2, le=45)
    max_tokens: int = Field(default=1000, strict=True, ge=150, le=2400)


class ProviderStatus(ProviderSettings):
    key_configured: bool


def normalize_endpoint(value: str) -> str:
    if not value:
        return ""
    if any(ch.isspace() or ord(ch) < 32 for ch in value):
        raise ValueError("Provider endpoint must be a public HTTPS base URL")
    parts = urlsplit(value)
    hostname = parts.hostname or ""
    if (
        parts.scheme != "https" or not _HOST.fullmatch(hostname)
        or hostname.endswith((".localhost", ".local", ".internal", ".test", ".invalid"))
        or parts.netloc.lower() not in (hostname, f"{hostname}:443")
        or parts.query or parts.fragment or "?" in value or "#" in value
        or not _PATH.fullmatch(parts.path)
        or any(segment in (".", "..") for segment in parts.path.split("/"))
    ):
        raise ValueError("Provider endpoint must be a public HTTPS base URL")
    return f"https://{hostname}{parts.path.rstrip('/')}"


@dataclass(frozen=True)
class Settings:
    db_path: Path
    password_hash: str = ""
    secure_cookie: bool = True
    api_key: str = ""
    allowed_endpoint: str = ""
    initial_provider: ProviderSettings = field(default_factory=ProviderSettings)

    @classmethod
    def from_env(cls) -> "Settings":
        password_hash = os.getenv("VOYAGEDECK_ADMIN_PASSWORD_HASH", "")
        if password_hash:
            validate_hash(password_hash)
        api_key = os.getenv("VOYAGEDECK_PROVIDER_API_KEY", "").strip()
        endpoint_value = os.getenv("VOYAGEDECK_PROVIDER_ENDPOINT", "").strip()
        model = os.getenv("VOYAGEDECK_PROVIDER_MODEL", "mock-v1")
        mode = os.getenv("VOYAGEDECK_PROVIDER_MODE", "mock")
        if api_key and any(api_key in value for value in (endpoint_value, model, mode)):
            raise ValueError("Provider API key must be configured only in its dedicated setting")
        try:
            endpoint = normalize_endpoint(endpoint_value)
            provider = ProviderSettings(mode=mode, endpoint=endpoint, model=model)
        except ValueError:
            raise ValueError("Invalid VoyageDeck provider configuration") from None
        return cls(
            db_path=Path(os.getenv("VOYAGEDECK_DB_PATH", "data/voyagedeck.sqlite3")),
            password_hash=password_hash,
            secure_cookie=os.getenv("VOYAGEDECK_INSECURE_COOKIE") != "1",
            api_key=api_key,
            allowed_endpoint=endpoint,
            initial_provider=provider,
        )
