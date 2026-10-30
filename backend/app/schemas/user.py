
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, EmailStr


class UserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    phone: str = Field(min_length=7, max_length=30)
    address: str = Field(min_length=3, max_length=500)
    latitude: float | None = None
    longitude: float | None = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: EmailStr
    phone: str | None = None
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    role: str
    department_id: int | None = None
    is_active: bool


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    portal: Literal["citizen", "department_staff", "authority"] = "citizen"



class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    email: EmailStr
    latitude: float | None = None
    longitude: float | None = None



class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
