from typing import Any, List, Optional
from datetime import datetime, timedelta
import httpx
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_current_active_user
from app.models.user import User
from app.models.vehicle import UserVehicle, VehicleCatalog
from app.models.station import ChargingStation, ChargingSpot, StationAvailabilitySlot
from app.models.commerce import Restaurant
from app.models.community import LocalAmenity
from app.models.trip import Trip, TripWaypoint

router = APIRouter()

# Helper: Decode Valhalla's polyline6 format
def decode_polyline6(encoded: str) -> List[List[float]]:
    index, lat, lng = 0, 0, 0
    coordinates = []
    factor = 1e6
    length = len(encoded)
    while index < length:
        byte, shift, result = 0, 0, 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1f) << shift
            shift += 5
            if byte < 0x20:
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat

        shift, result = 0, 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 0x1f) << shift
            shift += 5
            if byte < 0x20:
                break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += dlng
        
        coordinates.append([lat / factor, lng / factor])
    return coordinates

# Helper: Encode coordinates to Valhalla's polyline6 format
def encode_polyline6(coords: List[List[float]]) -> str:
    result = []
    last_lat = 0
    last_lng = 0
    factor = 1e6
    for lat, lng in coords:
        lat_val = int(round(lat * factor))
        lng_val = int(round(lng * factor))
        
        d_lat = lat_val - last_lat
        d_lng = lng_val - last_lng
        
        last_lat = lat_val
        last_lng = lng_val
        
        for val in [d_lat, d_lng]:
            val = ~(val << 1) if val < 0 else (val << 1)
            while val >= 0x20:
                result.append(chr((0x20 | (val & 0x1f)) + 63))
                val >>= 5
            result.append(chr(val + 63))
            
    return "".join(result)

# Helper: Calculate straight-line distance in km using Haversine formula
import math
def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0 # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c

def get_route_distance_to_point(route: List[List[float]], target_lat: float, target_lon: float) -> float:
    if not route:
        return 0.0
    # Find the index of the coordinate on the route closest to the target point
    min_dist = float('inf')
    closest_idx = 0
    for idx, pt in enumerate(route):
        d = haversine_distance(pt[0], pt[1], target_lat, target_lon)
        if d < min_dist:
            min_dist = d
            closest_idx = idx
            
    # Calculate cumulative route distance from start to that point
    dist = 0.0
    for idx in range(closest_idx):
        dist += haversine_distance(route[idx][0], route[idx][1], route[idx+1][0], route[idx+1][1])
    return dist

# Request schemas
class StopInput(BaseModel):
    lat: float
    lon: float
    name: Optional[str] = None
    station_id: Optional[str] = None

class TripPlanReq(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float
    vehicle_id: str
    custom_stops: List[StopInput] = []

class TripCreateReq(BaseModel):
    user_vehicle_id: str
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float
    estimated_arrival_time: Optional[datetime] = None
    waypoints: List[StopInput] = []

# Response schemas
class SpotOut(BaseModel):
    spot_id: Any
    plug_id: str
    max_power_kw: float
    status: str

class StationAlongRoute(BaseModel):
    station_id: Any
    name: str
    type: str
    address: str
    lat: float
    lon: float
    distance_from_route_meters: float
    spots: List[SpotOut]
    arrival_soc: float
    charge_cost_coins: float
    route_distance_km: float = 0.0

class RestaurantAlongRoute(BaseModel):
    restaurant_id: Any
    associated_station_id: Optional[Any] = None
    name: str
    lat: float
    lon: float

class AmenityAlongRoute(BaseModel):
    amenity_id: Any
    name: str
    category: Optional[str] = None
    description: Optional[str] = None
    lat: float
    lon: float

class RecommendedStop(BaseModel):
    station_id: Any
    name: str
    lat: float
    lon: float
    charge_needed_kwh: float
    charge_time_mins: int
    charge_cost_coins: float

class WaypointEstimate(BaseModel):
    sequence_order: int
    name: str
    lat: float
    lon: float
    arrival_soc: float
    charge_cost_coins: float

class TripPlanResponse(BaseModel):
    polyline: str
    distance_km: float
    duration_mins: int
    start_soc: float
    end_soc: float
    requires_charge: bool
    recommended_stop: Optional[RecommendedStop] = None
    stations_along_route: List[StationAlongRoute]
    restaurants_along_route: List[RestaurantAlongRoute]
    amenities_along_route: List[AmenityAlongRoute]
    waypoint_estimates: List[WaypointEstimate]

class WaypointOut(BaseModel):
    waypoint_id: Any
    sequence_order: int
    lat: float
    lon: float
    associated_station_id: Optional[Any] = None

class TripOut(BaseModel):
    trip_id: Any
    user_vehicle_id: Any
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float
    estimated_arrival_time: Optional[datetime]
    created_at: datetime
    waypoints: List[WaypointOut]

@router.post("/plan", response_model=TripPlanResponse)
async def plan_route(
    req: TripPlanReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> Any:
    """
    Calculate route via Valhalla, find charging stations/restaurants/amenities along the path,
    apply electric vehicle physics to estimate SoC and recommend stops.
    """
    # 1. Fetch user vehicle details
    vehicle_query = select(UserVehicle).where(
        UserVehicle.user_vehicle_id == req.vehicle_id,
        UserVehicle.user_id == current_user.user_id
    )
    v_res = await db.execute(vehicle_query)
    vehicle = v_res.scalars().first()
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User vehicle profile not found."
        )
        
    cat_query = select(VehicleCatalog).where(VehicleCatalog.model_id == vehicle.model_id)
    cat_res = await db.execute(cat_query)
    catalog = cat_res.scalars().first()
    if not catalog:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vehicle catalog specifications not found."
        )

    # 2. Call Valhalla routing engine
    valhalla_locations = [
        {"lat": req.start_lat, "lon": req.start_lon, "type": "break"}
    ]
    for stop in req.custom_stops:
        valhalla_locations.append({"lat": stop.lat, "lon": stop.lon, "type": "break"})
    valhalla_locations.append({"lat": req.end_lat, "lon": req.end_lon, "type": "break"})

    valhalla_payload = {
        "locations": valhalla_locations,
        "costing": "auto",
        "directions_options": {
            "units": "kilometers",
            "language": "en-US"
        }
    }

    try:
        async with httpx.AsyncClient() as client:
            valhalla_response = await client.get(
                f"{settings.VALHALLA_URL}/optimized_route",
                params={"json": json.dumps(valhalla_payload)},
                timeout=10.0
            )
        if valhalla_response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Valhalla routing engine error: {valhalla_response.text}"
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not connect to Valhalla routing engine at {settings.VALHALLA_URL}: {str(e)}"
        )

    valhalla_data = valhalla_response.json()
    trip = valhalla_data.get("trip", {})
    legs = trip.get("legs", [])
    if not legs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No route legs returned by Valhalla."
        )
        
    # Decode coordinates from all legs to form the complete route path
    decoded_coords = []
    for leg in legs:
        leg_shape = leg.get("shape", "")
        if leg_shape:
            decoded_coords.extend(decode_polyline6(leg_shape))
            
    if not decoded_coords:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to decode Valhalla route polyline shape."
        )

    # Re-encode the complete concatenated path to polyline6 for frontend Leaflet plotting
    shape = encode_polyline6(decoded_coords)
    summary = trip.get("summary", {})
    distance_km = float(summary.get("length", 0.0))
    duration_mins = int(round(summary.get("time", 0.0) / 60.0))

    # Construct LINESTRING(lon lat, ...)
    wkt_line = "LINESTRING(" + ", ".join(f"{lon} {lat}" for lat, lon in decoded_coords) + ")"
    geog_line = func.ST_GeographyFromText(wkt_line)

    # 3. Spatial Queries along the route (within 10000m buffer)
    # Charging Stations
    stations_q = select(
        ChargingStation,
        func.ST_Distance(ChargingStation.geo_location, geog_line).label("distance"),
        func.ST_AsText(ChargingStation.geo_location).label("wkt")
    ).where(
        func.ST_DWithin(ChargingStation.geo_location, geog_line, 10000.0)
    )
    stations_res = await db.execute(stations_q)
    
    # Calculate vehicle factors for charging estimates
    start_soc = float(vehicle.current_battery_percent)
    capacity = float(catalog.battery_capacity_kwh)
    drag_coeff = float(catalog.base_drag_coefficient)
    degradation = float(vehicle.battery_degradation_factor)
    
    base_consumption = 0.165
    drag_penalty = (drag_coeff - 0.230) * 0.5
    degradation_penalty = (1.0 - degradation) * 0.15
    rate_kwh = base_consumption + drag_penalty + degradation_penalty

    stations_along = []
    for row in stations_res.all():
        station = row[0]
        distance = float(row[1])
        wkt = row[2]
        
        # Decode station coords
        wkt_clean = wkt.replace("POINT(", "").replace(")", "")
        s_lon, s_lat = map(float, wkt_clean.split())
        
        # Load station spots
        spots_q = select(ChargingSpot).where(ChargingSpot.station_id == station.station_id)
        spots_res = await db.execute(spots_q)
        all_spots = spots_res.scalars().all()
        
        # Filter for vehicle plug compatibility
        supported_plug_strings = [
            p.value if hasattr(p, "value") else str(p)
            for p in catalog.supported_plugs
        ]
        compatible_spots = [
            spot for spot in all_spots
            if (spot.plug_id.value if hasattr(spot.plug_id, "value") else str(spot.plug_id)) in supported_plug_strings
        ]
        
        # Skip this station entirely if there are no compatible plugs
        if not compatible_spots:
            continue
            
        mapped_spots = [
            SpotOut(
                spot_id=spot.spot_id,
                plug_id=spot.plug_id.value if hasattr(spot.plug_id, "value") else str(spot.plug_id),
                max_power_kw=float(spot.max_power_kw),
                status=spot.status.value if hasattr(spot.status, "value") else str(spot.status)
            )
            for spot in compatible_spots
        ]
        
        # Calculate arrival SOC and charging cost for this station using actual route distance
        dist_to_station = get_route_distance_to_point(decoded_coords, s_lat, s_lon)
        dist_to_station = min(dist_to_station, distance_km)
        st_soc_consumed = (dist_to_station * rate_kwh / capacity) * 100
        st_arrival_soc = max(start_soc - st_soc_consumed, 0.0)
        
        st_charge_cost = 0.0
        if st_arrival_soc < 80.0:
            st_charge_needed_kwh = ((80.0 - st_arrival_soc) / 100.0) * capacity
            st_charge_cost = st_charge_needed_kwh * 0.35
            
        stations_along.append(
            StationAlongRoute(
                station_id=station.station_id,
                name=station.name,
                type=station.type.value if hasattr(station.type, "value") else str(station.type),
                address=station.address,
                lat=s_lat,
                lon=s_lon,
                distance_from_route_meters=distance,
                spots=mapped_spots,
                arrival_soc=float(round(st_arrival_soc, 1)),
                charge_cost_coins=float(round(st_charge_cost, 2)),
                route_distance_km=float(round(dist_to_station, 2))
            )
        )

    # Restaurants (10000m buffer)
    restaurants_q = select(
        Restaurant,
        func.ST_Distance(Restaurant.geo_location, geog_line).label("distance"),
        func.ST_AsText(Restaurant.geo_location).label("wkt")
    ).where(
        func.ST_DWithin(Restaurant.geo_location, geog_line, 10000.0)
    )
    restaurants_res = await db.execute(restaurants_q)
    restaurants_along = []
    for row in restaurants_res.all():
        r = row[0]
        wkt = row[2]
        if wkt:
            wkt_clean = wkt.replace("POINT(", "").replace(")", "")
            r_lon, r_lat = map(float, wkt_clean.split())
            restaurants_along.append(
                RestaurantAlongRoute(
                    restaurant_id=r.restaurant_id,
                    associated_station_id=r.associated_station_id,
                    name=r.name,
                    lat=r_lat,
                    lon=r_lon
                )
            )

    # Amenities (10000m buffer)
    amenities_q = select(
        LocalAmenity,
        func.ST_Distance(LocalAmenity.geo_location, geog_line).label("distance"),
        func.ST_AsText(LocalAmenity.geo_location).label("wkt")
    ).where(
        func.ST_DWithin(LocalAmenity.geo_location, geog_line, 10000.0)
    )
    amenities_res = await db.execute(amenities_q)
    amenities_along = []
    for row in amenities_res.all():
        a = row[0]
        wkt = row[2]
        if wkt:
            wkt_clean = wkt.replace("POINT(", "").replace(")", "")
            a_lon, a_lat = map(float, wkt_clean.split())
            amenities_along.append(
                AmenityAlongRoute(
                    amenity_id=a.amenity_id,
                    name=a.name,
                    category=a.category,
                    description=a.description,
                    lat=a_lat,
                    lon=a_lon
                )
            )

    # 4. EV Driving Physics
    energy_required_kwh = distance_km * rate_kwh
    soc_consumed = (energy_required_kwh / capacity) * 100
    end_soc = start_soc - soc_consumed
    
    requires_charge = end_soc < 15.0 # Need to keep at least 15% SoC buffer
    recommended_stop = None
    
    # If charge needed, select the best charging stop
    if requires_charge and stations_along:
        best_station = None
        min_detour = float('inf')
        
        # Prioritize stations that can be reached with >= 10.0% SoC
        reachable_candidates = [st for st in stations_along if st.arrival_soc >= 10.0]
        # Fall back to all candidates if none are reachable with >= 10% SoC
        candidates = reachable_candidates if reachable_candidates else stations_along
        
        for st in candidates:
            if st.spots:
                max_spot_power = max(sp.max_power_kw for sp in st.spots)
            else:
                max_spot_power = 22.0
                
            # Detour score incorporates route progress: lower score is better.
            # Reward stations that are further along the route to maximize initial charge usage.
            detour_score = st.distance_from_route_meters - (st.route_distance_km * 300.0)
            if st.type == "public_commercial":
                detour_score -= 200.0
            if max_spot_power >= 50.0:
                detour_score -= 300.0
                
            if detour_score < min_detour:
                min_detour = detour_score
                best_station = st
                
        if best_station:
            # Let's find where to insert the charging station waypoint in the custom stops sequence
            best_st_idx = 0
            min_st_dist = float('inf')
            for idx, pt in enumerate(decoded_coords):
                d = haversine_distance(pt[0], pt[1], best_station.lat, best_station.lon)
                if d < min_st_dist:
                    min_st_dist = d
                    best_st_idx = idx
            
            stop_indices = []
            for stop in req.custom_stops:
                min_stop_dist = float('inf')
                stop_idx = 0
                for idx, pt in enumerate(decoded_coords):
                    d = haversine_distance(pt[0], pt[1], stop.lat, stop.lon)
                    if d < min_stop_dist:
                        min_stop_dist = d
                        stop_idx = idx
                stop_indices.append(stop_idx)
                
            insert_pos = 0
            for idx, stop_idx in enumerate(stop_indices):
                if best_st_idx > stop_idx:
                    insert_pos = idx + 1
            
            # Re-run Valhalla routing with detoured locations
            valhalla_locations = [
                {"lat": req.start_lat, "lon": req.start_lon, "type": "break"}
            ]
            modified_stops = list(req.custom_stops)
            modified_stops.insert(insert_pos, StopInput(
                lat=best_station.lat,
                lon=best_station.lon,
                name=f"Charging Stop: {best_station.name}",
                station_id=str(best_station.station_id)
            ))
            for stop in modified_stops:
                valhalla_locations.append({"lat": stop.lat, "lon": stop.lon, "type": "break"})
            valhalla_locations.append({"lat": req.end_lat, "lon": req.end_lon, "type": "break"})
            
            valhalla_payload = {
                "locations": valhalla_locations,
                "costing": "auto",
                "directions_options": {
                    "units": "kilometers",
                    "language": "en-US"
                }
            }
            
            # Call Valhalla to get detour route shape & statistics
            try:
                async with httpx.AsyncClient() as client:
                    valhalla_response = await client.get(
                        f"{settings.VALHALLA_URL}/optimized_route",
                        params={"json": json.dumps(valhalla_payload)},
                        timeout=10.0
                    )
                if valhalla_response.status_code == 200:
                    valhalla_data = valhalla_response.json()
                    trip_detour = valhalla_data.get("trip", {})
                    legs_detour = trip_detour.get("legs", [])
                    if legs_detour:
                        # Decode and construct the detour coordinates
                        decoded_coords_detour = []
                        for leg in legs_detour:
                            leg_shape = leg.get("shape", "")
                            if leg_shape:
                                decoded_coords_detour.extend(decode_polyline6(leg_shape))
                                
                        if decoded_coords_detour:
                            # Re-assign polyline and shape metrics
                            decoded_coords = decoded_coords_detour
                            shape = encode_polyline6(decoded_coords)
                            summary_detour = trip_detour.get("summary", {})
                            distance_km = float(summary_detour.get("length", 0.0))
                            duration_mins = int(round(summary_detour.get("time", 0.0) / 60.0))
                            legs = legs_detour
            except Exception as e:
                # If Valhalla fails, fall back to first routing result
                pass
                
            # Now calculate the exact road distance up to the charging station (insert_pos)
            dist_to_station = 0.0
            for idx in range(insert_pos + 1):
                if idx < len(legs):
                    dist_to_station += float(legs[idx].get("summary", {}).get("length", 0.0))
            
            dist_to_station = min(dist_to_station, distance_km)
            soc_consumed_to_station = (dist_to_station * rate_kwh / capacity) * 100
            arrival_soc_at_station = max(start_soc - soc_consumed_to_station, 0.0)
            
            target_soc = 80.0
            soc_diff = target_soc - arrival_soc_at_station
            charge_needed_kwh = (soc_diff / 100.0) * capacity
            
            max_power = 22.0
            if best_station.spots:
                max_power = max(sp.max_power_kw for sp in best_station.spots)
            
            charge_time_mins = int(round((charge_needed_kwh / max_power) * 60.0))
            charge_cost_coins = float(round(charge_needed_kwh * 0.35, 2))
            
            recommended_stop = RecommendedStop(
                station_id=best_station.station_id,
                name=best_station.name,
                lat=best_station.lat,
                lon=best_station.lon,
                charge_needed_kwh=float(round(charge_needed_kwh, 2)),
                charge_time_mins=max(charge_time_mins, 15),
                charge_cost_coins=charge_cost_coins
            )
            
            # Recalculate remaining trip SoC from target_soc (80%)
            dist_from_station_to_end = max(distance_km - dist_to_station, 0.0)
            soc_consumed_from_station = (dist_from_station_to_end * rate_kwh / capacity) * 100
            end_soc = max(target_soc - soc_consumed_from_station, 0.0)
            duration_mins += recommended_stop.charge_time_mins
            
            # Compute waypoint estimates with top-up at insert_pos
            waypoint_estimates = []
            current_soc = start_soc
            for idx, stop in enumerate(modified_stops):
                leg_dist = 0.0
                if idx < len(legs):
                    leg_dist = float(legs[idx].get("summary", {}).get("length", 0.0))
                wp_soc_consumed = (leg_dist * rate_kwh / capacity) * 100
                current_soc = max(current_soc - wp_soc_consumed, 0.0)
                
                if idx == insert_pos:
                    # Charging stop tops up battery to 80%
                    current_soc = 80.0
                else:
                    # Original custom stops sequence tracking
                    orig_idx = idx if idx < insert_pos else idx - 1
                    wp_charge_cost = 0.0
                    if current_soc < 80.0:
                        wp_charge_needed_kwh = ((80.0 - current_soc) / 100.0) * capacity
                        wp_charge_cost = wp_charge_needed_kwh * 0.35
                    waypoint_estimates.append(
                        WaypointEstimate(
                            sequence_order=orig_idx + 1,
                            name=stop.name or f"Stop {orig_idx + 1}",
                            lat=stop.lat,
                            lon=stop.lon,
                            arrival_soc=float(round(current_soc, 1)),
                            charge_cost_coins=float(round(wp_charge_cost, 2))
                        )
                    )
        else:
            # Requires charge but no station found
            waypoint_estimates = []
            current_soc = start_soc
            for idx, stop in enumerate(req.custom_stops):
                leg_dist = 0.0
                if idx < len(legs):
                    leg_dist = float(legs[idx].get("summary", {}).get("length", 0.0))
                wp_soc_consumed = (leg_dist * rate_kwh / capacity) * 100
                current_soc = max(current_soc - wp_soc_consumed, 0.0)
                wp_charge_cost = 0.0
                if current_soc < 80.0:
                    wp_charge_needed_kwh = ((80.0 - current_soc) / 100.0) * capacity
                    wp_charge_cost = wp_charge_needed_kwh * 0.35
                waypoint_estimates.append(
                    WaypointEstimate(
                        sequence_order=idx + 1,
                        name=stop.name or f"Stop {idx + 1}",
                        lat=stop.lat,
                        lon=stop.lon,
                        arrival_soc=float(round(current_soc, 1)),
                        charge_cost_coins=float(round(wp_charge_cost, 2))
                    )
                )
    else:
        # No charge required
        waypoint_estimates = []
        current_soc = start_soc
        for idx, stop in enumerate(req.custom_stops):
            leg_dist = 0.0
            if idx < len(legs):
                leg_dist = float(legs[idx].get("summary", {}).get("length", 0.0))
            wp_soc_consumed = (leg_dist * rate_kwh / capacity) * 100
            current_soc = max(current_soc - wp_soc_consumed, 0.0)
            wp_charge_cost = 0.0
            if current_soc < 80.0:
                wp_charge_needed_kwh = ((80.0 - current_soc) / 100.0) * capacity
                wp_charge_cost = wp_charge_needed_kwh * 0.35
            waypoint_estimates.append(
                WaypointEstimate(
                    sequence_order=idx + 1,
                    name=stop.name or f"Stop {idx + 1}",
                    lat=stop.lat,
                    lon=stop.lon,
                    arrival_soc=float(round(current_soc, 1)),
                    charge_cost_coins=float(round(wp_charge_cost, 2))
                )
            )

    return TripPlanResponse(
        polyline=shape,
        distance_km=float(round(distance_km, 2)),
        duration_mins=duration_mins,
        start_soc=float(round(start_soc, 1)),
        end_soc=float(round(max(end_soc, 0.0), 1)),
        requires_charge=requires_charge,
        recommended_stop=recommended_stop,
        stations_along_route=stations_along,
        restaurants_along_route=restaurants_along,
        amenities_along_route=amenities_along,
        waypoint_estimates=waypoint_estimates
    )

@router.post("", response_model=TripOut)
async def create_trip(
    req: TripCreateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> Any:
    """
    Save a planned route and its waypoints to the database.
    """
    try:
        # Create Trip
        db_trip = Trip(
            user_id=current_user.user_id,
            user_vehicle_id=req.user_vehicle_id,
            start_location=f"POINT({req.start_lon} {req.start_lat})",
            end_location=f"POINT({req.end_lon} {req.end_lat})",
            estimated_arrival_time=req.estimated_arrival_time
        )
        db.add(db_trip)
        await db.commit()
        await db.refresh(db_trip)

        # Create Waypoints
        waypoints_objs = []
        for index, wp in enumerate(req.waypoints):
            station_uuid = wp.station_id if wp.station_id else None
            db_wp = TripWaypoint(
                trip_id=db_trip.trip_id,
                sequence_order=index,
                geo_location=f"POINT({wp.lon} {wp.lat})",
                associated_station_id=station_uuid
            )
            waypoints_objs.append(db_wp)
        
        if waypoints_objs:
            db.add_all(waypoints_objs)
            await db.commit()

        # Build response
        # Retrieve WKT lat/lon
        trip_q = select(
            Trip,
            func.ST_AsText(Trip.start_location).label("start_wkt"),
            func.ST_AsText(Trip.end_location).label("end_wkt")
        ).where(Trip.trip_id == db_trip.trip_id)
        trip_res = await db.execute(trip_q)
        row = trip_res.first()
        if not row:
            raise HTTPException(status_code=404, detail="Saved trip not found.")
            
        t_obj, start_wkt, end_wkt = row[0], row[1], row[2]
        start_lon, start_lat = map(float, start_wkt.replace("POINT(", "").replace(")", "").split())
        end_lon, end_lat = map(float, end_wkt.replace("POINT(", "").replace(")", "").split())

        # Get waypoints
        wp_q = select(
            TripWaypoint,
            func.ST_AsText(TripWaypoint.geo_location).label("wp_wkt")
        ).where(TripWaypoint.trip_id == t_obj.trip_id).order_by(TripWaypoint.sequence_order)
        wp_res = await db.execute(wp_q)
        
        mapped_waypoints = []
        for wp_row in wp_res.all():
            wp, wp_wkt = wp_row[0], wp_row[1]
            wp_lon, wp_lat = map(float, wp_wkt.replace("POINT(", "").replace(")", "").split())
            mapped_waypoints.append(
                WaypointOut(
                    waypoint_id=wp.waypoint_id,
                    sequence_order=wp.sequence_order,
                    lat=wp_lat,
                    lon=wp_lon,
                    associated_station_id=wp.associated_station_id
                )
            )

        return TripOut(
            trip_id=t_obj.trip_id,
            user_vehicle_id=t_obj.user_vehicle_id,
            start_lat=start_lat,
            start_lon=start_lon,
            end_lat=end_lat,
            end_lon=end_lon,
            estimated_arrival_time=t_obj.estimated_arrival_time,
            created_at=t_obj.created_at,
            waypoints=mapped_waypoints
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error saving trip: {str(e)}"
        )

@router.get("", response_model=List[TripOut])
async def list_trips(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> Any:
    """
    List all saved trips for the authenticated user.
    """
    try:
        query = select(
            Trip,
            func.ST_AsText(Trip.start_location).label("start_wkt"),
            func.ST_AsText(Trip.end_location).label("end_wkt")
        ).where(Trip.user_id == current_user.user_id).order_by(Trip.created_at.desc())
        
        result = await db.execute(query)
        trips_data = []

        for row in result.all():
            trip, start_wkt, end_wkt = row[0], row[1], row[2]
            start_lon, start_lat = map(float, start_wkt.replace("POINT(", "").replace(")", "").split())
            end_lon, end_lat = map(float, end_wkt.replace("POINT(", "").replace(")", "").split())
            
            # Fetch waypoints
            wp_query = select(
                TripWaypoint,
                func.ST_AsText(TripWaypoint.geo_location).label("wp_wkt")
            ).where(TripWaypoint.trip_id == trip.trip_id).order_by(TripWaypoint.sequence_order)
            wp_res = await db.execute(wp_query)
            
            mapped_wps = []
            for wp_row in wp_res.all():
                wp, wp_wkt = wp_row[0], wp_row[1]
                wp_lon, wp_lat = map(float, wp_wkt.replace("POINT(", "").replace(")", "").split())
                mapped_wps.append(
                    WaypointOut(
                        waypoint_id=wp.waypoint_id,
                        sequence_order=wp.sequence_order,
                        lat=wp_lat,
                        lon=wp_lon,
                        associated_station_id=wp.associated_station_id
                    )
                )
                
            trips_data.append(
                TripOut(
                    trip_id=trip.trip_id,
                    user_vehicle_id=trip.user_vehicle_id,
                    start_lat=start_lat,
                    start_lon=start_lon,
                    end_lat=end_lat,
                    end_lon=end_lon,
                    estimated_arrival_time=trip.estimated_arrival_time,
                    created_at=trip.created_at,
                    waypoints=mapped_wps
                )
            )
        return trips_data
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error listing trips: {str(e)}"
        )

@router.delete("/{trip_id}", status_code=status.HTTP_200_OK)
async def delete_trip(
    trip_id: Any,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
) -> Any:
    """
    Delete a saved trip.
    """
    try:
        query = select(Trip).where(Trip.trip_id == trip_id, Trip.user_id == current_user.user_id)
        res = await db.execute(query)
        trip = res.scalars().first()
        if not trip:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trip not found."
            )
            
        await db.execute(delete(Trip).where(Trip.trip_id == trip_id))
        await db.commit()
        return {"status": "success", "message": "Trip deleted successfully."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting trip: {str(e)}"
        )
