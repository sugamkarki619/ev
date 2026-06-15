from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.commerce import Restaurant, Menu, MenuItem
from pydantic import BaseModel

router = APIRouter()

class MenuItemOut(BaseModel):
    item_id: Any
    name: str
    description: Optional[str] = None
    price_coins: float
    is_available: bool

    class Config:
        from_attributes = True

class RestaurantOut(BaseModel):
    restaurant_id: Any
    owner_id: Any
    associated_station_id: Optional[Any] = None
    name: str
    lat: float
    lon: float
    is_open: bool

@router.get("", response_model=List[RestaurantOut])
async def list_restaurants(
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    List all restaurants with their locations decoded from PostGIS geometry.
    """
    try:
        query = select(
            Restaurant,
            func.ST_AsText(Restaurant.geo_location).label("wkt")
        )
        result = await db.execute(query)
        restaurants_data = []

        for row in result.all():
            restaurant = row[0]
            wkt_str = row[1]
            
            lat, lon = 0.0, 0.0
            if wkt_str:
                # Extract coordinates from POINT(lon lat) WKT
                coord_part = wkt_str.replace("POINT(", "").replace(")", "")
                lon, lat = map(float, coord_part.split())
                
            restaurants_data.append(
                RestaurantOut(
                    restaurant_id=restaurant.restaurant_id,
                    owner_id=restaurant.owner_id,
                    associated_station_id=restaurant.associated_station_id,
                    name=restaurant.name,
                    lat=lat,
                    lon=lon,
                    is_open=restaurant.is_open
                )
            )
        return restaurants_data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error listing restaurants: {str(e)}"
        )

@router.get("/{restaurant_id}/menu", response_model=List[MenuItemOut])
async def get_restaurant_menu_items(
    restaurant_id: Any,
    db: AsyncSession = Depends(get_db)
) -> Any:
    """
    Get all active menu items for a specific restaurant.
    """
    # Verify restaurant exists
    res_query = select(Restaurant).where(Restaurant.restaurant_id == restaurant_id)
    res_check = await db.execute(res_query)
    if not res_check.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Restaurant not found."
        )
        
    # Get active menus
    menu_query = select(Menu).where(Menu.restaurant_id == restaurant_id, Menu.is_active == True)
    menus_res = await db.execute(menu_query)
    menus = menus_res.scalars().all()
    menu_ids = [m.menu_id for m in menus]
    
    if not menu_ids:
        return []
        
    # Get items for these menus
    items_query = select(MenuItem).where(MenuItem.menu_id.in_(menu_ids), MenuItem.is_available == True)
    items_res = await db.execute(items_query)
    items = items_res.scalars().all()
    
    return [
        MenuItemOut(
            item_id=item.item_id,
            name=item.name,
            description=item.description,
            price_coins=float(item.price_coins),
            is_available=item.is_available
        )
        for item in items
    ]
