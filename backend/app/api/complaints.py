
import math
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    File,
    UploadFile,
    Form,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User
from app.models.complaint import Complaint
from app.models.complaint_status_history import ComplaintStatusHistory
from app.models.department import Department
from app.models.complaint_update import ComplaintUpdate
from app.services.notifications import notify_nearest_authority, send_email, audit
from app.schemas.complaint import (
    ComplaintCreate,
    ComplaintResponse,
    ComplaintStatusUpdate,
    ComplaintStatusHistoryResponse,
    AssignComplaintRequest,
)
from app.crud.complaint import (
    create_complaint,
    get_all_complaints,
    get_complaint_by_id,
    add_status_history,
    get_complaint_history,
    calculate_distance_km,
)

router = APIRouter(prefix="/complaints", tags=["Complaints"])
bearer_scheme = HTTPBearer()

UPLOAD_DIR = Path("uploads").resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 15 * 1024 * 1024  # Audio may be up to 15 MB; photo size is limited by the frontend.

ALLOWED_PHOTO_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}

ALLOWED_AUDIO_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/webm",
    "audio/ogg",
    "audio/aac",
}


# ---------------- AUTHENTICATION ----------------

def get_authenticated_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_access_token(credentials.credentials)

    if not payload or not payload.get("sub"):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )

    try:
        user_id = int(payload["sub"])
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=401,
            detail="Invalid token",
        )

    user = db.query(User).filter(User.id == user_id).first()

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=401,
            detail="User not found or inactive",
        )

    return user


def is_department_staff(user: User) -> bool:
    return user.role in ("department_staff", "department")


def ensure_complaint_access(
    current_user: User,
    complaint: Complaint,
):
    if current_user.role == "authority":
        return

    if current_user.role == "citizen":
        if complaint.user_id == current_user.id:
            return

        raise HTTPException(
            status_code=403,
            detail="You cannot access another citizen's complaint",
        )

    if is_department_staff(current_user):
        if (
            current_user.department_id is not None
            and complaint.department_id == current_user.department_id
        ):
            return

        raise HTTPException(
            status_code=403,
            detail="You cannot access complaints outside your department",
        )

    raise HTTPException(
        status_code=403,
        detail="Your role is not permitted to access complaints",
    )


# ---------------- SUBMIT COMPLAINT ----------------

@router.post("/", response_model=ComplaintResponse, status_code=201)
def submit_complaint(
    complaint_data: ComplaintCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    if current_user.role != "citizen":
        raise HTTPException(
            status_code=403,
            detail="Only citizens can submit complaints",
        )

    complaint = create_complaint(
        db,
        complaint_data,
        user_id=current_user.id,
    )
    # Notify exactly one authority: the nearest active authority with saved coordinates.
    notify_nearest_authority(db, complaint)
    return complaint


# ---------------- NEARBY COMPLAINTS ----------------

@router.get("/nearby")
def find_nearby_complaints(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    radius_m: float = Query(default=100, gt=0, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    if current_user.role != "citizen":
        raise HTTPException(
            status_code=403,
            detail="Only citizens can check nearby complaints",
        )

    complaints = (
        db.query(Complaint)
        .filter(
            Complaint.latitude.isnot(None),
            Complaint.longitude.isnot(None),
        )
        .all()
    )

    nearby = []

    def distance_in_metres(lat1, lon1, lat2, lon2):
        earth_radius = 6_371_000

        lat1 = math.radians(lat1)
        lon1 = math.radians(lon1)
        lat2 = math.radians(lat2)
        lon2 = math.radians(lon2)

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(lat1)
            * math.cos(lat2)
            * math.sin(dlon / 2) ** 2
        )

        a = max(0.0, min(1.0, a))

        return earth_radius * 2 * math.atan2(
            math.sqrt(a),
            math.sqrt(1 - a),
        )

    for complaint in complaints:
        distance = distance_in_metres(
            latitude,
            longitude,
            complaint.latitude,
            complaint.longitude,
        )

        if distance <= radius_m:
            nearby.append({
                "id": complaint.id,
                "title": complaint.title,
                "description": complaint.description,
                "category": complaint.category,
                "status": complaint.status,
                "latitude": complaint.latitude,
                "longitude": complaint.longitude,
                "distance_m": round(distance, 1),
                "created_at": complaint.created_at,
                "is_mine": complaint.user_id == current_user.id,
            })

    nearby.sort(key=lambda item: item["distance_m"])

    return {
        "radius_m": radius_m,
        "count": len(nearby),
        "complaints": nearby,
    }


# ---------------- PUBLIC MAP SUMMARY ----------------

@router.get("/map")
def map_complaints(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    """Return location/status summaries without exposing citizen identity."""
    if current_user.role not in ("citizen", "department_staff", "department", "authority"):
        raise HTTPException(status_code=403, detail="Your role is not permitted to view the map")

    query = db.query(Complaint).filter(Complaint.is_archived.is_(False), Complaint.latitude.isnot(None), Complaint.longitude.isnot(None))
    rows = query.order_by(Complaint.created_at.desc()).all()
    return [
        {
            "id": row.id,
            "title": row.title,
            "category": row.category,
            "status": row.status,
            "latitude": row.latitude,
            "longitude": row.longitude,
            "address": row.address,
            "created_at": row.created_at,
            "support_count": row.support_count or 0,
            "assigned_to_me": bool(is_department_staff(current_user) and current_user.department_id and row.department_id == current_user.department_id),
        }
        for row in rows
    ]


@router.post("/{complaint_id}/support")
def support_complaint(
    complaint_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    """Let citizens support an existing nearby report instead of duplicating it."""
    if current_user.role != "citizen":
        raise HTTPException(status_code=403, detail="Only citizens can support complaints")

    complaint = get_complaint_by_id(db, complaint_id)
    if complaint is None:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot support your own complaint")
    if complaint.status in ("resolved", "rejected"):
        raise HTTPException(status_code=400, detail="This complaint is no longer accepting support")

    complaint.support_count = (complaint.support_count or 0) + 1
    db.commit()
    db.refresh(complaint)
    # A complaint reaching five community supports is treated as hot; notify its assigned department only.
    if complaint.support_count == 5 and complaint.department_id:
        department = db.query(Department).filter(Department.id == complaint.department_id).first()
        if department and department.email:
            send_email(department.email, f"High-support civic complaint #{complaint.id}",
                       f"Complaint '{complaint.title}' has reached {complaint.support_count} community supports.\nStatus: {complaint.status}\nLocation: {complaint.address or 'Not provided'}")
    return {"message": "Your support was recorded", "complaint_id": complaint.id, "support_count": complaint.support_count}


# ---------------- LIST COMPLAINTS ----------------

@router.get("/", response_model=list[ComplaintResponse])
def list_complaints(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    if current_user.role == "citizen":
        return get_all_complaints(db, user_id=current_user.id)

    if is_department_staff(current_user):
        if current_user.department_id is None:
            raise HTTPException(
                status_code=403,
                detail="Your account is not assigned to a department",
            )

        return get_all_complaints(
            db,
            department_id=current_user.department_id,
        )

    if current_user.role == "authority":
        rows = get_all_complaints(db)
        if current_user.latitude is not None and current_user.longitude is not None:
            def distance_for(row):
                if row.latitude is None or row.longitude is None:
                    return float("inf")
                return calculate_distance_km(current_user.latitude, current_user.longitude, row.latitude, row.longitude)
            rows.sort(key=lambda row: (distance_for(row), -(row.id or 0)))
            for row in rows:
                distance = distance_for(row)
                row.distance_km = round(distance, 2) if math.isfinite(distance) else None
        return rows

    raise HTTPException(
        status_code=403,
        detail="Your role is not permitted to list complaints",
    )


# ---------------- UNASSIGNED COMPLAINTS ----------------

@router.get("/unassigned", response_model=list[ComplaintResponse])
def list_unassigned_complaints(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    if current_user.role != "authority":
        raise HTTPException(
            status_code=403,
            detail="Only authority users can view unassigned complaints",
        )

    rows = (db.query(Complaint)
            .filter(Complaint.department_id.is_(None), Complaint.is_archived.is_(False))
            .all())
    if current_user.latitude is not None and current_user.longitude is not None:
        def distance_for(row):
            if row.latitude is None or row.longitude is None:
                return float("inf")
            return calculate_distance_km(current_user.latitude, current_user.longitude, row.latitude, row.longitude)
        rows.sort(key=lambda row: distance_for(row))
        for row in rows:
            distance = distance_for(row)
            row.distance_km = round(distance, 2) if math.isfinite(distance) else None
    else:
        rows.sort(key=lambda row: row.created_at, reverse=True)
    return rows


# ---------------- ASSIGN DEPARTMENT ----------------

@router.patch(
    "/{complaint_id}/assign",
    response_model=ComplaintResponse,
)
def assign_complaint_to_department(
    complaint_id: int,
    assignment: AssignComplaintRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    if current_user.role != "authority":
        raise HTTPException(
            status_code=403,
            detail="Only authority users can assign complaints",
        )

    complaint = get_complaint_by_id(db, complaint_id)

    if complaint is None:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found",
        )

    department = (
        db.query(Department)
        .filter(
            Department.id == assignment.department_id,
            Department.is_active.is_(True),
        )
        .first()
    )

    if department is None:
        raise HTTPException(
            status_code=404,
            detail="Active department not found",
        )

    old_department_id = complaint.department_id
    old_status = complaint.status

    complaint.department_id = department.id

    if old_department_id != department.id:
        complaint.status = "assigned"

        add_status_history(
            db=db,
            complaint_id=complaint.id,
            changed_by=current_user.id,
            old_status=old_status,
            new_status=complaint.status,
            note=f"Assigned to department: {department.name}",
        )

    try:
        db.commit()
        db.refresh(complaint)
    except Exception:
        db.rollback()
        raise

    audit(db, current_user.id, "complaint_assigned", "complaint", complaint.id, f"Department: {department.name}")
    db.commit()
    return complaint


# ---------------- UPDATE STATUS ----------------

@router.patch(
    "/{complaint_id}/status",
    response_model=ComplaintResponse,
)
def update_complaint_status(
    complaint_id: int,
    status_data: ComplaintStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    complaint = get_complaint_by_id(db, complaint_id)

    if complaint is None:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found",
        )

    if current_user.role != "authority":
        raise HTTPException(
            status_code=403,
            detail="Only authority can change the citizen-visible status. Department staff must submit an update for approval.",
        )

    old_status = complaint.status
    new_status = status_data.status

    if old_status == new_status:
        raise HTTPException(
            status_code=400,
            detail="The complaint already has this status",
        )

    if old_status == "submitted" and new_status not in (
        "assigned",
        "rejected",
    ):
        raise HTTPException(
            status_code=400,
            detail="A submitted complaint must be assigned before work begins",
        )

    if old_status == "resolved" and new_status != "assigned":
        raise HTTPException(
            status_code=400,
            detail="A resolved complaint cannot transition to that status",
        )

    complaint.status = new_status

    add_status_history(
        db=db,
        complaint_id=complaint.id,
        changed_by=current_user.id,
        old_status=old_status,
        new_status=new_status,
        note=status_data.note,
    )

    try:
        db.commit()
        db.refresh(complaint)
    except Exception:
        db.rollback()
        raise

    audit(db, current_user.id, "complaint_status_changed", "complaint", complaint.id, f"{old_status} -> {new_status}: {status_data.note or ''}")
    db.commit()
    citizen = db.query(User).filter(User.id == complaint.user_id).first()
    if citizen:
        send_email(citizen.email, f"Status update for civic complaint #{complaint.id}",
                   f"Your complaint '{complaint.title}' status is now {new_status.replace('_', ' ')}.\n\n{status_data.note or ''}")
    return complaint


# ---------------- STATUS HISTORY ----------------

@router.get(
    "/{complaint_id}/history",
    response_model=list[ComplaintStatusHistoryResponse],
)
def complaint_status_history(
    complaint_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    complaint = get_complaint_by_id(db, complaint_id)

    if complaint is None:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found",
        )

    ensure_complaint_access(current_user, complaint)

    return get_complaint_history(db, complaint_id)


# ---------------- COMPLAINT DETAILS ----------------

@router.get(
    "/{complaint_id}",
    response_model=ComplaintResponse,
)
def complaint_details(
    complaint_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    complaint = get_complaint_by_id(db, complaint_id)

    if complaint is None:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found",
        )

    ensure_complaint_access(current_user, complaint)

    return complaint


# ---------------- DELETE A CITIZEN'S OWN COMPLAINT ----------------

@router.delete("/{complaint_id}")
def delete_complaint(
    complaint_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    """Citizens may delete only their own complaint; staff/authority cannot use this route."""
    if current_user.role != "citizen":
        raise HTTPException(status_code=403, detail="Only citizens can delete their own complaints")

    complaint = get_complaint_by_id(db, complaint_id)
    if complaint is None:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can delete only your own complaints")

    media_paths = []
    for media_url in (complaint.photo_url, complaint.audio_url):
        if media_url and media_url.startswith("/uploads/"):
            candidate = (UPLOAD_DIR / Path(media_url).name).resolve()
            if candidate.parent == UPLOAD_DIR:
                media_paths.append(candidate)

    try:
        db.query(ComplaintStatusHistory).filter(
            ComplaintStatusHistory.complaint_id == complaint.id
        ).delete(synchronize_session=False)
        db.delete(complaint)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not delete the complaint")

    for path in media_paths:
        path.unlink(missing_ok=True)

    return {"message": "Complaint deleted successfully", "complaint_id": complaint_id}


# ---------------- PHOTO AND AUDIO UPLOAD ----------------

@router.post("/{complaint_id}/media", response_model=ComplaintResponse)
async def upload_complaint_media(
    complaint_id: int,
    photo: UploadFile | None = File(default=None),
    audio: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    if photo is None and audio is None:
        raise HTTPException(
            status_code=400,
            detail="Upload at least one photo or audio file",
        )

    complaint = get_complaint_by_id(db, complaint_id)

    if complaint is None:
        raise HTTPException(
            status_code=404,
            detail="Complaint not found",
        )

    # Only the citizen who filed the report may add original complaint media.
    # Department evidence must use /updates and await authority approval.
    if current_user.role != "citizen" or complaint.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the reporting citizen can add original complaint media")

    saved_files = []

    async def save_upload(
        upload: UploadFile,
        allowed_types: set[str],
    ) -> str:
        # Some browsers append codec parameters, e.g. audio/webm;codecs=opus.
        content_type = (upload.content_type or '').split(';', 1)[0].strip().lower()
        aliases = {
            'image/jpg': 'image/jpeg',
            'audio/x-m4a': 'audio/mp4',
            'audio/3gpp': 'audio/mp4',
            'audio/3gpp2': 'audio/mp4',
        }
        content_type = aliases.get(content_type, content_type)
        if content_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {upload.content_type or 'unknown'}",
            )

        content = await upload.read(MAX_FILE_SIZE + 1)

        if not content:
            raise HTTPException(
                status_code=400,
                detail="Uploaded file is empty",
            )

        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Each file must be 15 MB or smaller",
            )

        extension = Path(upload.filename or "").suffix.lower()

        if not extension:
            extension = {
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/webp": ".webp",
                "audio/mpeg": ".mp3",
                "audio/mp3": ".mp3",
                "audio/wav": ".wav",
                "audio/x-wav": ".wav",
                "audio/mp4": ".m4a",
                "audio/webm": ".webm",
                "audio/ogg": ".ogg",
                "audio/aac": ".aac",
            }.get(content_type, ".bin")

        filename = f"{uuid4().hex}{extension}"
        destination = UPLOAD_DIR / filename

        destination.write_bytes(content)
        saved_files.append(destination)

        return f"/uploads/{filename}"

    try:
        if photo is not None:
            complaint.photo_url = await save_upload(
                photo,
                ALLOWED_PHOTO_TYPES,
            )

        if audio is not None:
            complaint.audio_url = await save_upload(
                audio,
                ALLOWED_AUDIO_TYPES,
            )

        db.commit()
        db.refresh(complaint)

    except HTTPException:
        for path in saved_files:
            path.unlink(missing_ok=True)
        raise

    except Exception:
        db.rollback()

        for path in saved_files:
            path.unlink(missing_ok=True)

        raise HTTPException(
            status_code=500,
            detail="Could not save complaint media",
        )

    finally:
        if photo is not None:
            await photo.close()
        if audio is not None:
            await audio.close()

    return complaint


# ---------------- DEPARTMENT UPDATE SUBMISSIONS ----------------

def _save_update_media(upload: UploadFile | None, allowed_types: set[str]) -> str | None:
    if upload is None:
        return None
    content_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
    aliases = {"image/jpg": "image/jpeg", "audio/x-m4a": "audio/mp4", "audio/3gpp": "audio/mp4"}
    content_type = aliases.get(content_type, content_type)
    if content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {upload.content_type or 'unknown'}")
    content = upload.file.read(MAX_FILE_SIZE + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Each file must be 15 MB or smaller")
    extension = Path(upload.filename or "").suffix.lower()
    if not extension:
        extension = {
            "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
            "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/wav": ".wav",
            "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/webm": ".webm",
            "audio/ogg": ".ogg", "audio/aac": ".aac",
        }.get(content_type, ".bin")
    filename = f"{uuid4().hex}{extension}"
    (UPLOAD_DIR / filename).write_bytes(content)
    return f"/uploads/{filename}"


@router.post("/{complaint_id}/updates", status_code=201)
def submit_department_update(
    complaint_id: int,
    message: str = Form(..., min_length=3, max_length=3000),
    proposed_status: str | None = Form(default=None),
    photo: UploadFile | None = File(default=None),
    audio: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    if not is_department_staff(current_user) or not current_user.department_id:
        raise HTTPException(status_code=403, detail="Only assigned department staff can submit updates")
    complaint = get_complaint_by_id(db, complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    if complaint.department_id != current_user.department_id:
        raise HTTPException(status_code=403, detail="You cannot update complaints outside your department")
    if complaint.is_archived:
        raise HTTPException(status_code=409, detail="Archived complaints cannot be updated")
    if proposed_status and proposed_status not in ("in_progress", "resolved", "rejected"):
        raise HTTPException(status_code=422, detail="Invalid proposed status")
    if not message.strip() and photo is None and audio is None:
        raise HTTPException(status_code=400, detail="Add a message or evidence")
    photo_url = audio_url = None
    try:
        if photo is not None:
            photo_url = _save_update_media(photo, ALLOWED_PHOTO_TYPES)
        if audio is not None:
            audio_url = _save_update_media(audio, ALLOWED_AUDIO_TYPES)
        update = ComplaintUpdate(complaint_id=complaint.id, submitted_by=current_user.id, message=message.strip(),
                                 proposed_status=proposed_status, photo_url=photo_url, audio_url=audio_url, status="pending")
        db.add(update)
        audit(db, current_user.id, "department_update_submitted", "complaint_update", None, f"Complaint #{complaint.id}")
        db.commit(); db.refresh(update)
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not save department update")
    return {"id": update.id, "complaint_id": update.complaint_id, "message": update.message,
            "proposed_status": update.proposed_status, "photo_url": update.photo_url, "audio_url": update.audio_url,
            "status": update.status, "created_at": update.created_at}


@router.get("/{complaint_id}/updates")
def list_complaint_updates(
    complaint_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_authenticated_user),
):
    complaint = get_complaint_by_id(db, complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    ensure_complaint_access(current_user, complaint)
    query = db.query(ComplaintUpdate).filter(ComplaintUpdate.complaint_id == complaint_id)
    if current_user.role == "citizen":
        query = query.filter(ComplaintUpdate.status == "approved")
    rows = query.order_by(ComplaintUpdate.created_at.desc()).all()
    return [{"id": x.id, "complaint_id": x.complaint_id, "message": x.message,
             "proposed_status": x.proposed_status, "photo_url": x.photo_url, "audio_url": x.audio_url,
             "status": x.status, "review_note": x.review_note, "created_at": x.created_at}
            for x in rows]
