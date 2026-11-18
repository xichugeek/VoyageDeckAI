from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.config import Mode
from app.providers import Draft

Agent = Literal["scout", "lister", "creator", "ads", "service", "fulfillment"]
Status = Literal["running", "succeeded", "failed", "interrupted"]
Decision = Literal["approved", "rejected"]


class AgentInfo(BaseModel):
    id: Agent
    name: str
    label: str


AGENTS = [
    AgentInfo(id="scout", name="选品官", label="Scout"),
    AgentInfo(id="lister", name="上架官", label="Lister"),
    AgentInfo(id="creator", name="内容官", label="Creator"),
    AgentInfo(id="ads", name="投流官", label="Ads"),
    AgentInfo(id="service", name="客服官", label="Service"),
    AgentInfo(id="fulfillment", name="履约官", label="Fulfillment"),
]


class AgentList(BaseModel):
    agents: list[AgentInfo]


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=256)


class SessionStatus(BaseModel):
    enabled: bool
    authenticated: bool


class InferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    agent: Agent
    context: str = Field(min_length=1, max_length=2400)
    request_id: UUID


class Output(Draft):
    id: UUID


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    decision: Decision
    note: str = Field(default="", max_length=480)


class Review(ReviewRequest):
    created_at: datetime


class Workflow(BaseModel):
    id: UUID
    task_id: UUID
    agent: Agent
    context: str
    status: Status
    provider_mode: Mode
    data_source: Literal["mock_simulated", "ai_generated_draft"]
    created_at: datetime
    updated_at: datetime
    output: Output | None
    failure: str | None
    review: Review | None


class WorkflowList(BaseModel):
    workflows: list[Workflow]


class Event(BaseModel):
    seq: int
    kind: str
    message: str
    created_at: datetime


class EventPage(BaseModel):
    events: list[Event]
    after: int
