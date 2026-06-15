-- ============================================================================
-- EXTENSIONS & CUSTOM ENUMS
-- ============================================================================

-- Enable PostGIS for spatial routing, station discovery, and proximity filtering
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE user_role AS ENUM ('ev_owner', 'restaurant_owner', 'home_station_owner', 'admin');
CREATE TYPE station_type AS ENUM ('public_commercial', 'p2p_home');
CREATE TYPE plug_type AS ENUM ('Type2', 'CCS2', 'CHAdeMO', 'Tesla_Supercharger', 'GB_T');
CREATE TYPE slot_status AS ENUM ('available', 'occupied', 'reserved', 'offline');
CREATE TYPE order_status AS ENUM ('pending', 'accepted', 'preparing', 'ready_for_pickup', 'delivered', 'cancelled');
CREATE TYPE transaction_type AS ENUM ('wallet_topup', 'charging_fee', 'food_order', 'p2p_payout');

-- ============================================================================
-- 1. USER & WALLET MANAGEMENT
-- ============================================================================

CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    role user_role NOT NULL,
    is_kyc_verified BOOLEAN DEFAULT FALSE, -- Crucial for P2P Home Station Owners
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Coin-based/Top-up Digital Wallet System
CREATE TABLE wallets (
    wallet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    balance_coins NUMERIC(12, 2) DEFAULT 0.00 CHECK (balance_coins >= 0),
    currency_code VARCHAR(3) DEFAULT 'USD',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE wallet_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID REFERENCES wallets(wallet_id),
    amount_coins NUMERIC(12, 2) NOT NULL,
    type transaction_type NOT NULL,
    reference_id UUID, -- Can point to an order_id or charging_session_id
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. EV OWNER: VEHICLE CONFIGURATION & PHYSICS
-- ============================================================================

-- Global Vehicle Brand/Model Catalog
CREATE TABLE vehicle_catalog (
    model_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand VARCHAR(100) NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    battery_capacity_kwh NUMERIC(6, 2) NOT NULL,
    base_drag_coefficient NUMERIC(4, 3) NOT NULL, -- For aerodynamic physics calculations
    supported_plugs plug_type[] NOT NULL           -- Array of compatible plugs
);

-- User-Specific Vehicle Profile with Manual/Physics Adjustments
CREATE TABLE user_vehicles (
    user_vehicle_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    model_id UUID REFERENCES vehicle_catalog(model_id),
    license_plate VARCHAR(20),
    current_battery_percent NUMERIC(5, 2) NOT NULL CHECK (current_battery_percent BETWEEN 0 AND 100),
    battery_degradation_factor NUMERIC(3, 2) DEFAULT 1.00, -- e.g., 0.95 means 5% capacity loss
    custom_aerodynamic_rating NUMERIC(4, 3), -- Manual override for roof racks/mods affecting physics range
    is_active BOOLEAN DEFAULT TRUE
);

-- ============================================================================
-- 3. STATIONS & INFRASTRUCTURE (Commercial & P2P)
-- ============================================================================

CREATE TABLE charging_stations (
    station_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(user_id), -- Can be a commercial entity or a P2P Home Owner
    name VARCHAR(150) NOT NULL,
    type station_type NOT NULL,
    geo_location GEOGRAPHY(Point, 4326) NOT NULL, -- PostGIS point for proximity search & route planning
    address TEXT NOT NULL,
    environment_description TEXT, -- "Quiet suburban driveway" or "Mall parking lot B3"
    swappable_battery_inventory INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tools to set P2P availability windows and booking slots
CREATE TABLE station_availability_slots (
    slot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES charging_stations(station_id) ON DELETE CASCADE,
    day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, etc.
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    price_per_kwh_coins NUMERIC(10, 2) NOT NULL
);

-- Specific charging plugs/bays per station
CREATE TABLE charging_spots (
    spot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES charging_stations(station_id) ON DELETE CASCADE,
    plug_id plug_type NOT NULL,
    max_power_kw NUMERIC(6, 2) NOT NULL, -- e.g. 50.00 for Fast, 7.00 for Slow
    status slot_status DEFAULT 'available'
);

-- Access tokens/instructions for P2P entry (Address challenge: physical access management)
CREATE TABLE station_access_protocols (
    protocol_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    station_id UUID REFERENCES charging_stations(station_id) ON DELETE CASCADE,
    gate_code VARCHAR(50),
    access_instructions TEXT, -- e.g., "Gate opens automatically via license plate scan or use app button"
    automated_iot_trigger_url VARCHAR(255) -- Future-proofing for automated gate integration
);

-- ============================================================================
-- 4. RESTAURANT PARTNERS & COMMERCE
-- ============================================================================

CREATE TABLE restaurants (
    restaurant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    associated_station_id UUID REFERENCES charging_stations(station_id) ON NULL ACTION, -- Linked to charging ecosystems
    name VARCHAR(150) NOT NULL,
    geo_location GEOGRAPHY(Point, 4326),
    is_open BOOLEAN DEFAULT TRUE
);

CREATE TABLE menus (
    menu_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(restaurant_id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- e.g., "Breakfast", "EV Charging Special Express Menu"
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE menu_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_id UUID REFERENCES menus(menu_id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    price_coins NUMERIC(10, 2) NOT NULL,
    is_available BOOLEAN DEFAULT TRUE
);

-- ============================================================================
-- 5. PHYSICS-BASED ROUTING & LOGISTICS VISIBILITY
-- ============================================================================

CREATE TABLE trips (
    trip_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id),
    user_vehicle_id UUID REFERENCES user_vehicles(user_vehicle_id),
    start_location GEOGRAPHY(Point, 4326) NOT NULL,
    end_location GEOGRAPHY(Point, 4326) NOT NULL,
    estimated_arrival_time TIMESTAMP WITH TIME ZONE,
    current_eta_to_next_stop TIMESTAMP WITH TIME ZONE, -- Shared dynamically with restaurants
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Weather/Physics snapshots along the path for calculations
CREATE TABLE trip_waypoints (
    waypoint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID REFERENCES trips(trip_id) ON DELETE CASCADE,
    sequence_order INT NOT NULL,
    geo_location GEOGRAPHY(Point, 4326) NOT NULL,
    elevation_meters NUMERIC(6, 2), -- Physics element
    predicted_wind_direction_deg INT, -- Physics element
    predicted_wind_speed_mps NUMERIC(4, 2), -- Physics element
    associated_station_id UUID REFERENCES charging_stations(station_id) ON DELETE SET NULL
);

-- ============================================================================
-- 6. TRANSACTIONS: INTEGRATED COMMERCE (UNIFIED CHARGING & FOOD)
-- ============================================================================

-- Unified Booking Session acting as the parent for both charging and dining
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

-- Food orders nested within the charging session/interval
CREATE TABLE food_orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES unified_booking_sessions(session_id) ON DELETE SET NULL,
    restaurant_id UUID REFERENCES restaurants(restaurant_id),
    status order_status DEFAULT 'pending',
    delivery_to_vehicle BOOLEAN DEFAULT FALSE, -- True = Direct to car delivery, False = Takeaway
    parking_spot_identifier VARCHAR(50),      -- Helps delivery staff find the specific charging bay
    total_food_cost_coins NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
    order_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES food_orders(order_id) ON DELETE CASCADE,
    item_id UUID REFERENCES menu_items(item_id),
    quantity INT NOT NULL CHECK (quantity > 0),
    price_at_purchase_coins NUMERIC(10, 2) NOT NULL
);

-- ============================================================================
-- 7. DISCOVERY, GAMIFICATION, & COMMUNITY
-- ============================================================================

-- Points of interest / local amenities close to stations
CREATE TABLE local_amenities (
    amenity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    category VARCHAR(100), -- e.g., "Natural Landmark", "Historical Site"
    description TEXT,
    geo_location GEOGRAPHY(Point, 4326) NOT NULL
);

-- Maps closest amenities to stations for notifications
CREATE TABLE station_amenities_mapping (
    station_id UUID REFERENCES charging_stations(station_id) ON DELETE CASCADE,
    amenity_id UUID REFERENCES local_amenities(amenity_id) ON DELETE CASCADE,
    distance_meters NUMERIC(7, 2),
    PRIMARY KEY (station_id, amenity_id)
);

-- Social Feature: Travel Itineraries
CREATE TABLE travel_itineraries (
    itinerary_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE itinerary_stops (
    stop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    itinerary_id UUID REFERENCES travel_itineraries(itinerary_id) ON DELETE CASCADE,
    sequence_order INT NOT NULL,
    station_id UUID REFERENCES charging_stations(station_id),
    notes_or_tips TEXT
);

CREATE TABLE itinerary_reviews (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    itinerary_id UUID REFERENCES travel_itineraries(itinerary_id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(user_id),
    rating INT CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 8. INDEXES FOR PERFORMANCE OPTIMIZATION
-- ============================================================================

-- Spatial Indexes for Real-time Station Discovery and Proximity Filtering
CREATE INDEX idx_stations_geo ON charging_stations USING GIST (geo_location);
CREATE INDEX idx_amenities_geo ON local_amenities USING GIST (geo_location);

-- Foreign Key/Lookup Optimization Indexes
CREATE INDEX idx_spots_station ON charging_spots(station_id, status);
CREATE INDEX idx_orders_session ON food_orders(session_id);
CREATE INDEX idx_trips_eta ON trips(current_eta_to_next_stop);