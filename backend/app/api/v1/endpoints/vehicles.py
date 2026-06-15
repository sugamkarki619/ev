from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.deps import get_current_active_user
from app.models.user import User
from app.models.vehicle import VehicleCatalog, UserVehicle
from pydantic import BaseModel, Field

router = APIRouter()

class VehicleCatalogOut(BaseModel):
    model_id: Any
    brand: str
    model_name: str
    battery_capacity_kwh: float
    base_drag_coefficient: float
    supported_plugs: List[str]

    class Config:
        from_attributes = True

class UserVehicleCreate(BaseModel):
    model_id: Any
    license_plate: str | None = None
    current_battery_percent: float = Field(..., ge=0, le=100)
    battery_degradation_factor: float = Field(1.0, ge=0.5, le=1.0)
    custom_aerodynamic_rating: float | None = None

class UserVehicleUpdate(BaseModel):
    current_battery_percent: float = Field(..., ge=0, le=100)
    battery_degradation_factor: float = Field(1.0, ge=0.5, le=1.0)
    custom_aerodynamic_rating: float | None = None
    is_active: bool = True

class UserVehicleOut(BaseModel):
    user_vehicle_id: Any
    user_id: Any
    model_id: Any
    license_plate: str | None
    current_battery_percent: float
    battery_degradation_factor: float
    custom_aerodynamic_rating: float | None
    is_active: bool
    catalog_model: VehicleCatalogOut | None = None

    class Config:
        from_attributes = True

@router.get("/catalog", response_model=List[VehicleCatalogOut])
async def get_vehicle_catalog(db: AsyncSession = Depends(get_db)) -> Any:
    """Get the list of supported vehicle models from the catalog."""
    result = await db.execute(select(VehicleCatalog))
    catalog_items = result.scalars().all()
    
    # Map supported_plugs enums to string arrays
    mapped_catalog = []
    for item in catalog_items:
        plugs = [p.value if hasattr(p, "value") else str(p) for p in item.supported_plugs]
        mapped_catalog.append(
            VehicleCatalogOut(
                model_id=item.model_id,
                brand=item.brand,
                model_name=item.model_name,
                battery_capacity_kwh=float(item.battery_capacity_kwh),
                base_drag_coefficient=float(item.base_drag_coefficient),
                supported_plugs=plugs
            )
        )
    return mapped_catalog

@router.get("/me", response_model=List[UserVehicleOut])
async def get_my_vehicles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> Any:
    """Retrieve all vehicles currently configured in the user profile."""
    query = select(UserVehicle).where(UserVehicle.user_id == current_user.user_id)
    result = await db.execute(query)
    user_vehicles = result.scalars().all()
    
    mapped_vehicles = []
    for uv in user_vehicles:
        # Load catalog model details
        cat_query = select(VehicleCatalog).where(VehicleCatalog.model_id == uv.model_id)
        cat_res = await db.execute(cat_query)
        cat = cat_res.scalars().first()
        
        cat_out = None
        if cat:
            cat_out = VehicleCatalogOut(
                model_id=cat.model_id,
                brand=cat.brand,
                model_name=cat.model_name,
                battery_capacity_kwh=float(cat.battery_capacity_kwh),
                base_drag_coefficient=float(cat.base_drag_coefficient),
                supported_plugs=[p.value if hasattr(p, "value") else str(p) for p in cat.supported_plugs]
            )
            
        mapped_vehicles.append(
            UserVehicleOut(
                user_vehicle_id=uv.user_vehicle_id,
                user_id=uv.user_id,
                model_id=uv.model_id,
                license_plate=uv.license_plate,
                current_battery_percent=float(uv.current_battery_percent),
                battery_degradation_factor=float(uv.battery_degradation_factor),
                custom_aerodynamic_rating=float(uv.custom_aerodynamic_rating) if uv.custom_aerodynamic_rating else None,
                is_active=uv.is_active,
                catalog_model=cat_out
            )
        )
        
    return mapped_vehicles

@router.post("/me", response_model=UserVehicleOut)
async def create_user_vehicle(
    obj_in: UserVehicleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> Any:
    """Add a new vehicle profile to the logged-in user."""
    # Check if catalog model exists
    cat_query = select(VehicleCatalog).where(VehicleCatalog.model_id == obj_in.model_id)
    cat_res = await db.execute(cat_query)
    cat = cat_res.scalars().first()
    if not cat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehicle catalog model not found."
        )

    # Set all other user vehicles to inactive if this is marked active
    await db.execute(
        update(UserVehicle)
        .where(UserVehicle.user_id == current_user.user_id)
        .values(is_active=False)
    )
    
    db_obj = UserVehicle(
        user_id=current_user.user_id,
        model_id=obj_in.model_id,
        license_plate=obj_in.license_plate,
        current_battery_percent=obj_in.current_battery_percent,
        battery_degradation_factor=obj_in.battery_degradation_factor,
        custom_aerodynamic_rating=obj_in.custom_aerodynamic_rating,
        is_active=True
    )
    db.add(db_obj)
    await db.commit()
    await db.refresh(db_obj)
    
    cat_out = VehicleCatalogOut(
        model_id=cat.model_id,
        brand=cat.brand,
        model_name=cat.model_name,
        battery_capacity_kwh=float(cat.battery_capacity_kwh),
        base_drag_coefficient=float(cat.base_drag_coefficient),
        supported_plugs=[p.value if hasattr(p, "value") else str(p) for p in cat.supported_plugs]
    )
    
    return UserVehicleOut(
        user_vehicle_id=db_obj.user_vehicle_id,
        user_id=db_obj.user_id,
        model_id=db_obj.model_id,
        license_plate=db_obj.license_plate,
        current_battery_percent=float(db_obj.current_battery_percent),
        battery_degradation_factor=float(db_obj.battery_degradation_factor),
        custom_aerodynamic_rating=float(db_obj.custom_aerodynamic_rating) if db_obj.custom_aerodynamic_rating else None,
        is_active=db_obj.is_active,
        catalog_model=cat_out
    )

@router.put("/me/{user_vehicle_id}", response_model=UserVehicleOut)
async def update_user_vehicle(
    user_vehicle_id: Any,
    obj_in: UserVehicleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> Any:
    """Update battery SOC and degradation factor on a specific vehicle profile."""
    # Find user vehicle
    query = select(UserVehicle).where(
        UserVehicle.user_vehicle_id == user_vehicle_id,
        UserVehicle.user_id == current_user.user_id
    )
    res = await db.execute(query)
    uv = res.scalars().first()
    if not uv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User vehicle profile not found."
        )
        
    # If setting to active, make all others inactive
    if obj_in.is_active:
        await db.execute(
            update(UserVehicle)
            .where(
                UserVehicle.user_id == current_user.user_id,
                UserVehicle.user_vehicle_id != user_vehicle_id
            )
            .values(is_active=False)
        )
        
    uv.current_battery_percent = obj_in.current_battery_percent
    uv.battery_degradation_factor = obj_in.battery_degradation_factor
    uv.custom_aerodynamic_rating = obj_in.custom_aerodynamic_rating
    uv.is_active = obj_in.is_active
    
    db.add(uv)
    await db.commit()
    await db.refresh(uv)
    
    # Load catalog model details
    cat_query = select(VehicleCatalog).where(VehicleCatalog.model_id == uv.model_id)
    cat_res = await db.execute(cat_query)
    cat = cat_res.scalars().first()
    cat_out = None
    if cat:
        cat_out = VehicleCatalogOut(
            model_id=cat.model_id,
            brand=cat.brand,
            model_name=cat.model_name,
            battery_capacity_kwh=float(cat.battery_capacity_kwh),
            base_drag_coefficient=float(cat.base_drag_coefficient),
            supported_plugs=[p.value if hasattr(p, "value") else str(p) for p in cat.supported_plugs]
        )
        
    return UserVehicleOut(
        user_vehicle_id=uv.user_vehicle_id,
        user_id=uv.user_id,
        model_id=uv.model_id,
        license_plate=uv.license_plate,
        current_battery_percent=float(uv.current_battery_percent),
        battery_degradation_factor=float(uv.battery_degradation_factor),
        custom_aerodynamic_rating=float(uv.custom_aerodynamic_rating) if uv.custom_aerodynamic_rating else None,
        is_active=uv.is_active,
        catalog_model=cat_out
    )
