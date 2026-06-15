import uuid
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User
from app.models.wallet import Wallet
from app.schemas.user import UserCreate, UserUpdate
from app.core.security import get_password_hash, verify_password

async def get_user(db: AsyncSession, user_id: uuid.UUID) -> Optional[User]:
    """Get a user by UUID."""
    result = await db.execute(select(User).where(User.user_id == user_id))
    return result.scalars().first()

async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    """Get a user by email."""
    result = await db.execute(select(User).where(User.email == email))
    return result.scalars().first()

async def create_user(db: AsyncSession, obj_in: UserCreate) -> User:
    """Create a new user with hashed password and initial wallet."""
    db_obj = User(
        email=obj_in.email,
        password_hash=get_password_hash(obj_in.password),
        first_name=obj_in.first_name,
        last_name=obj_in.last_name,
        phone_number=obj_in.phone_number,
        role=obj_in.role,
        is_kyc_verified=obj_in.is_kyc_verified,
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)

    # Initialize wallet for user
    wallet = Wallet(
        user_id=db_obj.user_id,
        balance_coins=100.00  # Give them a welcome bonus of 100 coins!
    )
    db.add(wallet)
    await db.commit()
    
    return db_obj

async def update_user(db: AsyncSession, db_obj: User, obj_in: UserUpdate) -> User:
    """Update a user's details."""
    update_data = obj_in.model_dump(exclude_unset=True)
    if "password" in update_data:
        password_hash = get_password_hash(update_data["password"])
        db_obj.password_hash = password_hash
        del update_data["password"]
        
    for field, value in update_data.items():
        setattr(db_obj, field, value)
        
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    return db_obj

async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    """Authenticate a user by email and password."""
    user = await get_user_by_email(db, email=email)
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
