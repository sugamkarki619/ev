import uuid
from typing import Optional
from pydantic import BaseModel, EmailStr, ConfigDict
from app.models.user import UserRole

class UserBase(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    phone_number: Optional[str] = None
    role: UserRole
    is_kyc_verified: bool = False

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None
    password: Optional[str] = None
    is_kyc_verified: Optional[bool] = None

class UserOut(UserBase):
    user_id: uuid.UUID

    model_config = ConfigDict(from_attributes=True)
