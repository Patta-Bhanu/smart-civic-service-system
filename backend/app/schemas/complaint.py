
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ComplaintCreate(BaseModel):
    title: str = Field(min_length=3, max_length=150)
    description: str | None = None
    category: str = Field(min_length=2, max_length=100)
    latitude: float | None = None
    longitude: float | None = None
    address: str | None = None


class ComplaintResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    department_id: int | None
    title: str
    description: str | None
    category: str
    latitude: float | None
    longitude: float | None
    address: str | None
    audio_url: str | None
    photo_url: str | None
    status: str
    support_count: int = 0
    is_archived: bool = False
    archived_reason: str | None = None
    due_at: datetime | None = None
    escalated_at: datetime | None = None
    distance_km: float | None = None
    created_at: datetime
    updated_at: datetime


class ComplaintStatusUpdate(BaseModel):
    status: str = Field(
        pattern="^(assigned|in_progress|resolved|rejected)$"
    )
    note: str | None = Field(default=None, max_length=500)


class ComplaintStatusHistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    complaint_id: int
    changed_by: int | None
    old_status: str | None
    new_status: str
    note: str | None
    created_at: datetime


class AssignComplaintRequest(BaseModel):
    department_id: int
