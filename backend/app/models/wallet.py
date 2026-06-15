import enum
from sqlalchemy import Column, String, Numeric, DateTime, func, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base

class TransactionType(str, enum.Enum):
    wallet_topup = "wallet_topup"
    charging_fee = "charging_fee"
    food_order = "food_order"
    p2p_payout = "p2p_payout"

class Wallet(Base):
    __tablename__ = "wallets"

    wallet_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    balance_coins = Column(Numeric(12, 2), default=0.00, server_default="0.00", nullable=False)
    currency_code = Column(String(3), default="USD", server_default="USD", nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"

    transaction_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    wallet_id = Column(UUID(as_uuid=True), ForeignKey("wallets.wallet_id"), nullable=False)
    amount_coins = Column(Numeric(12, 2), nullable=False)
    type = Column(Enum(TransactionType, name="transaction_type"), nullable=False)
    reference_id = Column(UUID(as_uuid=True), nullable=True)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
