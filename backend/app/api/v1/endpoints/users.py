from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_active_user
from app.crud.user import get_user_by_email, create_user, update_user
from app.models.user import User
from app.schemas.user import UserCreate, UserOut, UserUpdate

router = APIRouter()

@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register_user(
    *,
    db: AsyncSession = Depends(get_db),
    user_in: UserCreate,
) -> Any:
    """
    Register a new user.
    """
    user = await get_user_by_email(db, email=user_in.email)
    if user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email address already exists in the system."
        )
    user = await create_user(db, obj_in=user_in)
    return user

@router.get("/me", response_model=UserOut)
async def read_user_me(
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    Get current logged-in user profile.
    """
    return current_user

@router.put("/me", response_model=UserOut)
async def update_user_me(
    *,
    db: AsyncSession = Depends(get_db),
    user_in: UserUpdate,
    current_user: User = Depends(get_current_active_user),
) -> Any:
    """
    Update own user profile details.
    """
    # If checking email uniqueness
    if user_in.email and user_in.email != current_user.email:
        existing_user = await get_user_by_email(db, email=user_in.email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already in use."
            )
            
    updated = await update_user(db, db_obj=current_user, obj_in=user_in)
    return updated
