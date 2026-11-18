from pathlib import Path
import os
import sys

import uvicorn

FRONTEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(FRONTEND.parent / "backend"))
from app.password import hash_password


def main() -> None:
    password = os.environ.pop("VOYAGEDECK_E2E_SYNTHETIC_PASSWORD")
    for name in list(os.environ):
        if name.startswith("VOYAGEDECK_"):
            del os.environ[name]

    os.environ.update(
        VOYAGEDECK_ADMIN_PASSWORD_HASH=hash_password(password),
        VOYAGEDECK_INSECURE_COOKIE="1",
        VOYAGEDECK_DB_PATH=str(FRONTEND / ".local" / "admin-e2e-tests" / "admin.sqlite"),
    )
    uvicorn.run("app.main:app", host="127.0.0.1", port=8291, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
