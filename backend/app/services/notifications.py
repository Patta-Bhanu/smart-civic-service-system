import os
import smtplib
from email.message import EmailMessage
from math import radians, sin, cos, sqrt, atan2


def distance_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * r * atan2(sqrt(a), sqrt(max(0.0, 1 - a)))


def send_email(to_email: str | None, subject: str, body: str) -> bool:
    """Send email when SMTP is configured; return False instead of breaking core actions."""
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    username = os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM_EMAIL") or username
    if not to_email or not username or not password or not sender:
        return False
    try:
        port = int(os.getenv("SMTP_PORT", "465"))
    except ValueError:
        return False
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)
    try:
        with smtplib.SMTP_SSL(host, port, timeout=12) as smtp:
            smtp.login(username, password)
            smtp.send_message(message)
        return True
    except Exception:
        # Notifications must not roll back a successfully saved complaint/update.
        return False


def nearest_authority(db, latitude, longitude):
    from app.models.user import User
    if latitude is None or longitude is None:
        return None
    authorities = db.query(User).filter(
        User.role == "authority", User.is_active.is_(True),
        User.latitude.isnot(None), User.longitude.isnot(None),
    ).all()
    if not authorities:
        return None
    authorities.sort(key=lambda u: distance_km(latitude, longitude, u.latitude, u.longitude))
    return authorities[0]


def notify_nearest_authority(db, complaint):
    authority = nearest_authority(db, complaint.latitude, complaint.longitude)
    if not authority:
        return False
    return send_email(
        authority.email,
        f"New civic complaint #{complaint.id}: {complaint.title}",
        f"A new complaint is nearest to your registered location.\n\n"
        f"Complaint: #{complaint.id} - {complaint.title}\n"
        f"Category: {complaint.category}\nStatus: {complaint.status}\n"
        f"Location: {complaint.address or 'Not provided'}\n"
        f"Coordinates: {complaint.latitude}, {complaint.longitude}\n"
        f"Description: {complaint.description or 'Not provided'}\n",
    )


def audit(db, actor_user_id, action, entity_type, entity_id=None, details=None):
    from app.models.audit_log import AuditLog
    db.add(AuditLog(
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
    ))
