import enum
from sqlalchemy import Column, String, Integer, Numeric, Boolean, Time, DateTime, ForeignKey, Enum, func
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geography
from app.models.base import Base
from app.models.vehicle import PlugType

class StationType(str, enum.Enum):
    public_commercial = "public_commercial"
    p2p_home = "p2p_home"

class SlotStatus(str, enum.Enum):
    available = "available"
    occupied = "occupied"
    reserved = "reserved"
    offline = "offline"

class ChargingStation(Base):
    __tablename__ = "charging_stations"

    station_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=True)
    name = Column(String(150), nullable=False)
    type = Column(Enum(StationType, name="station_type"), nullable=False)
    geo_location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    address = Column(String, nullable=False)
    environment_description = Column(String, nullable=True)
    swappable_battery_inventory = Column(Integer, default=0, server_default="0", nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class StationAvailabilitySlot(Base):
    __tablename__ = "station_availability_slots"

    slot_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    station_id = Column(UUID(as_uuid=True), ForeignKey("charging_stations.station_id", ondelete="CASCADE"), nullable=False)
    day_of_week = Column(Integer, nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    price_per_kwh_coins = Column(Numeric(10, 2), nullable=False)

class ChargingSpot(Base):
    __tablename__ = "charging_spots"

    spot_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    station_id = Column(UUID(as_uuid=True), ForeignKey("charging_stations.station_id", ondelete="CASCADE"), nullable=False)
    plug_id = Column(Enum(PlugType, name="plug_type"), nullable=False)
    max_power_kw = Column(Numeric(6, 2), nullable=False)
    status = Column(Enum(SlotStatus, name="slot_status"), default=SlotStatus.available, server_default="available", nullable=False)

class StationAccessProtocol(Base):
    __tablename__ = "station_access_protocols"

    protocol_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    station_id = Column(UUID(as_uuid=True), ForeignKey("charging_stations.station_id", ondelete="CASCADE"), nullable=False)
    gate_code = Column(String(50), nullable=True)
    access_instructions = Column(String, nullable=True)
    automated_iot_trigger_url = Column(String(255), nullable=True)
