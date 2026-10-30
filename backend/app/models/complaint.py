
from sqlalchemy import (
    Column,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.sql import func

from app.core.database import Base


class Complaint(Base):
    __tablename__ = "complaints"

    id = Column(Integer, primary_key=True, index=True)

    # Citizen who submitted the complaint
    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True
    )

    # Assigned department; null means awaiting assignment
    department_id = Column(
        Integer,
        ForeignKey("departments.id"),
        nullable=True,
        index=True
    )

    title = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=False)

    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    address = Column(String(500), nullable=True)

    # Paths or URLs for uploaded files
    audio_url = Column(String(500), nullable=True)
    photo_url = Column(String(500), nullable=True)

    # submitted, assigned, in_progress, resolved, rejected
    support_count = Column(Integer, nullable=False, default=0, server_default="0")
    is_archived = Column(Boolean, nullable=False, default=False, server_default="false", index=True)
    archived_reason = Column(Text, nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=True, index=True)
    escalated_at = Column(DateTime(timezone=True), nullable=True)

    status = Column(
        String(30),
        nullable=False,
        default="submitted",
        index=True
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )
