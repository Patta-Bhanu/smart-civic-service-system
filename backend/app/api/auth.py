
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    verify_password,
    decode_access_token,
)
from app.crud.user import create_user, get_user_by_email
from app.models.user import User
from app.schemas.user import (
    LoginRequest,
    TokenResponse,
    UserCreate,
    UserResponse,
    ProfileUpdate,
    PasswordChange,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

bearer_scheme = HTTPBearer()


class InitialAuthorityLocation(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


# Register a new citizen account
@router.post("/register", response_model=UserResponse, status_code=201)
def register_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
):
    existing_user = get_user_by_email(db, user_data.email)

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Email is already registered",
        )

    return create_user(db, user_data)


# Log in and generate an access token
@router.post("/login", response_model=TokenResponse)
def login_user(
    login_data: LoginRequest,
    db: Session = Depends(get_db),
):
    user = get_user_by_email(db, login_data.email)

    if not user or not verify_password(
        login_data.password,
        user.hashed_password,
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="This account is inactive",
        )

    # A portal is a sign-in boundary, not a role selector. The stored role
    # remains authoritative and cannot be changed by the login request.
    role_aliases = {"department": "department_staff", "department_staff": "department_staff"}
    actual_role = role_aliases.get(user.role, user.role)
    if actual_role != login_data.portal:
        raise HTTPException(
            status_code=403,
            detail=f"This account cannot sign in through the {login_data.portal.replace('_', ' ')} portal.",
        )

    access_token = create_access_token(user.id)

    return {
        "access_token": access_token,
        "token_type": "bearer",
    }


# Get the currently authenticated user
@router.get("/me", response_model=UserResponse)
def get_current_user(
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


@router.patch("/me", response_model=UserResponse)
def update_profile(
    profile: ProfileUpdate,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    normalized_email = profile.email.lower()
    existing = db.query(User).filter(
        User.email == normalized_email,
        User.id != user.id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email is already registered")

    user.full_name = profile.full_name.strip()
    user.email = normalized_email
    user.phone = profile.phone.strip() if profile.phone else None
    user.address = profile.address.strip() if profile.address else None
    # Authority coordinates are set once through /me/location and cannot be
    # changed by the general profile form. Other roles can maintain their own pin.
    if user.role != "authority":
        user.latitude = profile.latitude
        user.longitude = profile.longitude
    db.commit()
    db.refresh(user)
    return user


@router.post("/me/location", response_model=UserResponse)
def set_initial_authority_location(
    location: InitialAuthorityLocation,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if user.role != "authority":
        raise HTTPException(status_code=403, detail="Only authority accounts can set an authority location")
    if user.latitude is not None and user.longitude is not None:
        raise HTTPException(status_code=409, detail="Authority location is already set and is locked")
    user.latitude = location.latitude
    user.longitude = location.longitude
    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password")
def change_password(
    request: PasswordChange,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    payload = decode_access_token(credentials.credentials)
    if not payload or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if not verify_password(request.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if request.current_password == request.new_password:
        raise HTTPException(status_code=400, detail="Choose a different password")

    from app.core.security import hash_password
    user.hashed_password = hash_password(request.new_password)
    db.commit()
    return {"message": "Password updated successfully"}
