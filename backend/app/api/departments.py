from datetime import datetime, timezone
from pydantic import BaseModel, EmailStr, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import hash_password, decode_access_token
from app.models.department import Department
from app.models.department_application import DepartmentApplication
from app.models.user import User
from app.models.audit_log import AuditLog
from app.models.complaint import Complaint
from app.services.notifications import audit
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

router = APIRouter(prefix="/departments", tags=["Departments"])
bearer_scheme = HTTPBearer(auto_error=False)


class DepartmentApplicationCreate(BaseModel):
    applicant_name: str = Field(min_length=2, max_length=100)
    department_name: str = Field(min_length=2, max_length=100)
    category: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=7, max_length=30)
    address: str = Field(min_length=3, max_length=500)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme), db: Session = Depends(get_db)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Sign in required")
    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        user_id = int(payload["sub"])
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


@router.post("/applications", status_code=201)
def submit_application(data: DepartmentApplicationCreate, db: Session = Depends(get_db)):
    email = str(data.email).lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="An account already uses this email")
    existing = db.query(DepartmentApplication).filter(
        DepartmentApplication.email == email,
        DepartmentApplication.status == "pending",
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="An application for this email is already pending")
    application = DepartmentApplication(
        applicant_name=data.applicant_name.strip(),
        department_name=data.department_name.strip(),
        category=data.category.strip(),
        phone=data.phone.strip(),
        address=data.address.strip(),
        email=email,
        hashed_password=hash_password(data.password),
        latitude=data.latitude,
        longitude=data.longitude,
        status="pending",
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    audit(db, None, "department_application_submitted", "department_application", application.id, f"Application from {email}")
    db.commit()
    return {"id": application.id, "status": application.status, "message": "Application submitted for authority approval"}


@router.get("")
def list_active_departments(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """List active departments for authority assignment controls."""
    if user.role != "authority":
        raise HTTPException(status_code=403, detail="Only authority users can list departments")
    rows = db.query(Department).filter(Department.is_active.is_(True)).order_by(Department.name.asc()).all()
    return [{"id": row.id, "name": row.name, "category": row.category, "description": row.description,
             "phone": row.phone, "address": row.address, "email": row.email,
             "latitude": row.latitude, "longitude": row.longitude,
             "service_radius_km": row.service_radius_km} for row in rows]


@router.get("/applications/mine")
def my_applications(email: str, db: Session = Depends(get_db)):
    # Intentionally returns only non-sensitive application state, not credentials.
    rows = db.query(DepartmentApplication).filter(DepartmentApplication.email == email.lower()).order_by(DepartmentApplication.created_at.desc()).all()
    return [{"id": row.id, "department_name": row.department_name, "category": row.category,
             "status": row.status, "review_reason": row.review_reason, "created_at": row.created_at}
            for row in rows]


@router.get("/mine")
def department_profile(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("department_staff", "department") or not user.department_id:
        raise HTTPException(status_code=403, detail="Department staff only")
    dept = db.query(Department).filter(Department.id == user.department_id).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    return {"id": dept.id, "name": dept.name, "description": dept.description, "category": dept.category,
            "phone": dept.phone, "address": dept.address, "email": dept.email,
            "latitude": dept.latitude, "longitude": dept.longitude}


@router.get("/reminders")
def department_reminders(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("department_staff", "department") or not user.department_id:
        raise HTTPException(status_code=403, detail="Department staff only")
    rows = (db.query(AuditLog, Complaint)
            .join(Complaint, AuditLog.entity_id == Complaint.id)
            .filter(AuditLog.action == "department_reminder_sent", Complaint.department_id == user.department_id)
            .order_by(AuditLog.created_at.desc()).limit(50).all())
    return [{"id": log.id, "complaint_id": complaint.id, "title": complaint.title,
             "message": log.details, "created_at": log.created_at} for log, complaint in rows]
