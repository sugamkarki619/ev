from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_active_user
from app.models.user import User
from app.models.wallet import Wallet
from pydantic import BaseModel

router = APIRouter()

class WalletOut(BaseModel):
    wallet_id: Any
    user_id: Any
    balance_coins: float
    currency_code: str

    class Config:
        from_attributes = True

@router.get("/me", response_model=WalletOut)
async def read_wallet_me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> Any:
    """
    Get current user's digital wallet balance.
    """
    result = await db.execute(select(Wallet).where(Wallet.user_id == current_user.user_id))
    wallet = result.scalars().first()
    
    if not wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wallet not found for this user."
        )
        
    return wallet
