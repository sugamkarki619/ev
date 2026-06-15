import uuid
from datetime import timedelta
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, verify_token
from app.crud.user import authenticate_user, get_user
from app.schemas.token import Token

router = APIRouter()

class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(..., description="The refresh token returned from login")

@router.post("/login", response_model=Token)
async def login_access_token(
    db: AsyncSession = Depends(get_db),
    form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    """
    OAuth2 compatible token login, get an access token and refresh token for future requests.
    """
    user = await authenticate_user(
        db, email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )
        
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    
    return {
        "access_token": create_access_token(
            user.user_id, expires_delta=access_token_expires
        ),
        "refresh_token": create_refresh_token(
            user.user_id, expires_delta=refresh_token_expires
        ),
        "token_type": "bearer",
    }

@router.post("/refresh", response_model=Token)
async def refresh_access_token(
    body: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    Refresh access token using a valid refresh token.
    """
    payload = verify_token(body.refresh_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid refresh token"
        )
        
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token type"
        )
        
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid token subject"
        )
        
    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid UUID format in token"
        )
        
    user = await get_user(db, user_id=user_uuid)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
        
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires = timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    
    return {
        "access_token": create_access_token(
            user.user_id, expires_delta=access_token_expires
        ),
        "refresh_token": create_refresh_token(
            user.user_id, expires_delta=refresh_token_expires
        ),
        "token_type": "bearer",
    }
