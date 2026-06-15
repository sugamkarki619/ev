from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_password_hash

# Import all models
from app.models.user import User, UserRole
from app.models.wallet import Wallet
from app.models.vehicle import VehicleCatalog, PlugType, UserVehicle
from app.models.station import ChargingStation, StationType, ChargingSpot, SlotStatus, StationAccessProtocol
from app.models.commerce import Restaurant, Menu, MenuItem
from app.models.community import LocalAmenity
from app.models.trip import Trip, TripWaypoint
from app.models.booking import UnifiedBookingSession, FoodOrder, OrderItem

router = APIRouter()

@router.post("/run", status_code=status.HTTP_200_OK)
async def run_seeding(db: AsyncSession = Depends(get_db)):
    """
    Clear existing dynamic data and seed realistic charging infrastructure,
    integrated diners, and navigational waypoints across Nepal's major highway networks.
    """
    try:
        # 1. Clear existing data in reverse dependency order
        await db.execute(delete(OrderItem))
        await db.execute(delete(FoodOrder))
        await db.execute(delete(UnifiedBookingSession))
        await db.execute(delete(TripWaypoint))
        await db.execute(delete(Trip))
        await db.execute(delete(UserVehicle))
        await db.execute(delete(MenuItem))
        await db.execute(delete(Menu))
        await db.execute(delete(Restaurant))
        await db.execute(delete(StationAccessProtocol))
        await db.execute(delete(ChargingSpot))
        await db.execute(delete(ChargingStation))
        await db.execute(delete(LocalAmenity))
        await db.execute(delete(Wallet))
        await db.execute(delete(User))
        await db.execute(delete(VehicleCatalog))
        await db.commit()

        # 2. Seed Vehicle Catalog (Dominant EVs in Nepal market)
        vehicles = [
            VehicleCatalog(brand="BYD", model_name="Atto 3 Long Range", battery_capacity_kwh=60.48, base_drag_coefficient=0.290, supported_plugs=[PlugType.CCS2]),
            VehicleCatalog(brand="BYD", model_name="Dolphin", battery_capacity_kwh=44.90, base_drag_coefficient=0.300, supported_plugs=[PlugType.CCS2]),
            VehicleCatalog(brand="Tata", model_name="Nexon EV Max", battery_capacity_kwh=40.50, base_drag_coefficient=0.320, supported_plugs=[PlugType.CCS2]),
            VehicleCatalog(brand="Tata", model_name="Punch EV", battery_capacity_kwh=35.00, base_drag_coefficient=0.315, supported_plugs=[PlugType.CCS2]),
            VehicleCatalog(brand="MG", model_name="ZS EV Deluxe", battery_capacity_kwh=51.00, base_drag_coefficient=0.290, supported_plugs=[PlugType.CCS2]),
            VehicleCatalog(brand="Hyundai", model_name="Ioniq 5 Standard", battery_capacity_kwh=58.00, base_drag_coefficient=0.288, supported_plugs=[PlugType.CCS2]),
            VehicleCatalog(brand="Deepal", model_name="S7 EV", battery_capacity_kwh=66.80, base_drag_coefficient=0.258, supported_plugs=[PlugType.CCS2])
        ]
        db.add_all(vehicles)
        await db.commit()

        # 3. Seed Users (Admins and Operators)
        admin_pass = get_password_hash("adminpassword")
        owner_pass = get_password_hash("stationpassword")
        
        admin_user = User(email="admin@waffle.com", password_hash=admin_pass, first_name="NEA", last_name="Admin", role=UserRole.admin, is_kyc_verified=True)
        owner_user = User(email="owner@waffle.com", password_hash=owner_pass, first_name="Sipradi", last_name="Operator", role=UserRole.home_station_owner, is_kyc_verified=True)
        db.add_all([admin_user, owner_user])
        await db.commit()
        await db.refresh(admin_user)
        await db.refresh(owner_user)

        db.add_all([
            Wallet(user_id=admin_user.user_id, balance_coins=10000.00),
            Wallet(user_id=owner_user.user_id, balance_coins=5000.00)
        ])
        await db.commit()

        # 4. Seed Charging Stations (PostGIS Geography Points: POINT(longitude latitude))
        stations = [
            # --- Kathmandu Valley Hubs ---
            ChargingStation(
                owner_id=admin_user.user_id, name="NEA Ratnapark Hub", type=StationType.public_commercial,
                geo_location="POINT(85.3164 27.7048)", address="Durbar Marg, Ratnapark, Kathmandu 44600",
                environment_description="Central corporate electricity headquarters. 24/7 dedicated EV priority parking bays.", swappable_battery_inventory=12
            ),
            ChargingStation(
                owner_id=admin_user.user_id, name="NEA Sajha Pulchowk Station", type=StationType.public_commercial,
                geo_location="POINT(85.3160 27.6775)", address="Sajha Petrol Pump Complex, Pulchowk, Lalitpur",
                environment_description="High traffic terminal inside fuel station premises. Near corporate offices and restaurants."
            ),
            ChargingStation(
                owner_id=owner_user.user_id, name="Sipradi Naikap Service Hub", type=StationType.public_commercial,
                geo_location="POINT(85.2638 27.6912)", address="Kalankisthan Road, Naikap, Chandragiri",
                environment_description="Strategic exit checkpoint on the way out of Kathmandu Valley towards Thankot."
            ),
            # --- Prithvi Highway Corridor (Kathmandu -> Pokhara / Chitwan) ---
            ChargingStation(
                owner_id=admin_user.user_id, name="NEA Mugling Junction Charger", type=StationType.public_commercial,
                geo_location="POINT(84.5583 27.8541)", address="Prithvi Highway, Mugling Bridge, Darechok",
                environment_description="Crucial structural split point connecting Central, Western, and Southern Nepal travel vectors."
            ),
            ChargingStation(
                owner_id=owner_user.user_id, name="Siddhartha Riverside Resort Base", type=StationType.public_commercial,
                geo_location="POINT(84.6732 27.7915)", address="Prithvi Highway, Chumlingtar, Chitwan",
                environment_description="Luxury highway stopping point right next to the Trishuli river canyon."
            ),
            ChargingStation(
                owner_id=owner_user.user_id, name="The Highway Coffee Shop Station", type=StationType.p2p_home,
                geo_location="POINT(84.7712 27.8105)", address="Prithvi Highway, Benighat, Dhading",
                environment_description="Cozy boutique cafe offering fast high-voltage top ups for transit travelers."
            ),
            ChargingStation(
                owner_id=owner_user.user_id, name="Kuber Oil Suppliers & EV Zone", type=StationType.public_commercial,
                geo_location="POINT(84.3721 27.9673)", address="Dumre-Bandipur Crossroad, Dumre, Tanahun",
                environment_description="Gateway terminal base at the foot of the hill climb heading up to historical Bandipur."
            ),
            # --- Pokhara Valley ---
            ChargingStation(
                owner_id=admin_user.user_id, name="APF Kalika Fuel Station Array", type=StationType.public_commercial,
                geo_location="POINT(83.9782 28.2215)", address="Pokhara-Baglung Highway, Malepatan, Pokhara",
                environment_description="Highly secured Armed Police Force compound infrastructure. Spacious asphalt parking layout."
            ),
            # --- BP Highway Corridor (Kathmandu -> Eastern Terai Plains) ---
            ChargingStation(
                owner_id=admin_user.user_id, name="NEA Sindhuli Bus Park Station", type=StationType.public_commercial,
                geo_location="POINT(85.9181 27.2272)", address="BP Highway, Kamalamai, Sindhuli",
                environment_description="Mid-hill backbone facility addressing high-altitude regenerative optimization setups."
            ),
            ChargingStation(
                owner_id=owner_user.user_id, name="Taj Riverside Resort EV Hub", type=StationType.public_commercial,
                geo_location="POINT(85.8236 27.3512)", address="BP Highway, Mulkot, Sindhuli",
                environment_description="Scenic riverside tourist cluster perfect for scenic dining while charging."
            ),
            ChargingStation(
                owner_id=admin_user.user_id, name="NEA Khurkot Refresh Station", type=StationType.public_commercial,
                geo_location="POINT(85.9812 27.3995)", address="BP Highway, Bhimeshwor, Sindhulipalchok border",
                environment_description="Strategically configured hub providing support for transport heading to Ramechhap/Dolakha."
            ),
            # --- Tribhuvan & East-West Highway Intersections ---
            ChargingStation(
                owner_id=admin_user.user_id, name="NEA Hetauda Bus Park Station", type=StationType.public_commercial,
                geo_location="POINT(85.0244 27.4169)", address="Ratomate, Hetauda, Makwanpur",
                environment_description="Major transit crossroad linking Central industrial valley networks to Terai plains."
            ),
            ChargingStation(
                owner_id=admin_user.user_id, name="NEA Bharatpur Bus Terminal Hub", type=StationType.public_commercial,
                geo_location="POINT(84.4325 27.6710)", address="Central Bus Terminal, Bharatpur, Chitwan",
                environment_description="High-capacity central hub catering to commercial passenger EV fleets."
            ),
            ChargingStation(
                owner_id=admin_user.user_id, name="NEA Lahan Bus Park Center", type=StationType.public_commercial,
                geo_location="POINT(86.4812 26.7145)", address="East-West Highway, Lahan, Siraha",
                environment_description="Core strategic transit array serving the primary eastern lateral corridor."
            ),
            ChargingStation(
                owner_id=admin_user.user_id, name="NEA Itahari Industrial Node", type=StationType.public_commercial,
                geo_location="POINT(87.2761 26.6528)", address="M73G+38Q Corridor, Itahari, Sunsari",
                environment_description="High power industrial distribution footprint providing uninterrupted grid support."
            )
        ]
        
        db.add_all(stations)
        await db.commit()
        for s in stations:
            await db.refresh(s)

        # 5. Add Charging Spots (Parallel allocation for all stations)
        spots = []
        for s in stations:
            # High-output fast DC charging capability
            spots.append(ChargingSpot(station_id=s.station_id, plug_id=PlugType.CCS2, max_power_kw=120.00, status=SlotStatus.available))
            # Auxiliary AC destination backup charging option
            spots.append(ChargingSpot(station_id=s.station_id, plug_id=PlugType.Type2, max_power_kw=22.00, status=SlotStatus.available))
        db.add_all(spots)
        
        # 6. Add Station Access Protocols for semi-private or commercial checkpoints
        protocols = [
            StationAccessProtocol(station_id=stations[5].station_id, gate_code="CAFE-EV", access_instructions="Driveway located directly behind the roadside bakery. Request remote gate override at cash desk if gate is locked."),
            StationAccessProtocol(station_id=stations[9].station_id, gate_code="RESORT-2026", access_instructions="Pass through the primary resort arch, navigate past reception parking directly down to the river-facing fence line.")
        ]
        db.add_all(protocols)
        await db.commit()

        # 7. Seed Restaurants (Directly linked to corresponding station entities)
        restaurants = []
        restaurant_meta = [
            ("Ratnapark Transit Cafe", "POINT(85.3166 27.7050)", 0),
            ("Sajha Patan Deli & Juices", "POINT(85.3162 27.6777)", 1),
            ("Naikap Pitstop Bakery", "POINT(85.2640 27.6914)", 2),
            ("Mugling Junction Local Treat", "POINT(84.5585 27.8543)", 3),
            ("Siddhartha Riverside Luxury Dine", "POINT(84.6735 27.7918)", 4),
            ("The Highway Espresso Lab", "POINT(84.7714 27.8107)", 5),
            ("Dumre Crossroads Sweet Center", "POINT(84.3723 27.9675)", 6),
            ("Kalika Canteen & Resto", "POINT(83.9785 28.2217)", 7),
            ("Sindhuli Chure Valley Kitchen", "POINT(85.9183 27.2274)", 8),
            ("Taj Riverside Lounge & Grills", "POINT(85.8239 27.3515)", 9),
            ("Khurkot Sun Koshi Fish House", "POINT(85.9814 27.3997)", 10),
            ("Ratomate Makwanpur Bhojanalaya", "POINT(85.0246 27.4171)", 11),
            ("Chitwan Rhino Express Diner", "POINT(84.4327 27.6712)", 12),
            ("Mithila Spice Hub - Lahan", "POINT(86.4814 26.7147)", 13),
            ("Itahari Continental Express", "POINT(87.2763 26.6530)", 14)
        ]

        for name, geo, idx in restaurant_meta:
            restaurants.append(Restaurant(
                owner_id=owner_user.user_id if idx % 2 != 0 else admin_user.user_id,
                associated_station_id=stations[idx].station_id,
                name=name, geo_location=geo, is_open=True
            ))
        db.add_all(restaurants)
        await db.commit()
        for r in restaurants:
            await db.refresh(r)

        # 8. Seed Restaurant Menus & Specialized Local Dishes
        menus = []
        for r in restaurants:
            menus.append(Menu(restaurant_id=r.restaurant_id, name=f"EV Traveler Special - {r.name}"))
        db.add_all(menus)
        await db.commit()
        for m in menus:
            await db.refresh(m)

        menu_items = []
        for m in menus:
            menu_items.append(MenuItem(menu_id=m.menu_id, name="Thakali Khana Platter", description="Authentic local structural set with organic ghee, black lentils, and spicy mustard greens.", price_coins=25.00))
            menu_items.append(MenuItem(menu_id=m.menu_id, name="Steam Buff Momo", description="Fresh minced buffalo dumplings paired with spicy sesame-tomato chutney.", price_coins=12.00))
            menu_items.append(MenuItem(menu_id=m.menu_id, name="Himalayan Arabica Latte", description="Double espresso shot extracted using organic beans grown in the mid-hills.", price_coins=8.50))
            menu_items.append(MenuItem(menu_id=m.menu_id, name="Trishuli Fried Fish", description="Crispy spiced fresh catch from the river basin.", price_coins=18.00))
        db.add_all(menu_items)

        # 9. Seed Waypoints & Local Amenities (Vital geographic coordinates for navigation route planners)
        amenities = [
            LocalAmenity(name="Thankot Valley Gateway Checkpoint", category="Highway Exit Checkpoint", description="The essential primary exit choke point linking Kathmandu Valley to the cross-country road networks.", geo_location="POINT(85.2045 27.6841)"),
            LocalAmenity(name="Malekhu Fish Market Street", category="Transit Market Hub", description="Iconic riverside settlement famous for its local roadside fish fry shops and grocery markets.", geo_location="POINT(84.8115 27.8042)"),
            LocalAmenity(name="Kurintar Manakamana Cable Car Base", category="Tourist Transport Landmark", description="Base station terminal for accessing the iconic hilltop Manakamana Temple.", geo_location="POINT(84.5931 27.8722)"),
            LocalAmenity(name="Bandipur Newari Heritage Settlement", category="Scenic Cultural Site", description="Excellently preserved old mountain trading post displaying traditional Newari brick carvings.", geo_location="POINT(84.4144 27.9355)"),
            LocalAmenity(name="Lakeside Promenade Pokhara", category="Scenic Destination Point", description="The absolute central tourist pedestrian axis sitting parallel to Phewa Lake.", geo_location="POINT(83.9575 28.2094)"),
            LocalAmenity(name="Sunkoshi River Confluence View", category="Natural Waypoint", description="Picturesque natural valley turn along the winding curves of the BP Highway infrastructure.", geo_location="POINT(85.8590 27.3275)"),
            LocalAmenity(name="Sindhuli Gadhi Historic Fortification", category="Historical Landmark", description="Mountain ridge fortress site famous for historic defensive tactical victories.", geo_location="POINT(85.9455 27.2711)"),
            LocalAmenity(name="Narayani River Bridge Overlook", category="Highway Infrastructure Node", description="Massive engineering linkage dividing Chitwan district from Nawalpur plains.", geo_location="POINT(84.4121 27.6852)")
        ]
        db.add_all(amenities)
        await db.commit()

        return {
            "status": "success",
            "message": f"Successfully mapped and seeded {len(stations)} structural charging hubs, {len(restaurants)} integrated restaurants, and {len(amenities)} critical highway waypoints covering all major logistical corridors across Nepal."
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Seeding process encountered an unhandled exception: {str(e)}"
        )