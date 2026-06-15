import enum
from sqlalchemy import Column, String, Boolean, DateTime, func, Enum
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base

class UserRole(str, enum.Enum):
    ev_owner = "ev_owner"
    restaurant_owner = "restaurant_owner"
    home_station_owner = "home_station_owner"
    admin = "admin"

class User(Base):
    __tablename__ = "users"

    user_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    phone_number = Column(String(20), nullable=True)
    role = Column(Enum(UserRole, name="user_role"), nullable=False)
    is_kyc_verified = Column(Boolean, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
