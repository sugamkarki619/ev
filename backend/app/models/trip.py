from sqlalchemy import Column, Integer, Numeric, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geography
from app.models.base import Base

class Trip(Base):
    __tablename__ = "trips"

    trip_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False)
    user_vehicle_id = Column(UUID(as_uuid=True), ForeignKey("user_vehicles.user_vehicle_id"), nullable=False)
    start_location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    end_location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    estimated_arrival_time = Column(DateTime(timezone=True), nullable=True)
    current_eta_to_next_stop = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class TripWaypoint(Base):
    __tablename__ = "trip_waypoints"

    waypoint_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    trip_id = Column(UUID(as_uuid=True), ForeignKey("trips.trip_id", ondelete="CASCADE"), nullable=False)
    sequence_order = Column(Integer, nullable=False)
    geo_location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    elevation_meters = Column(Numeric(6, 2), nullable=True)
    predicted_wind_direction_deg = Column(Integer, nullable=True)
    predicted_wind_speed_mps = Column(Numeric(4, 2), nullable=True)
    associated_station_id = Column(UUID(as_uuid=True), ForeignKey("charging_stations.station_id", ondelete="SET NULL"), nullable=True)
