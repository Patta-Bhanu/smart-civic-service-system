
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User
from app.schemas.user import UserCreate


def get_user_by_email(db: Session, email: str):
    return (
        db.query(User)
        .filter(User.email == email.lower())
        .first()
    )


def create_user(db: Session, user_data: UserCreate):
    user = User(
        full_name=user_data.full_name,
        email=user_data.email.lower(),
        phone=user_data.phone,
        address=user_data.address,
        latitude=user_data.latitude,
        longitude=user_data.longitude,
        hashed_password=hash_password(user_data.password),
        role="citizen",
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user
