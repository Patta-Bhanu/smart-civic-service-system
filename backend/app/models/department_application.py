from sqlalchemy import Column, DateTime, Float, Integer, String, Text
from sqlalchemy.sql import func
from app.core.database import Base


class DepartmentApplication(Base):
    __tablename__ = "department_applications"

    id = Column(Integer, primary_key=True, index=True)
    applicant_name = Column(String(100), nullable=False)
    department_name = Column(String(100), nullable=False)
    category = Column(String(100), nullable=False)
    phone = Column(String(30), nullable=False)
    address = Column(String(500), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    review_reason = Column(Text, nullable=True)
    reviewed_by = Column(Integer, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
