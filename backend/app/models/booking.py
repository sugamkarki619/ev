import enum
from sqlalchemy import Column, String, Integer, Numeric, Boolean, DateTime, ForeignKey, Enum, func
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base

class OrderStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    preparing = "preparing"
    ready_for_pickup = "ready_for_pickup"
    delivered = "delivered"
    cancelled = "cancelled"

class UnifiedBookingSession(Base):
    __tablename__ = "unified_booking_sessions"

    session_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False)
    trip_id = Column(UUID(as_uuid=True), ForeignKey("trips.trip_id", ondelete="SET NULL"), nullable=True)
    station_id = Column(UUID(as_uuid=True), ForeignKey("charging_stations.station_id"), nullable=False)
    spot_id = Column(UUID(as_uuid=True), ForeignKey("charging_spots.spot_id"), nullable=False)
    scheduled_start = Column(DateTime(timezone=True), nullable=True)
    scheduled_end = Column(DateTime(timezone=True), nullable=True)
    actual_start = Column(DateTime(timezone=True), nullable=True)
    actual_end = Column(DateTime(timezone=True), nullable=True)
    total_energy_delivered_kwh = Column(Numeric(6, 2), nullable=True)
    charging_cost_coins = Column(Numeric(10, 2), default=0.00, server_default="0.00", nullable=False)

class FoodOrder(Base):
    __tablename__ = "food_orders"

    order_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id = Column(UUID(as_uuid=True), ForeignKey("unified_booking_sessions.session_id", ondelete="SET NULL"), nullable=True)
    restaurant_id = Column(UUID(as_uuid=True), ForeignKey("restaurants.restaurant_id"), nullable=False)
    status = Column(Enum(OrderStatus, name="order_status"), default=OrderStatus.pending, server_default="pending", nullable=False)
    delivery_to_vehicle = Column(Boolean, default=False, server_default="false", nullable=False)
    parking_spot_identifier = Column(String(50), nullable=True)
    total_food_cost_coins = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class OrderItem(Base):
    __tablename__ = "order_items"

    order_item_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    order_id = Column(UUID(as_uuid=True), ForeignKey("food_orders.order_id", ondelete="CASCADE"), nullable=False)
    item_id = Column(UUID(as_uuid=True), ForeignKey("menu_items.item_id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    price_at_purchase_coins = Column(Numeric(10, 2), nullable=False)
