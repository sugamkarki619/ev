from typing import Generator
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import verify_token
from app.crud.user import get_user
from app.models.user import User
from app.schemas.token import TokenPayload

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login"
)

async def get_current_user(
    db: AsyncSession = Depends(get_db), token: str = Depends(reusable_oauth2)
) -> User:
    """Dependency to retrieve the currently logged-in user from the JWT access token."""
    payload = verify_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token_data = TokenPayload(**payload)
    if token_data.type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    if token_data.sub is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    import uuid
    try:
        user_uuid = uuid.UUID(token_data.sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    user = await get_user(db, user_id=user_uuid)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
        
    return user

def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Dependency to check if user is active (always returns user as is_active is deprecated)."""
    return current_user

def get_current_active_superuser(
    current_user: User = Depends(get_current_user),
) -> User:
    """Dependency to check if user has admin role."""
    from app.models.user import UserRole
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user does not have enough privileges"
        )
    return current_user
