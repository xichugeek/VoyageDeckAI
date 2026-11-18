import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from uuid import UUID, uuid4

from app.config import ProviderSettings
from app.providers import Draft
from app.schemas import (
    Event,
    EventPage,
    InferenceRequest,
    Output,
    Review,
    ReviewRequest,
    Workflow,
)

WORKFLOW_LIMIT = 1000
SESSION_AGE = 8 * 60 * 60


def now() -> str:
    return datetime.now(UTC).isoformat()


def digest(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


class Conflict(Exception):
    pass


class Missing(Exception):
    pass


class Capacity(Exception):
    pass


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    @contextmanager
    def connect(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=2.0, isolation_level=None)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            if write:
                connection.commit()
        except BaseException:
            if write:
                connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS admin_sessions (
                    token_hash TEXT PRIMARY KEY, credential_version TEXT NOT NULL,
                    created_at TEXT NOT NULL, expires_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS provider_settings (
                    id INTEGER PRIMARY KEY CHECK(id = 1), settings TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workflows (
                    id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, task_id TEXT UNIQUE NOT NULL,
                    agent TEXT NOT NULL, context TEXT NOT NULL, status TEXT NOT NULL,
                    provider_mode TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                    output_id TEXT UNIQUE, output TEXT, failure TEXT, review TEXT
                );
                CREATE INDEX IF NOT EXISTS workflow_created ON workflows(created_at);
                CREATE TABLE IF NOT EXISTS workflow_events (
                    workflow_id TEXT NOT NULL REFERENCES workflows(id), seq INTEGER NOT NULL,
                    kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY(workflow_id, seq)
                );
            """)
        with self.connect(write=True) as connection:
            abandoned = connection.execute("SELECT id FROM workflows WHERE status = 'running'").fetchall()
            for record in abandoned:
                self._interrupt(connection, record["id"], "服务重启时任务尚未完成，已标记为中断。")

    def add_session(self, token: str, password_hash: str) -> None:
        timestamp = datetime.now(UTC)
        with self.connect(write=True) as connection:
            connection.execute("DELETE FROM admin_sessions WHERE expires_at <= ?", (timestamp.isoformat(),))
            connection.execute(
                """INSERT INTO admin_sessions(token_hash, credential_version, created_at, expires_at)
                   VALUES (?, ?, ?, ?)""",
                (digest(token), digest(password_hash), timestamp.isoformat(),
                 (timestamp + timedelta(seconds=SESSION_AGE)).isoformat()),
            )
            connection.execute(
                """DELETE FROM admin_sessions WHERE token_hash IN (
                       SELECT token_hash FROM admin_sessions ORDER BY created_at DESC LIMIT -1 OFFSET 12
                   )"""
            )

    def has_session(self, token: str, password_hash: str) -> bool:
        with self.connect() as connection:
            return connection.execute(
                """SELECT 1 FROM admin_sessions
                   WHERE token_hash = ? AND credential_version = ? AND expires_at > ?""",
                (digest(token), digest(password_hash), now()),
            ).fetchone() is not None

    def remove_session(self, token: str) -> None:
        with self.connect(write=True) as connection:
            connection.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (digest(token),))

    def provider(self, fallback: ProviderSettings) -> ProviderSettings:
        with self.connect() as connection:
            row = connection.execute("SELECT settings FROM provider_settings WHERE id = 1").fetchone()
            return ProviderSettings.model_validate_json(row["settings"]) if row else fallback

    def update_provider(self, provider: ProviderSettings) -> None:
        with self.connect(write=True) as connection:
            connection.execute(
                """INSERT INTO provider_settings(id, settings) VALUES (1, ?)
                   ON CONFLICT(id) DO UPDATE SET settings = excluded.settings""",
                (provider.model_dump_json(),),
            )

    @staticmethod
    def _workflow(row: sqlite3.Row) -> Workflow:
        return Workflow(
            id=row["id"], task_id=row["task_id"], agent=row["agent"], context=row["context"],
            status=row["status"], provider_mode=row["provider_mode"],
            data_source="mock_simulated" if row["provider_mode"] == "mock" else "ai_generated_draft",
            created_at=row["created_at"], updated_at=row["updated_at"], failure=row["failure"],
            output=Output.model_validate_json(row["output"]) if row["output"] else None,
            review=Review.model_validate_json(row["review"]) if row["review"] else None,
        )

    @staticmethod
    def _append(connection: sqlite3.Connection, workflow_id: str, kind: str, message: str, timestamp: str) -> None:
        connection.execute(
            """INSERT INTO workflow_events(workflow_id, seq, kind, message, created_at)
               VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM workflow_events WHERE workflow_id = ?), ?, ?, ?)""",
            (workflow_id, workflow_id, kind, message, timestamp),
        )

    @staticmethod
    def _select(connection: sqlite3.Connection, workflow_id: str) -> sqlite3.Row:
        row = connection.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
        if row is None:
            raise Missing
        return row

    def workflow(self, workflow_id: UUID) -> Workflow:
        with self.connect() as connection:
            return self._workflow(self._select(connection, str(workflow_id)))

    def output(self, output_id: UUID) -> Output:
        with self.connect() as connection:
            row = connection.execute("SELECT output FROM workflows WHERE output_id = ?", (str(output_id),)).fetchone()
            if row is None:
                raise Missing
            return Output.model_validate_json(row["output"])

    def list_workflows(self, limit: int, offset: int) -> list[Workflow]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM workflows ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", (limit, offset),
            ).fetchall()
            return [self._workflow(row) for row in rows]

    def get_by_request(self, payload: InferenceRequest) -> Workflow | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM workflows WHERE request_id = ?", (str(payload.request_id),),
            ).fetchone()
            if row is None:
                return None
            if row["agent"] != payload.agent or row["context"] != payload.context:
                raise Conflict("请求编号已用于不同的推理任务。")
            return self._workflow(row)

    def start(self, payload: InferenceRequest, provider: ProviderSettings) -> UUID:
        timestamp = now()
        workflow_id = uuid4()
        with self.connect(write=True) as connection:
            if connection.execute("SELECT COUNT(*) FROM workflows").fetchone()[0] >= WORKFLOW_LIMIT:
                raise Capacity
            connection.execute(
                """INSERT INTO workflows(id, request_id, task_id, agent, context, status,
                                         provider_mode, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)""",
                (str(workflow_id), str(payload.request_id), str(uuid4()), payload.agent,
                 payload.context, provider.mode, timestamp, timestamp),
            )
            self._append(connection, str(workflow_id), "started", "已开始生成岗位草稿。", timestamp)
        return workflow_id

    def finish(self, workflow_id: UUID, *, draft: Draft | None = None, failure: str | None = None) -> Workflow:
        record_id = str(workflow_id)
        timestamp = now()
        output = Output(id=uuid4(), **draft.model_dump()) if draft else None
        status = "succeeded" if output else "failed"
        with self.connect(write=True) as connection:
            changed = connection.execute(
                """UPDATE workflows SET status = ?, output_id = ?, output = ?, failure = ?, updated_at = ?
                   WHERE id = ? AND status = 'running'""",
                (status, str(output.id) if output else None, output.model_dump_json() if output else None,
                 failure, timestamp, record_id),
            ).rowcount
            if changed:
                message = "岗位草稿已生成，等待人工审阅。" if output else (failure or "生成失败。")
                self._append(connection, record_id, status, message, timestamp)
            return self._workflow(self._select(connection, record_id))

    def _interrupt(self, connection: sqlite3.Connection, workflow_id: str, reason: str) -> None:
        timestamp = now()
        changed = connection.execute(
            """UPDATE workflows SET status = 'interrupted', failure = ?, updated_at = ?
               WHERE id = ? AND status = 'running'""", (reason, timestamp, workflow_id),
        ).rowcount
        if changed:
            self._append(connection, workflow_id, "interrupted", reason, timestamp)

    def interrupt(self, workflow_id: UUID) -> None:
        with self.connect(write=True) as connection:
            self._interrupt(connection, str(workflow_id), "推理请求中断，任务未产生草稿。")

    def review(self, workflow_id: UUID, payload: ReviewRequest) -> Workflow:
        record_id = str(workflow_id)
        timestamp = datetime.now(UTC)
        with self.connect(write=True) as connection:
            workflow = self._workflow(self._select(connection, record_id))
            if workflow.status != "succeeded":
                raise Conflict("只有已生成的岗位草稿可以审阅。")
            if workflow.review:
                if (workflow.review.decision, workflow.review.note) == (payload.decision, payload.note):
                    return workflow
                raise Conflict("这份草稿已有审阅记录。")
            review = Review(created_at=timestamp, **payload.model_dump())
            connection.execute(
                "UPDATE workflows SET review = ?, updated_at = ? WHERE id = ?",
                (review.model_dump_json(), timestamp.isoformat(), record_id),
            )
            message = "人工批准草稿。" if payload.decision == "approved" else "人工驳回草稿。"
            self._append(connection, record_id, payload.decision, message, timestamp.isoformat())
            return self._workflow(self._select(connection, record_id))

    def events(self, workflow_id: UUID, after: int, limit: int = 100) -> EventPage:
        with self.connect() as connection:
            self._select(connection, str(workflow_id))
            rows = connection.execute(
                """SELECT seq, kind, message, created_at FROM workflow_events
                   WHERE workflow_id = ? AND seq > ? ORDER BY seq LIMIT ?""", (str(workflow_id), after, limit),
            ).fetchall()
            events = [Event(**dict(row)) for row in rows]
            return EventPage(events=events, after=events[-1].seq if events else after)
