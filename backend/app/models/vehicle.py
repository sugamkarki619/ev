import enum
from sqlalchemy import Column, String, Numeric, Boolean, ForeignKey, Enum, func
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from app.models.base import Base

class PlugType(str, enum.Enum):
    Type2 = "Type2"
    CCS2 = "CCS2"
    CHAdeMO = "CHAdeMO"
    Tesla_Supercharger = "Tesla_Supercharger"
    GB_T = "GB_T"

class VehicleCatalog(Base):
    __tablename__ = "vehicle_catalog"

    model_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    brand = Column(String(100), nullable=False)
    model_name = Column(String(100), nullable=False)
    battery_capacity_kwh = Column(Numeric(6, 2), nullable=False)
    base_drag_coefficient = Column(Numeric(4, 3), nullable=False)
    supported_plugs = Column(ARRAY(Enum(PlugType, name="plug_type")), nullable=False)

class UserVehicle(Base):
    __tablename__ = "user_vehicles"

    user_vehicle_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    model_id = Column(UUID(as_uuid=True), ForeignKey("vehicle_catalog.model_id"), nullable=False)
    license_plate = Column(String(20), nullable=True)
    current_battery_percent = Column(Numeric(5, 2), nullable=False)
    battery_degradation_factor = Column(Numeric(3, 2), default=1.00, server_default="1.00", nullable=False)
    custom_aerodynamic_rating = Column(Numeric(4, 3), nullable=True)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
