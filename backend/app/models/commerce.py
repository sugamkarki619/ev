from sqlalchemy import Column, String, Boolean, Numeric, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geography
from app.models.base import Base

class Restaurant(Base):
    __tablename__ = "restaurants"

    restaurant_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    associated_station_id = Column(UUID(as_uuid=True), ForeignKey("charging_stations.station_id"), nullable=True)
    name = Column(String(150), nullable=False)
    geo_location = Column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    is_open = Column(Boolean, default=True, server_default="true", nullable=False)

class Menu(Base):
    __tablename__ = "menus"

    menu_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    restaurant_id = Column(UUID(as_uuid=True), ForeignKey("restaurants.restaurant_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)

class MenuItem(Base):
    __tablename__ = "menu_items"

    item_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    menu_id = Column(UUID(as_uuid=True), ForeignKey("menus.menu_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(150), nullable=False)
    description = Column(String, nullable=True)
    price_coins = Column(Numeric(10, 2), nullable=False)
    is_available = Column(Boolean, default=True, server_default="true", nullable=False)
