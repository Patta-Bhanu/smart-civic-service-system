from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core.database import get_db
from app.core.security import decode_access_token, hash_password
from app.models.user import User
from app.models.department import Department
from app.models.department_application import DepartmentApplication
from app.models.complaint import Complaint
from app.models.complaint_update import ComplaintUpdate
from app.models.complaint_status_history import ComplaintStatusHistory
from app.models.audit_log import AuditLog
from app.crud.complaint import add_status_history
from app.services.notifications import audit, send_email, nearest_authority

router = APIRouter(prefix="/authority", tags=["Authority"])
bearer_scheme = HTTPBearer(auto_error=False)


class ReviewRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)

class DepartmentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    category: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    phone: str = Field(min_length=7, max_length=30)
    address: str = Field(min_length=3, max_length=500)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    service_radius_km: float = Field(default=10, gt=0, le=500)

class ReminderRequest(BaseModel):
    message: str = Field(min_length=3, max_length=1500)


def current_authority(credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme), db: Session = Depends(get_db)):
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
    if user.role != "authority":
        raise HTTPException(status_code=403, detail="Authority access required")
    return user


def _application_dict(row):
    return {"id": row.id, "applicant_name": row.applicant_name, "department_name": row.department_name,
            "category": row.category, "phone": row.phone, "address": row.address, "email": row.email,
            "latitude": row.latitude, "longitude": row.longitude, "status": row.status,
            "review_reason": row.review_reason, "created_at": row.created_at}


def _update_dict(row):
    return {"id": row.id, "complaint_id": row.complaint_id, "submitted_by": row.submitted_by,
            "message": row.message, "proposed_status": row.proposed_status, "photo_url": row.photo_url,
            "audio_url": row.audio_url, "status": row.status, "review_note": row.review_note,
            "created_at": row.created_at}


@router.get("/applications/pending")
def pending_applications(db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    return [_application_dict(x) for x in db.query(DepartmentApplication).filter(DepartmentApplication.status == "pending").order_by(DepartmentApplication.created_at.asc()).all()]


@router.post("/applications/{application_id}/approve")
def approve_application(application_id: int, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    app = db.query(DepartmentApplication).filter(DepartmentApplication.id == application_id).first()
    if not app: raise HTTPException(status_code=404, detail="Application not found")
    if app.status != "pending": raise HTTPException(status_code=409, detail="Application has already been reviewed")
    if db.query(User).filter(User.email == app.email).first(): raise HTTPException(status_code=409, detail="An account already uses this email")
    if db.query(Department).filter(Department.name == app.department_name).first(): raise HTTPException(status_code=409, detail="A department with this name already exists")
    dept = Department(name=app.department_name, description=app.category, category=app.category, phone=app.phone,
                      address=app.address, email=app.email, latitude=app.latitude, longitude=app.longitude,
                      service_radius_km=10.0, is_active=True)
    db.add(dept); db.flush()
    staff = User(full_name=app.applicant_name, email=app.email, phone=app.phone, address=app.address,
                 latitude=app.latitude, longitude=app.longitude, hashed_password=app.hashed_password,
                 role="department_staff", department_id=dept.id, is_active=True)
    db.add(staff)
    app.status = "approved"; app.reviewed_by = authority.id; app.reviewed_at = datetime.now(timezone.utc)
    audit(db, authority.id, "department_application_approved", "department_application", app.id, f"Created department {dept.name}")
    db.commit()
    send_email(app.email, "Smart Civic System department application approved",
               f"Hello {app.applicant_name},\n\nYour department application has been approved. You can now sign in through the Department Staff portal using this email and the password you provided.\n\nDepartment: {dept.name}\nCategory: {dept.category}\n")
    return {"message": "Application approved; department staff account created", "department_id": dept.id, "user_id": staff.id}


@router.post("/applications/{application_id}/reject")
def reject_application(application_id: int, request: ReviewRequest, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    app = db.query(DepartmentApplication).filter(DepartmentApplication.id == application_id).first()
    if not app: raise HTTPException(status_code=404, detail="Application not found")
    if app.status != "pending": raise HTTPException(status_code=409, detail="Application has already been reviewed")
    app.status = "rejected"; app.review_reason = request.reason or "Application rejected"; app.reviewed_by = authority.id; app.reviewed_at = datetime.now(timezone.utc)
    audit(db, authority.id, "department_application_rejected", "department_application", app.id, app.review_reason)
    db.commit()
    send_email(app.email, "Smart Civic System department application update", f"Your department application was not approved. Reason: {app.review_reason}")
    return {"message": "Application rejected"}


@router.post("/departments", status_code=201)
def create_department(data: DepartmentCreate, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    email = str(data.email).lower()
    if db.query(User).filter(User.email == email).first(): raise HTTPException(status_code=409, detail="An account already uses this email")
    if db.query(Department).filter(Department.name == data.name.strip()).first(): raise HTTPException(status_code=409, detail="Department name already exists")
    dept = Department(name=data.name.strip(), category=data.category.strip(), description=data.description,
                      phone=data.phone.strip(), address=data.address.strip(), email=email,
                      latitude=data.latitude, longitude=data.longitude, service_radius_km=data.service_radius_km, is_active=True)
    db.add(dept); db.flush()
    staff = User(full_name=data.name.strip(), email=email, phone=data.phone.strip(), address=data.address.strip(),
                 latitude=data.latitude, longitude=data.longitude, hashed_password=hash_password(data.password),
                 role="department_staff", department_id=dept.id, is_active=True)
    db.add(staff); audit(db, authority.id, "department_created", "department", dept.id, f"Category: {dept.category}")
    db.commit(); db.refresh(dept)
    return {"id": dept.id, "name": dept.name, "category": dept.category, "staff_user_id": staff.id}


@router.get("/updates/pending")
def pending_updates(db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    rows = db.query(ComplaintUpdate).filter(ComplaintUpdate.status == "pending").order_by(ComplaintUpdate.created_at.asc()).all()
    result = []
    for row in rows:
        item = _update_dict(row)
        complaint = db.query(Complaint).filter(Complaint.id == row.complaint_id).first()
        user = db.query(User).filter(User.id == row.submitted_by).first()
        item["complaint_title"] = complaint.title if complaint else "Deleted complaint"
        item["department_name"] = (db.query(Department).filter(Department.id == complaint.department_id).first().name if complaint and complaint.department_id else "Unassigned")
        item["submitted_by_name"] = user.full_name if user else "Department staff"
        result.append(item)
    return result


@router.post("/updates/{update_id}/approve")
def approve_update(update_id: int, request: ReviewRequest | None = None, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    update = db.query(ComplaintUpdate).filter(ComplaintUpdate.id == update_id).first()
    if not update: raise HTTPException(status_code=404, detail="Update not found")
    if update.status != "pending": raise HTTPException(status_code=409, detail="Update has already been reviewed")
    complaint = db.query(Complaint).filter(Complaint.id == update.complaint_id).first()
    if not complaint: raise HTTPException(status_code=404, detail="Complaint not found")
    update.status = "approved"; update.reviewed_by = authority.id; update.reviewed_at = datetime.now(timezone.utc); update.review_note = request.reason if request else None
    if update.proposed_status and update.proposed_status != complaint.status:
        old = complaint.status; complaint.status = update.proposed_status
        add_status_history(db, complaint.id, authority.id, old, complaint.status, f"Approved department update: {update.message[:300]}")
    audit(db, authority.id, "department_update_approved", "complaint_update", update.id, update.review_note or update.message[:300])
    db.commit()
    citizen = db.query(User).filter(User.id == complaint.user_id).first()
    if citizen:
        send_email(citizen.email, f"Update on your civic complaint #{complaint.id}",
                   f"Your complaint '{complaint.title}' has an approved update.\n\n{update.message}\nStatus: {complaint.status}\n")
    return {"message": "Update approved and made visible to the citizen", "complaint_id": complaint.id, "status": complaint.status}


@router.post("/updates/{update_id}/reject")
def reject_update(update_id: int, request: ReviewRequest, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    update = db.query(ComplaintUpdate).filter(ComplaintUpdate.id == update_id).first()
    if not update: raise HTTPException(status_code=404, detail="Update not found")
    if update.status != "pending": raise HTTPException(status_code=409, detail="Update has already been reviewed")
    update.status = "rejected"; update.reviewed_by = authority.id; update.reviewed_at = datetime.now(timezone.utc); update.review_note = request.reason or "Update rejected"
    audit(db, authority.id, "department_update_rejected", "complaint_update", update.id, update.review_note)
    db.commit()
    return {"message": "Update rejected"}


@router.post("/complaints/{complaint_id}/remind")
def remind_department(complaint_id: int, request: ReminderRequest, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id, Complaint.is_archived.is_(False)).first()
    if not complaint: raise HTTPException(status_code=404, detail="Active complaint not found")
    dept = db.query(Department).filter(Department.id == complaint.department_id).first() if complaint.department_id else None
    recipient = dept.email if dept and dept.email else None
    if not recipient and dept:
        staff = db.query(User).filter(User.department_id == dept.id, User.is_active.is_(True)).first()
        recipient = staff.email if staff else None
    sent = send_email(recipient, f"Reminder: civic complaint #{complaint.id}", f"Authority reminder\n\nComplaint: {complaint.title}\nStatus: {complaint.status}\nMessage: {request.message}\n")
    audit(db, authority.id, "department_reminder_sent", "complaint", complaint.id, request.message)
    db.commit()
    return {"message": "Reminder processed", "email_sent": sent, "recipient_configured": bool(recipient)}


@router.post("/complaints/{complaint_id}/archive")
def archive_complaint(complaint_id: int, request: ReviewRequest, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint: raise HTTPException(status_code=404, detail="Complaint not found")
    if not request.reason or not request.reason.strip(): raise HTTPException(status_code=422, detail="An archive reason is required")
    complaint.is_archived = True; complaint.archived_reason = request.reason.strip()
    audit(db, authority.id, "complaint_archived", "complaint", complaint.id, complaint.archived_reason)
    db.commit()
    return {"message": "Complaint archived", "complaint_id": complaint.id}


@router.delete("/complaints/{complaint_id}")
def delete_complaint(complaint_id: int, request: ReviewRequest, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint: raise HTTPException(status_code=404, detail="Complaint not found")
    if not request.reason or not request.reason.strip(): raise HTTPException(status_code=422, detail="A deletion reason is required")
    audit(db, authority.id, "complaint_deleted", "complaint", complaint.id, request.reason.strip())
    media_urls = [complaint.photo_url, complaint.audio_url]
    updates = db.query(ComplaintUpdate).filter(ComplaintUpdate.complaint_id == complaint.id).all()
    for item in updates:
        media_urls.extend([item.photo_url, item.audio_url])
    db.query(ComplaintStatusHistory).filter(ComplaintStatusHistory.complaint_id == complaint.id).delete(synchronize_session=False)
    db.query(ComplaintUpdate).filter(ComplaintUpdate.complaint_id == complaint.id).delete(synchronize_session=False)
    db.delete(complaint); db.commit()
    upload_dir = Path("uploads").resolve()
    for media_url in media_urls:
        if media_url and media_url.startswith("/uploads/"):
            path = (upload_dir / Path(media_url).name).resolve()
            if path.parent == upload_dir:
                path.unlink(missing_ok=True)
    return {"message": "Complaint deleted with audit reason", "complaint_id": complaint_id}


@router.get("/audit")
def audit_records(limit: int = 200, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    limit = max(1, min(limit, 500))
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
    return [{"id": x.id, "actor_user_id": x.actor_user_id, "action": x.action, "entity_type": x.entity_type,
             "entity_id": x.entity_id, "details": x.details, "created_at": x.created_at} for x in rows]


@router.get("/escalations")
def escalations(db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    now = datetime.now(timezone.utc)
    rows = db.query(Complaint).filter(Complaint.is_archived.is_(False), Complaint.due_at.isnot(None),
                                      Complaint.due_at < now, ~Complaint.status.in_(["resolved", "rejected"])).order_by(Complaint.due_at.asc()).all()
    # First time an overdue complaint is seen by the authority dashboard, notify only the nearest authority.
    for complaint in rows:
        if complaint.escalated_at is None:
            recipient = nearest_authority(db, complaint.latitude, complaint.longitude)
            if recipient and send_email(recipient.email, f"Escalation: overdue civic complaint #{complaint.id}",
                           f"Complaint #{complaint.id} is overdue.\nTitle: {complaint.title}\nStatus: {complaint.status}\nDue: {complaint.due_at}\nLocation: {complaint.address or 'Not provided'}"):
                complaint.escalated_at = now
                audit(db, authority.id, "complaint_escalated", "complaint", complaint.id, "Response deadline exceeded; email sent to nearest authority")
    if rows:
        db.commit()
    return [{"id": x.id, "title": x.title, "status": x.status, "due_at": x.due_at,
             "escalated_at": x.escalated_at, "department_id": x.department_id, "created_at": x.created_at} for x in rows]


@router.get("/complaints/archived")
def archived_complaints(db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    rows = db.query(Complaint).filter(Complaint.is_archived.is_(True)).order_by(Complaint.updated_at.desc()).all()
    return [{"id": x.id, "title": x.title, "category": x.category, "status": x.status,
             "archived_reason": x.archived_reason, "created_at": x.created_at,
             "updated_at": x.updated_at, "department_id": x.department_id} for x in rows]


@router.get("/complaints/{complaint_id}/details")
def authority_complaint_details(complaint_id: int, db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    complaint = db.query(Complaint).filter(Complaint.id == complaint_id).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    citizen = db.query(User).filter(User.id == complaint.user_id).first()
    department = db.query(Department).filter(Department.id == complaint.department_id).first() if complaint.department_id else None
    return {"complaint_id": complaint.id,
            "citizen": ({"id": citizen.id, "full_name": citizen.full_name, "email": citizen.email,
                         "phone": citizen.phone, "address": citizen.address} if citizen else None),
            "department": ({"id": department.id, "name": department.name, "category": department.category,
                            "phone": department.phone, "email": department.email, "address": department.address} if department else None)}


@router.get("/export.xlsx")
def export_excel(db: Session = Depends(get_db), authority: User = Depends(current_authority)):
    try:
        from openpyxl import Workbook
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel export requires openpyxl; install backend requirements")
    rows = (db.query(Complaint, User, Department)
            .join(User, Complaint.user_id == User.id)
            .outerjoin(Department, Complaint.department_id == Department.id)
            .order_by(Complaint.created_at.desc()).all())
    wb = Workbook(); ws = wb.active; ws.title = "Complaints"
    ws.append(["ID", "Title", "Category", "Description", "Status", "Department", "Citizen ID", "Citizen Name", "Citizen Email", "Citizen Phone", "Citizen Address", "Complaint Address", "Latitude", "Longitude", "Created At", "Updated At", "Due At", "Escalated At", "Archived", "Archive Reason"])
    for x, citizen, department in rows:
        ws.append([x.id, x.title, x.category, x.description, x.status, department.name if department else None,
                   x.user_id, citizen.full_name, citizen.email, citizen.phone, citizen.address, x.address,
                   x.latitude, x.longitude, x.created_at.isoformat() if x.created_at else None,
                   x.updated_at.isoformat() if x.updated_at else None, x.due_at.isoformat() if x.due_at else None,
                   x.escalated_at.isoformat() if x.escalated_at else None, x.is_archived, x.archived_reason])
    stream = BytesIO(); wb.save(stream)
    return Response(content=stream.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": "attachment; filename=smart_civic_complaints.xlsx"})
