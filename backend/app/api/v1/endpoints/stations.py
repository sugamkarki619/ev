from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.station import ChargingStation, ChargingSpot, StationAccessProtocol
from pydantic import BaseModel

router = APIRouter()

class SpotOut(BaseModel):
    spot_id: Any
    plug_id: str
    max_power_kw: float
    status: str

class StationOut(BaseModel):
    station_id: Any
    name: str
    type: str
    address: str
    environment_description: str | None
    swappable_battery_inventory: int
    lat: float
    lon: float
    distance_meters: float
    spots: List[SpotOut]
    access_instructions: str | None

@router.get("/nearby", response_model=List[StationOut])
async def search_nearby_stations(
    lat: float,
    lon: float,
    radius_km: float = 10.0,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    Search for nearby charging stations from a set location using PostGIS geography index.
    Returns list of stations ordered by proximity.
    """
    # Create WKT point string: POINT(longitude latitude)
    point_wkt = f"POINT({lon} {lat})"
    
    try:
        # Query stations within radius using ST_DWithin, ordering by ST_Distance
        # Also select ST_AsText to parse latitude and longitude
        geog_point = func.ST_GeographyFromText(point_wkt)
        query = select(
            ChargingStation,
            func.ST_Distance(ChargingStation.geo_location, geog_point).label("distance"),
            func.ST_AsText(ChargingStation.geo_location).label("wkt")
        ).where(
            func.ST_DWithin(ChargingStation.geo_location, geog_point, radius_km * 1000)
        ).order_by(
            func.ST_Distance(ChargingStation.geo_location, geog_point)
        )
        
        result = await db.execute(query)
        stations_data = []
        
        for row in result.all():
            station = row[0]
            distance = float(row[1])
            wkt_str = row[2]
            
            # Extract coordinates from POINT(lon lat) WKT
            # e.g. "POINT(9.5215 47.1415)"
            coord_part = wkt_str.replace("POINT(", "").replace(")", "")
            station_lon, station_lat = map(float, coord_part.split())
            
            # Query charging spots for this station
            spots_query = select(ChargingSpot).where(ChargingSpot.station_id == station.station_id)
            spots_res = await db.execute(spots_query)
            spots = spots_res.scalars().all()
            
            # Require at least one available spot for nearby station search
            from app.models.station import SlotStatus
            if not any(spot.status == SlotStatus.available for spot in spots):
                continue
            
            # Map spots schemas
            mapped_spots = [
                SpotOut(
                    spot_id=spot.spot_id,
                    plug_id=spot.plug_id.value if hasattr(spot.plug_id, "value") else str(spot.plug_id),
                    max_power_kw=float(spot.max_power_kw),
                    status=spot.status.value if hasattr(spot.status, "value") else str(spot.status)
                )
                for spot in spots
            ]
            
            # Query access protocol (if home station)
            access_query = select(StationAccessProtocol).where(StationAccessProtocol.station_id == station.station_id)
            access_res = await db.execute(access_query)
            access = access_res.scalars().first()
            instructions = access.access_instructions if access else None
            
            stations_data.append(
                StationOut(
                    station_id=station.station_id,
                    name=station.name,
                    type=station.type.value if hasattr(station.type, "value") else str(station.type),
                    address=station.address,
                    environment_description=station.environment_description,
                    swappable_battery_inventory=station.swappable_battery_inventory,
                    lat=station_lat,
                    lon=station_lon,
                    distance_meters=distance,
                    spots=mapped_spots,
                    access_instructions=instructions
                )
            )
            
        return stations_data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error performing nearby search: {str(e)}"
        )
