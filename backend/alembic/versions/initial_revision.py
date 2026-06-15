"""initial

Revision ID: initial_revision
Revises: None
Create Date: 2026-06-09 10:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'initial_revision'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 0. Enable PostGIS
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    
    # 1. Create custom enums
    op.execute("CREATE TYPE user_role AS ENUM ('ev_owner', 'restaurant_owner', 'home_station_owner', 'admin');")
    op.execute("CREATE TYPE station_type AS ENUM ('public_commercial', 'p2p_home');")
    op.execute("CREATE TYPE plug_type AS ENUM ('Type2', 'CCS2', 'CHAdeMO', 'Tesla_Supercharger', 'GB_T');")
    op.execute("CREATE TYPE slot_status AS ENUM ('available', 'occupied', 'reserved', 'offline');")
    op.execute("CREATE TYPE order_status AS ENUM ('pending', 'accepted', 'preparing', 'ready_for_pickup', 'delivered', 'cancelled');")
    op.execute("CREATE TYPE transaction_type AS ENUM ('wallet_topup', 'charging_fee', 'food_order', 'p2p_payout');")

    # 2. Create tables
    op.execute("""
    CREATE TABLE users (
        user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        phone_number VARCHAR(20),
        role user_role NOT NULL,
        is_kyc_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """)

    op.execute("""
    CREATE TABLE wallets (
        wallet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
        balance_coins NUMERIC(12, 2) DEFAULT 0.00 CHECK (balance_coins >= 0),
        currency_code VARCHAR(3) DEFAULT 'USD',
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """)

    op.execute("""
    CREATE TABLE wallet_transactions (
        transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        wallet_id UUID REFERENCES wallets(wallet_id),
        amount_coins NUMERIC(12, 2) NOT NULL,
        type transaction_type NOT NULL,
        reference_id UUID,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """)

    op.execute("""
    CREATE TABLE vehicle_catalog (
        model_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand VARCHAR(100) NOT NULL,
        model_name VARCHAR(100) NOT NULL,
        battery_capacity_kwh NUMERIC(6, 2) NOT NULL,
        base_drag_coefficient NUMERIC(4, 3) NOT NULL,
        supported_plugs plug_type[] NOT NULL
    );
    """)

    op.execute("""
    CREATE TABLE user_vehicles (
        user_vehicle_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
        model_id UUID REFERENCES vehicle_catalog(model_id),
        license_plate VARCHAR(20),
        current_battery_percent NUMERIC(5, 2) NOT NULL CHECK (current_battery_percent BETWEEN 0 AND 100),
        battery_degradation_factor NUMERIC(3, 2) DEFAULT 1.00,
        custom_aerodynamic_rating NUMERIC(4, 3),
        is_active BOOLEAN DEFAULT TRUE
    );
    """)

    op.execute("""
    CREATE TABLE charging_stations (
        station_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID REFERENCES users(user_id),
        name VARCHAR(150) NOT NULL,
        type station_type NOT NULL,
        geo_location GEOGRAPHY(Point, 4326) NOT NULL,
        address TEXT NOT NULL,
        environment_description TEXT,
        swappable_battery_inventory INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """)

    op.execute("""
    CREATE TABLE station_availability_slots (
        slot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        station_id UUID REFERENCES charging_stations(station_id) ON DELETE CASCADE,
        day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        price_per_kwh_coins NUMERIC(10, 2) NOT NULL
    );
    """)

    op.execute("""
    CREATE TABLE charging_spots (
        spot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        station_id UUID REFERENCES charging_stations(station_id) ON DELETE CASCADE,
        plug_id plug_type NOT NULL,
        max_power_kw NUMERIC(6, 2) NOT NULL,
        status slot_status DEFAULT 'available'
    );
    """)

    op.execute("""
    CREATE TABLE station_access_protocols (
        protocol_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        station_id UUID REFERENCES charging_stations(station_id) ON DELETE CASCADE,
        gate_code VARCHAR(50),
        access_instructions TEXT,
        automated_iot_trigger_url VARCHAR(255)
    );
    """)

    op.execute("""
    CREATE TABLE restaurants (
        restaurant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
        associated_station_id UUID REFERENCES charging_stations(station_id) ON DELETE SET NULL,
        name VARCHAR(150) NOT NULL,
        geo_location GEOGRAPHY(Point, 4326),
        is_open BOOLEAN DEFAULT TRUE
    );
    """)

    op.execute("""
    CREATE TABLE menus (
        menu_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id UUID REFERENCES restaurants(restaurant_id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE
    );
    """)

    op.execute("""
    CREATE TABLE menu_items (
        item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        menu_id UUID REFERENCES menus(menu_id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        price_coins NUMERIC(10, 2) NOT NULL,
        is_available BOOLEAN DEFAULT TRUE
    );
    """)

    op.execute("""
    CREATE TABLE trips (
        trip_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(user_id),
        user_vehicle_id UUID REFERENCES user_vehicles(user_vehicle_id),
        start_location GEOGRAPHY(Point, 4326) NOT NULL,
        end_location GEOGRAPHY(Point, 4326) NOT NULL,
        estimated_arrival_time TIMESTAMP WITH TIME ZONE,
        current_eta_to_next_stop TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """)

    op.execute("""
    CREATE TABLE trip_waypoints (
        waypoint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        trip_id UUID REFERENCES trips(trip_id) ON DELETE CASCADE,
        sequence_order INT NOT NULL,
        geo_location GEOGRAPHY(Point, 4326) NOT NULL,
        elevation_meters NUMERIC(6, 2),
        predicted_wind_direction_deg INT,
        predicted_wind_speed_mps NUMERIC(4, 2),
        associated_station_id UUID REFERENCES charging_stations(station_id) ON DELETE SET NULL
    );
    """)

    op.execute("""
    CREATE TABLE unified_booking_sessions (
        session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(user_id),
        trip_id UUID REFERENCES trips(trip_id) ON DELETE SET NULL,
        station_id UUID REFERENCES charging_stations(station_id),
        spot_id UUID REFERENCES charging_spots(spot_id),
        scheduled_start TIMESTAMP WITH TIME ZONE,
        scheduled_end TIMESTAMP WITH TIME ZONE,
        actual_start TIMESTAMP WITH TIME ZONE,
        actual_end TIMESTAMP WITH TIME ZONE,
        total_energy_delivered_kwh NUMERIC(6, 2),
        charging_cost_coins NUMERIC(10, 2) DEFAULT 0.00
    );
    """)

    op.execute("""
    CREATE TABLE food_orders (
        order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES unified_booking_sessions(session_id) ON DELETE SET NULL,
        restaurant_id UUID REFERENCES restaurants(restaurant_id),
        status order_status DEFAULT 'pending',
        delivery_to_vehicle BOOLEAN DEFAULT FALSE,
        parking_spot_identifier VARCHAR(50),
        total_food_cost_coins NUMERIC(10, 2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """)

    op.execute("""
    CREATE TABLE order_items (
        order_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES food_orders(order_id) ON DELETE CASCADE,
        item_id UUID REFERENCES menu_items(item_id),
        quantity INT NOT NULL CHECK (quantity > 0),
        price_at_purchase_coins NUMERIC(10, 2) NOT NULL
    );
    """)

    op.execute("""
    CREATE TABLE local_amenities (
        amenity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(150) NOT NULL,
        category VARCHAR(100),
        description TEXT,
        geo_location GEOGRAPHY(Point, 4326) NOT NULL
    );
    """)

    op.execute("""
    CREATE TABLE station_amenities_mapping (
        station_id UUID REFERENCES charging_stations(station_id) ON DELETE CASCADE,
        amenity_id UUID REFERENCES local_amenities(amenity_id) ON DELETE CASCADE,
        distance_meters NUMERIC(7, 2),
        PRIMARY KEY (station_id, amenity_id)
    );
    """)

    op.execute("""
    CREATE TABLE travel_itineraries (
        itinerary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        author_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        is_public BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """)

    op.execute("""
    CREATE TABLE itinerary_stops (
        stop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        itinerary_id UUID REFERENCES travel_itineraries(itinerary_id) ON DELETE CASCADE,
        sequence_order INT NOT NULL,
        station_id UUID REFERENCES charging_stations(station_id),
        notes_or_tips TEXT
    );
    """)

    op.execute("""
    CREATE TABLE itinerary_reviews (
        review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        itinerary_id UUID REFERENCES travel_itineraries(itinerary_id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(user_id),
        rating INT CHECK (rating BETWEEN 1 AND 5),
        comment TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 3. Create indexes
    op.execute("CREATE INDEX idx_stations_geo ON charging_stations USING GIST (geo_location);")
    op.execute("CREATE INDEX idx_amenities_geo ON local_amenities USING GIST (geo_location);")
    op.execute("CREATE INDEX idx_spots_station ON charging_spots(station_id, status);")
    op.execute("CREATE INDEX idx_orders_session ON food_orders(session_id);")
    op.execute("CREATE INDEX idx_trips_eta ON trips(current_eta_to_next_stop);")

def downgrade() -> None:
    # 3. Drop indexes
    op.execute("DROP INDEX IF EXISTS idx_trips_eta;")
    op.execute("DROP INDEX IF EXISTS idx_orders_session;")
    op.execute("DROP INDEX IF EXISTS idx_spots_station;")
    op.execute("DROP INDEX IF EXISTS idx_amenities_geo;")
    op.execute("DROP INDEX IF EXISTS idx_stations_geo;")

    # 2. Drop tables
    op.execute("DROP TABLE IF EXISTS itinerary_reviews CASCADE;")
    op.execute("DROP TABLE IF EXISTS itinerary_stops CASCADE;")
    op.execute("DROP TABLE IF EXISTS travel_itineraries CASCADE;")
    op.execute("DROP TABLE IF EXISTS station_amenities_mapping CASCADE;")
    op.execute("DROP TABLE IF EXISTS local_amenities CASCADE;")
    op.execute("DROP TABLE IF EXISTS order_items CASCADE;")
    op.execute("DROP TABLE IF EXISTS food_orders CASCADE;")
    op.execute("DROP TABLE IF EXISTS unified_booking_sessions CASCADE;")
    op.execute("DROP TABLE IF EXISTS trip_waypoints CASCADE;")
    op.execute("DROP TABLE IF EXISTS trips CASCADE;")
    op.execute("DROP TABLE IF EXISTS menu_items CASCADE;")
    op.execute("DROP TABLE IF EXISTS menus CASCADE;")
    op.execute("DROP TABLE IF EXISTS restaurants CASCADE;")
    op.execute("DROP TABLE IF EXISTS station_access_protocols CASCADE;")
    op.execute("DROP TABLE IF EXISTS charging_spots CASCADE;")
    op.execute("DROP TABLE IF EXISTS station_availability_slots CASCADE;")
    op.execute("DROP TABLE IF EXISTS charging_stations CASCADE;")
    op.execute("DROP TABLE IF EXISTS user_vehicles CASCADE;")
    op.execute("DROP TABLE IF EXISTS vehicle_catalog CASCADE;")
    op.execute("DROP TABLE IF EXISTS wallet_transactions CASCADE;")
    op.execute("DROP TABLE IF EXISTS wallets CASCADE;")
    op.execute("DROP TABLE IF EXISTS users CASCADE;")

    # 1. Drop enums
    op.execute("DROP TYPE IF EXISTS transaction_type;")
    op.execute("DROP TYPE IF EXISTS order_status;")
    op.execute("DROP TYPE IF EXISTS slot_status;")
    op.execute("DROP TYPE IF EXISTS plug_type;")
    op.execute("DROP TYPE IF EXISTS station_type;")
    op.execute("DROP TYPE IF EXISTS user_role;")

    # 0. Drop PostGIS
    op.execute("DROP EXTENSION IF EXISTS postgis;")
