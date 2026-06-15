from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.community import LocalAmenity
from pydantic import BaseModel

router = APIRouter()

class AmenityOut(BaseModel):
    amenity_id: Any
    name: str
    category: Optional[str] = None
    description: Optional[str] = None
    lat: float
    lon: float

@router.get("", response_model=List[AmenityOut])
async def list_amenities(
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    List all local amenities with their locations decoded from PostGIS geometry.
    """
    try:
        query = select(
            LocalAmenity,
            func.ST_AsText(LocalAmenity.geo_location).label("wkt")
        )
        result = await db.execute(query)
        amenities_data = []

        for row in result.all():
            amenity = row[0]
            wkt_str = row[1]
            
            lat, lon = 0.0, 0.0
            if wkt_str:
                coord_part = wkt_str.replace("POINT(", "").replace(")", "")
                lon, lat = map(float, coord_part.split())
                
            amenities_data.append(
                AmenityOut(
                    amenity_id=amenity.amenity_id,
                    name=amenity.name,
                    category=amenity.category,
                    description=amenity.description,
                    lat=lat,
                    lon=lon
                )
            )
        return amenities_data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error listing amenities: {str(e)}"
        )
