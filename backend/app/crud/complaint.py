
from math import radians, sin, cos, sqrt, atan2
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.complaint import Complaint
from app.models.department import Department
from app.models.complaint_status_history import ComplaintStatusHistory
from app.schemas.complaint import ComplaintCreate


def calculate_distance_km(lat1, lon1, lat2, lon2):
    """Calculate the distance between two GPS coordinates."""
    earth_radius_km = 6371.0

    lat1, lon1, lat2, lon2 = map(
        radians, [lat1, lon1, lat2, lon2]
    )

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    
    a = (
        sin(dlat / 2) ** 2
        + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    )


    return earth_radius_km * 2 * atan2(
        sqrt(a), sqrt(1 - a)
    )


def normalize_category(value: str | None) -> str:
    text = (value or "other").strip().casefold().replace("_", " ").replace("-", " ")
    aliases = {
        "road": "roads", "road damage": "roads", "potholes": "roads", "pothole": "roads",
        "street lights": "streetlight", "street light": "streetlight", "streetlights": "streetlight",
        "water supply": "water", "garbage collection": "garbage", "waste": "garbage",
        "drains": "drainage", "sewer": "drainage", "sewage": "drainage",
    }
    if text in aliases:
        return aliases[text]
    # Support descriptive names such as "Roads Maintenance Department".
    if "streetlight" in text or "street light" in text:
        return "streetlight"
    if "road" in text or "pothole" in text:
        return "roads"
    if "water" in text:
        return "water"
    if "garbage" in text or "waste" in text or "sanitation" in text:
        return "garbage"
    if "drain" in text or "sewer" in text:
        return "drainage"
    return text


def find_nearest_department(db: Session, complaint_data: ComplaintCreate):
    """Choose the nearest active department for the complaint category.

    Prefer departments whose configured service radius includes the complaint.
    If none do, assign the nearest category-matching department rather than leave
    a valid, geolocated complaint unassigned.
    """
    if complaint_data.latitude is None or complaint_data.longitude is None:
        return None

    category = normalize_category(complaint_data.category)
    departments = db.query(Department).filter(Department.is_active.is_(True)).all()
    matching = []
    for department in departments:
        if department.latitude is None or department.longitude is None:
            continue
        department_category = normalize_category(department.category or department.name)
        if department_category != category:
            continue
        distance = calculate_distance_km(complaint_data.latitude, complaint_data.longitude,
                                         department.latitude, department.longitude)
        in_service_area = distance <= (department.service_radius_km or 10.0)
        matching.append((not in_service_area, distance, department))
    if not matching:
        return None
    matching.sort(key=lambda item: (item[0], item[1]))
    return matching[0][2]


def add_status_history(
    db: Session,
    complaint_id: int,
    changed_by: int | None,
    old_status: str | None,
    new_status: str,
    note: str | None = None,
):
    """Record a complaint status change."""

    history = ComplaintStatusHistory(
        complaint_id=complaint_id,
        changed_by=changed_by,
        old_status=old_status,
        new_status=new_status,
        note=note,
    )

    db.add(history)
    return history


def create_complaint(
    db: Session,
    complaint_data: ComplaintCreate,
    user_id: int,
):
    """Create a complaint and record its initial status."""

    department = find_nearest_department(db, complaint_data)

    initial_status = "assigned" if department else "submitted"

    complaint = Complaint(
        user_id=user_id,
        department_id=department.id if department else None,
        title=complaint_data.title,
        description=complaint_data.description,
        category=complaint_data.category,
        latitude=complaint_data.latitude,
        longitude=complaint_data.longitude,
        address=complaint_data.address,
        status=initial_status,
        due_at=datetime.now(timezone.utc) + timedelta(hours=72),
    )

    db.add(complaint)

    try:
        # Get the generated complaint ID before creating its history.
        db.flush()

        add_status_history(
            db=db,
            complaint_id=complaint.id,
            changed_by=user_id,
            old_status=None,
            new_status=initial_status,
            note="Complaint submitted",
        )

        db.commit()
        db.refresh(complaint)

    except Exception:
        db.rollback()
        raise

    return complaint


def get_all_complaints(
    db: Session,
    user_id: int | None = None,
    department_id: int | None = None,
):
    """List complaints with optional filters."""

    query = db.query(Complaint).filter(Complaint.is_archived.is_(False))

    if user_id is not None:
        query = query.filter(Complaint.user_id == user_id)

    if department_id is not None:
        query = query.filter(
            Complaint.department_id == department_id
        )

    return query.order_by(Complaint.created_at.desc()).all()


def get_complaint_by_id(
    db: Session,
    complaint_id: int,
):
    """Get a complaint by ID."""

    return (
        db.query(Complaint)
        .filter(Complaint.id == complaint_id)
        .first()
    )


def get_complaint_history(
    db: Session,
    complaint_id: int,
):
    """Return the status history in chronological order."""

    return (
        db.query(ComplaintStatusHistory)
        .filter(
            ComplaintStatusHistory.complaint_id == complaint_id
        )
        .order_by(ComplaintStatusHistory.created_at.asc())
        .all()
    )
