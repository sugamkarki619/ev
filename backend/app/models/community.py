from sqlalchemy import Column, String, Integer, Numeric, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from geoalchemy2 import Geography
from app.models.base import Base

class LocalAmenity(Base):
    __tablename__ = "local_amenities"

    amenity_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name = Column(String(150), nullable=False)
    category = Column(String(100), nullable=True)
    description = Column(String, nullable=True)
    geo_location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)

class StationAmenitiesMapping(Base):
    __tablename__ = "station_amenities_mapping"

    station_id = Column(UUID(as_uuid=True), ForeignKey("charging_stations.station_id", ondelete="CASCADE"), primary_key=True)
    amenity_id = Column(UUID(as_uuid=True), ForeignKey("local_amenities.amenity_id", ondelete="CASCADE"), primary_key=True)
    distance_meters = Column(Numeric(7, 2), nullable=True)

class TravelItinerary(Base):
    __tablename__ = "travel_itineraries"

    itinerary_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(String, nullable=True)
    is_public = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ItineraryStop(Base):
    __tablename__ = "itinerary_stops"

    stop_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    itinerary_id = Column(UUID(as_uuid=True), ForeignKey("travel_itineraries.itinerary_id", ondelete="CASCADE"), nullable=False)
    sequence_order = Column(Integer, nullable=False)
    station_id = Column(UUID(as_uuid=True), ForeignKey("charging_stations.station_id"), nullable=False)
    notes_or_tips = Column(String, nullable=True)

class ItineraryReview(Base):
    __tablename__ = "itinerary_reviews"

    review_id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    itinerary_id = Column(UUID(as_uuid=True), ForeignKey("travel_itineraries.itinerary_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id"), nullable=False)
    rating = Column(Integer, nullable=False)
    comment = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
