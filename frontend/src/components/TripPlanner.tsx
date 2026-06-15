import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import L from 'leaflet';
import {
  Navigation, ShieldAlert, Trash2, Eye, MapPin, Locate, Search, X
} from 'lucide-react';

interface MenuItem {
  item_id: string;
  name: string;
  description: string | null;
  price_coins: number;
  is_available: boolean;
}

interface StationSpot {
  spot_id: string;
  plug_id: string;
  max_power_kw: number;
  status: string;
}

interface Station {
  station_id: string;
  name: string;
  type: string;
  address: string;
  lat: number;
  lon: number;
  distance_from_route_meters: number;
  spots: StationSpot[];
  arrival_soc: number;
  charge_cost_coins: number;
}

interface Restaurant {
  restaurant_id: string;
  associated_station_id: string | null;
  name: string;
  lat: number;
  lon: number;
}

interface Amenity {
  amenity_id: string;
  name: string;
  category: string | null;
  description: string | null;
  lat: number;
  lon: number;
}

interface RecommendedStop {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  charge_needed_kwh: number;
  charge_time_mins: number;
  charge_cost_coins: number;
}

interface UserVehicle {
  user_vehicle_id: string;
  current_battery_percent: number;
  battery_degradation_factor: number;
  custom_aerodynamic_rating: number | null;
  catalog_model: {
    brand: string;
    model_name: string;
    battery_capacity_kwh: number;
    base_drag_coefficient: number;
  } | null;
}

interface SavedTripWaypoint {
  waypoint_id: string;
  sequence_order: number;
  lat: number;
  lon: number;
  associated_station_id: string | null;
}

interface SavedTrip {
  trip_id: string;
  user_vehicle_id: string;
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
  estimated_arrival_time: string | null;
  created_at: string;
  waypoints: SavedTripWaypoint[];
}

interface WaypointEstimate {
  sequence_order: number;
  name: string;
  lat: number;
  lon: number;
  arrival_soc: number;
  charge_cost_coins: number;
}

interface TripPlanResponse {
  polyline: string;
  distance_km: number;
  duration_mins: number;
  start_soc: number;
  end_soc: number;
  requires_charge: boolean;
  recommended_stop: RecommendedStop | null;
  stations_along_route: Station[];
  restaurants_along_route: Restaurant[];
  amenities_along_route: Amenity[];
  waypoint_estimates: WaypointEstimate[];
}

interface TripPlannerProps {
  activeVehicle: UserVehicle | null;
  onStartNavigation: (planResult: TripPlanResponse, routeCoords: [number, number][]) => void;
}

// Polyline6 decoder
function decodePolyline6(str: string): [number, number][] {
  let index = 0, lat = 0, lng = 0, coordinates: [number, number][] = [];
  const factor = 1e6;
  while (index < str.length) {
    let byte, shift = 0, result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

interface OsmPlace {
  name: string;
  lat: number;
  lon: number;
}

const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`, {
      headers: {
        'User-Agent': 'VoltRoute-Trip-Planner'
      }
    });
    const data = await response.json();
    return data.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } catch (err) {
    console.error("Reverse geocoding failed", err);
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
};

export const TripPlanner: React.FC<TripPlannerProps> = ({ activeVehicle, onStartNavigation }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const routeLineRef = useRef<L.Polyline | null>(null);

  // Form locations state
  const [startCoords, setStartCoords] = useState<{ lat: number; lon: number }>({ lat: 27.7150, lon: 85.3110 }); // Thamel
  const [endCoords, setEndCoords] = useState<{ lat: number; lon: number }>({ lat: 27.7215, lon: 85.3600 }); // Boudha
  const [settingMode, setSettingMode] = useState<'start' | 'end' | 'waypoint' | null>(null);

  const settingModeRef = useRef<'start' | 'end' | 'waypoint' | null>(null);
  useEffect(() => {
    settingModeRef.current = settingMode;
  }, [settingMode]);

  // Custom stops/waypoints
  const [waypoints, setWaypoints] = useState<{ lat: number; lon: number; name: string; station_id?: string }[]>([]);

  // Persistent readable addresses for start & destination
  const [startAddress, setStartAddress] = useState('Thamel, Kathmandu');
  const [endAddress, setEndAddress] = useState('Boudha, Kathmandu');

  // Search input & suggestion states for the active settingMode
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<OsmPlace[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Sync searchQuery when settingMode changes
  useEffect(() => {
    if (settingMode === 'start') {
      setSearchQuery(startAddress);
    } else if (settingMode === 'end') {
      setSearchQuery(endAddress);
    } else if (settingMode === 'waypoint') {
      setSearchQuery('');
    }
    setSuggestions([]);
  }, [settingMode, startAddress, endAddress]);

  // Debounced search for OSM places
  useEffect(() => {
    if (!settingMode || !searchQuery) {
      setSuggestions([]);
      return;
    }

    // Don't search if it's the exact address we already have set or a simple coordinates string
    if (settingMode === 'start' && searchQuery === startAddress) return;
    if (settingMode === 'end' && searchQuery === endAddress) return;
    if (searchQuery.match(/^[-+]?[0-9]*\.?[0-9]+,\s*[-+]?[0-9]*\.?[0-9]+$/)) return;

    const delayDebounceFn = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`, {
          headers: { 'User-Agent': 'VoltRoute-Trip-Planner' }
        });
        const data = await response.json();
        if (data && Array.isArray(data)) {
          setSuggestions(data.map((item: any) => ({
            name: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon)
          })));
        } else {
          setSuggestions([]);
        }
      } catch (err) {
        console.error("OSM search failed", err);
        setSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 600);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, settingMode, startAddress, endAddress]);

  // Suggestion selection handler
  const handleSelectSuggestion = (place: OsmPlace) => {
    if (settingMode === 'start') {
      setStartCoords({ lat: place.lat, lon: place.lon });
      setStartAddress(place.name);
    } else if (settingMode === 'end') {
      setEndCoords({ lat: place.lat, lon: place.lon });
      setEndAddress(place.name);
    } else if (settingMode === 'waypoint') {
      setWaypoints(prev => [...prev, { lat: place.lat, lon: place.lon, name: place.name }]);
    }

    if (mapRef.current) {
      mapRef.current.setView([place.lat, place.lon], 14);
    }

    setSuggestions([]);
    setSettingMode(null);
  };

  // GPS Location handler
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        if (settingMode === 'start') {
          setStartCoords({ lat: latitude, lon: longitude });
          const address = await reverseGeocode(latitude, longitude);
          setStartAddress(address);
        } else if (settingMode === 'end') {
          setEndCoords({ lat: latitude, lon: longitude });
          const address = await reverseGeocode(latitude, longitude);
          setEndAddress(address);
        } else if (settingMode === 'waypoint') {
          const address = await reverseGeocode(latitude, longitude);
          setWaypoints(prev => [...prev, { lat: latitude, lon: longitude, name: address }]);
        }

        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 14);
        }

        setSettingMode(null);
      },
      (error) => {
        console.error("Error fetching geolocation", error);
        alert("Failed to get current location. Please verify location permissions.");
      }
    );
  };

  // Plan results
  const [planResult, setPlanResult] = useState<TripPlanResponse | null>(null);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Selected item detail state
  const [selectedItem, setSelectedItem] = useState<{
    type: 'station' | 'restaurant' | 'amenity';
    data: any;
  } | null>(null);
  const [restaurantMenu, setRestaurantMenu] = useState<MenuItem[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(false);

  // Saved trips
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savingTrip, setSavingTrip] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Active sub-tab in sidebar
  const [activeTab, setActiveTab] = useState<'perks' | 'waypoints' | 'saved'>('waypoints');
  const [perkCategory, setPerkCategory] = useState<'stations' | 'restaurants' | 'amenities'>('stations');

  // Mobile drawer expanded state
  const [isSheetExpanded, setIsSheetExpanded] = useState<boolean>(false);
  const touchStartY = useRef<number | null>(null);
  const didDrag = useRef<boolean>(false);

  // Init map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [27.7150, 85.3110],
      zoom: 13,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // CartoDB dark tiles to match dark mode theme
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap &copy; CartoDB'
    }).addTo(map);

    mapRef.current = map;

    map.on('click', async (e) => {
      const { lat, lng } = e.latlng;
      const current = settingModeRef.current;
      if (current === 'start') {
        setStartCoords({ lat, lon: lng });
        setSettingMode(null);
        const address = await reverseGeocode(lat, lng);
        setStartAddress(address);
      } else if (current === 'end') {
        setEndCoords({ lat, lon: lng });
        setSettingMode(null);
        const address = await reverseGeocode(lat, lng);
        setEndAddress(address);
      } else if (current === 'waypoint') {
        const address = await reverseGeocode(lat, lng);
        setWaypoints(prev => [...prev, { lat, lon: lng, name: address }]);
        setSettingMode(null);
      }
    });

    fetchSavedTrips();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Fetch saved trips
  const fetchSavedTrips = async () => {
    setLoadingSaved(true);
    try {
      const res = await apiClient.get('/trips');
      setSavedTrips(res.data);
    } catch (err) {
      console.error("Failed to load saved trips", err);
    } finally {
      setLoadingSaved(false);
    }
  };

  // Run planning calculation
  const calculateOptimalRoute = async () => {
    if (!activeVehicle) {
      setPlanningError("Please configure and select an active vehicle first in the Dashboard.");
      return;
    }
    setCalculating(true);
    setPlanningError(null);
    setSelectedItem(null);

    try {
      const response = await apiClient.post('/trips/plan', {
        start_lat: startCoords.lat,
        start_lon: startCoords.lon,
        end_lat: endCoords.lat,
        end_lon: endCoords.lon,
        vehicle_id: activeVehicle.user_vehicle_id,
        custom_stops: waypoints.map(wp => ({
          lat: wp.lat,
          lon: wp.lon,
          name: wp.name,
          station_id: wp.station_id
        }))
      });

      const data: TripPlanResponse = response.data;
      setPlanResult(data);

      // Render polyline and fit map bounds
      if (mapRef.current) {
        if (routeLineRef.current) {
          routeLineRef.current.remove();
        }

        const decoded = decodePolyline6(data.polyline);
        const polyline = L.polyline(decoded, {
          color: '#ea580c',
          weight: 5,
          opacity: 0.9,
          className: 'marker-glow-primary'
        }).addTo(mapRef.current);

        routeLineRef.current = polyline;
        mapRef.current.fitBounds(polyline.getBounds(), { padding: [50, 50] });
      }
    } catch (err: any) {
      console.error(err);
      setPlanningError(err.response?.data?.detail || "Could not plan optimal route. Check Valhalla engine connectivity.");
    } finally {
      setCalculating(false);
    }
  };

  // Calculate route on changes to start, destination, vehicle or waypoints
  useEffect(() => {
    if (activeVehicle) {
      calculateOptimalRoute();
    }
  }, [startCoords, endCoords, waypoints, activeVehicle]);

  // Sync Markers when plan results or coords update
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Plot Start & End with VoltRoute custom design
    const startIcon = L.divIcon({
      className: 'start-marker-custom',
      html: `
        <div class="relative flex flex-col items-center">
          <div class="bg-[#161416] text-[#ea580c] font-sans font-bold text-xs px-2.5 py-1.5 rounded-xl border border-[#ea580c]/30 shadow-[0_0_12px_rgba(234,88,12,0.4)] flex items-center gap-1.5">
            <span class="material-symbols-outlined text-xs">home</span>
            <span>Home</span>
          </div>
          <div class="w-0.5 h-2 bg-[#ea580c]"></div>
        </div>
      `,
      iconSize: [60, 40],
      iconAnchor: [30, 40]
    });
    const startM = L.marker([startCoords.lat, startCoords.lon], { icon: startIcon }).addTo(map);
    markersRef.current.push(startM);

    const destIcon = L.divIcon({
      className: 'dest-marker-custom',
      html: `
        <div class="relative flex flex-col items-center">
          <div class="bg-[#161416] text-white font-sans font-bold text-xs px-2.5 py-1.5 rounded-xl border border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.4)] flex items-center gap-1.5">
            <span class="material-symbols-outlined text-red-500 text-xs">flag</span>
            <span>Dest</span>
          </div>
          <div class="w-0.5 h-2 bg-red-500"></div>
        </div>
      `,
      iconSize: [60, 40],
      iconAnchor: [30, 40]
    });
    const destM = L.marker([endCoords.lat, endCoords.lon], { icon: destIcon }).addTo(map);
    markersRef.current.push(destM);

    // Plot waypoints
    waypoints.forEach((wp, idx) => {
      const wpIcon = L.divIcon({
        className: 'wp-marker-custom',
        html: `
          <div class="relative flex flex-col items-center">
            <div class="w-8 h-8 rounded-full bg-[#161416] border-2 border-[#ea580c] flex items-center justify-center text-white font-mono font-bold text-xs shadow-lg shadow-[#ea580c]/20">${idx + 1}</div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });
      const wpM = L.marker([wp.lat, wp.lon], { icon: wpIcon }).addTo(map)
        .bindPopup(`<span class="text-slate-900 font-bold font-sans text-xs">${wp.name}</span>`);
      markersRef.current.push(wpM);
    });

    if (!planResult) return;

    // Plot stations
    planResult.stations_along_route.forEach(st => {
      const isRec = planResult.recommended_stop?.station_id === st.station_id;
      const markerHtml = isRec
        ? `
          <div class="relative flex flex-col items-center animate-bounce">
            <div class="bg-[#161416] border border-orange-500 rounded-lg p-1.5 shadow-[0_0_12px_rgba(234,88,12,0.6)] flex items-center justify-center">
              <span class="material-symbols-outlined text-orange-500 text-sm font-bold" style="font-variation-settings: 'FILL' 1;">bolt</span>
            </div>
            <div class="w-0.5 h-2 bg-orange-500"></div>
          </div>
        `
        : `
          <div class="relative flex flex-col items-center">
            <div class="bg-[#161416] border border-[#ea580c]/30 rounded-lg p-1 flex items-center justify-center">
              <span class="material-symbols-outlined text-[#ea580c] text-sm font-bold">bolt</span>
            </div>
            <div class="w-0.5 h-2 bg-[#ea580c]/50"></div>
          </div>
        `;

      const stIcon = L.divIcon({
        className: 'station-pin-custom',
        html: markerHtml,
        iconSize: [36, 36],
        iconAnchor: [18, 36]
      });

      const stM = L.marker([st.lat, st.lon], { icon: stIcon })
        .addTo(map)
        .on('click', () => {
          setSelectedItem({ type: 'station', data: st });
          setActiveTab('perks');
          setPerkCategory('stations');
        });
      markersRef.current.push(stM);
    });

    // Plot restaurants
    planResult.restaurants_along_route.forEach(rt => {
      const rtIcon = L.divIcon({
        className: 'restaurant-pin-custom',
        html: `
          <div class="relative flex flex-col items-center">
            <div class="bg-[#161416] border border-orange-500/30 rounded-lg p-1 flex items-center justify-center">
              <span class="material-symbols-outlined text-orange-500 text-xs">restaurant</span>
            </div>
            <div class="w-0.5 h-2 bg-orange-500/50"></div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      });
      const rtM = L.marker([rt.lat, rt.lon], { icon: rtIcon })
        .addTo(map)
        .on('click', () => {
          setSelectedItem({ type: 'restaurant', data: rt });
          setActiveTab('perks');
          setPerkCategory('restaurants');
        });
      markersRef.current.push(rtM);
    });

    // Plot amenities
    planResult.amenities_along_route.forEach(am => {
      const amIcon = L.divIcon({
        className: 'amenity-pin-custom',
        html: `
          <div class="relative flex flex-col items-center">
            <div class="bg-[#161416] border border-[#a8a29e]/30 rounded-lg p-1 flex items-center justify-center">
              <span class="material-symbols-outlined text-[#a8a29e] text-xs">park</span>
            </div>
            <div class="w-0.5 h-2 bg-[#a8a29e]/50"></div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      });
      const amM = L.marker([am.lat, am.lon], { icon: amIcon })
        .addTo(map)
        .on('click', () => {
          setSelectedItem({ type: 'amenity', data: am });
          setActiveTab('perks');
          setPerkCategory('amenities');
        });
      markersRef.current.push(amM);
    });

  }, [planResult, startCoords, endCoords, waypoints]);

  // Load menu items when a restaurant is selected
  useEffect(() => {
    if (selectedItem?.type === 'restaurant') {
      const restId = selectedItem.data.restaurant_id;
      setLoadingMenu(true);
      setRestaurantMenu([]);
      apiClient.get(`/restaurants/${restId}/menu`)
        .then(res => {
          setRestaurantMenu(res.data);
        })
        .catch(err => {
          console.error("Failed to load restaurant menu", err);
        })
        .finally(() => {
          setLoadingMenu(false);
        });
    }
  }, [selectedItem]);

  // Save Trip to backend
  const handleSaveTrip = async () => {
    if (!activeVehicle) return;
    setSavingTrip(true);
    setSaveSuccess(false);
    try {
      await apiClient.post('/trips', {
        user_vehicle_id: activeVehicle.user_vehicle_id,
        start_lat: startCoords.lat,
        start_lon: startCoords.lon,
        end_lat: endCoords.lat,
        end_lon: endCoords.lon,
        waypoints: waypoints.map(wp => ({
          lat: wp.lat,
          lon: wp.lon,
          name: wp.name,
          station_id: wp.station_id
        }))
      });
      setSaveSuccess(true);
      fetchSavedTrips();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save trip", err);
    } finally {
      setSavingTrip(false);
    }
  };

  // Load Saved Trip
  const handleLoadSavedTrip = async (trip: SavedTrip) => {
    setStartCoords({ lat: trip.start_lat, lon: trip.start_lon });
    setEndCoords({ lat: trip.end_lat, lon: trip.end_lon });

    const wps = trip.waypoints.map((wp) => ({
      lat: wp.lat,
      lon: wp.lon,
      name: wp.associated_station_id ? `Station Waypoint` : `Saved Stop`,
      station_id: wp.associated_station_id || undefined
    }));
    setWaypoints(wps);

    const startAddr = await reverseGeocode(trip.start_lat, trip.start_lon);
    setStartAddress(startAddr);
    const endAddr = await reverseGeocode(trip.end_lat, trip.end_lon);
    setEndAddress(endAddr);
  };

  // Delete Saved Trip
  const handleDeleteSavedTrip = async (tripId: string) => {
    try {
      await apiClient.delete(`/trips/${tripId}`);
      setSavedTrips(prev => prev.filter(t => t.trip_id !== tripId));
    } catch (err) {
      console.error("Failed to delete trip", err);
    }
  };

  const addStopToRoute = (lat: number, lon: number, name: string, stationId?: string) => {
    setWaypoints(prev => [...prev, { lat, lon, name, station_id: stationId }]);
  };

  return (
    <div className="flex flex-col md:flex-row h-full w-full bg-[#0C0B0C] overflow-hidden text-[#e7e1e3] relative">
      
      {/* Mobile-Only Trip Analytics Header */}
      {planResult && (
        <div className="md:hidden bg-slate-900 border-b border-slate-800 py-3 px-4 flex justify-between items-center z-45 shrink-0 font-sans">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">DISTANCE</span>
            <span className="text-[15px] font-bold text-[#e7e1e3] leading-tight">{planResult.distance_km.toFixed(0)}km</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">TIME</span>
            <span className="text-[15px] font-bold text-[#e7e1e3] leading-tight">{Math.floor(planResult.duration_mins / 60)}h {planResult.duration_mins % 60}m</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">ARRIVAL SOC</span>
            <span className="text-[15px] font-bold text-[#ffc640] leading-tight">{planResult.end_soc}%</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">EST. COST</span>
            <div className="flex items-center gap-1">
              <span className="text-[15px] font-bold text-[#e7e1e3]">{planResult.recommended_stop ? planResult.recommended_stop.charge_cost_coins.toFixed(1) : "0.0"}</span>
              <span className="text-[9px] text-[#ffc640] font-bold font-mono">COINS</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Map View Section */}
      <section className="flex-1 relative overflow-hidden h-full bg-[#0C0B0C] min-h-0 flex flex-col">
        <div className="absolute inset-0 z-0">
          <div ref={mapContainerRef} className="w-full h-full bg-[#0c0b0c]" />
          <div className="absolute inset-0 z-5 map-overlay pointer-events-none" />
        </div>

        {/* Unified Search Panel (Mobile & Desktop) */}
        {settingMode && (settingMode === 'start' || settingMode === 'end' || settingMode === 'waypoint') && (
          <div className="absolute top-4 left-4 right-4 md:right-auto md:w-96 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 z-30 transition-all duration-300">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 className="text-xs font-bold text-[#f97316] uppercase tracking-wider font-mono">
                {settingMode === 'start' && 'Set Start Location'}
                {settingMode === 'end' && 'Set Destination'}
                {settingMode === 'waypoint' && 'Add Mid Stop'}
              </h3>
              <button 
                onClick={() => setSettingMode(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="relative">
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 focus-within:border-[#f97316]/50 transition-all">
                <Search className="w-4 h-4 text-slate-500 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    settingMode === 'start' ? 'Search start point...' :
                    settingMode === 'end' ? 'Search destination...' :
                    'Search mid stop...'
                  }
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-500 w-full"
                  autoFocus
                />
                {searchLoading && <div className="w-3.5 h-3.5 border-2 border-[#f97316] border-t-transparent rounded-full animate-spin shrink-0" />}
              </div>

              {/* Suggestions dropdown */}
              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl z-50 max-h-48 overflow-y-auto no-scrollbar">
                  {suggestions.map((place, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSelectSuggestion(place)}
                      className="w-full text-left px-3 py-2.5 text-[11px] text-slate-350 hover:bg-[#f97316]/10 hover:text-white border-b border-slate-900/50 last:border-none transition-colors truncate"
                    >
                      {place.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleUseCurrentLocation}
                className="flex-1 bg-slate-800/60 hover:bg-slate-800 text-white border border-slate-800 rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all"
              >
                <Locate className="w-3.5 h-3.5 text-[#f97316]" />
                <span>Use GPS</span>
              </button>
              
              <button
                onClick={() => {
                  setSuggestions([]);
                }}
                className="flex-1 bg-slate-800/60 hover:bg-slate-800 text-white border border-slate-800 rounded-xl py-2.5 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all"
              >
                <MapPin className="w-3.5 h-3.5 text-[#f97316]" />
                <span>Pin on Map</span>
              </button>
            </div>
            
            <p className="text-[9px] text-[#f97316] font-mono text-center animate-pulse">
              You can also click anywhere on the map to set the location.
            </p>
          </div>
        )}

        {/* Floating recommended stop banner (Mobile only) */}
        {planResult?.recommended_stop && (
          <div className={`md:hidden absolute ${settingMode ? 'top-[220px]' : 'top-4'} left-4 right-4 z-30 transition-all duration-300`}>
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/15 flex items-center justify-center border border-indigo-500/30 shrink-0">
                  <span className="material-symbols-outlined text-indigo-500" style={{ fontVariationSettings: "'FILL' 1" }}>ev_station</span>
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-white truncate">{planResult.recommended_stop.name}</h4>
                  <p className="text-[10px] font-mono text-slate-400 mt-0.5">+{planResult.recommended_stop.charge_needed_kwh.toFixed(0)} kWh • {planResult.recommended_stop.charge_time_mins} min</p>
                </div>
              </div>
              <button 
                onClick={() => addStopToRoute(planResult.recommended_stop!.lat, planResult.recommended_stop!.lon, planResult.recommended_stop!.name, planResult.recommended_stop!.station_id)}
                className="bg-indigo-500 text-slate-950 px-4 py-2 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider transition active:scale-95 shrink-0"
              >
                Insert
              </button>
            </div>
          </div>
        )}

        {/* Floating Start Navigation Button (Mobile only) */}
        {planResult && (
          <div 
            className="md:hidden absolute left-0 right-0 px-4 z-45 transition-all duration-300"
            style={{ bottom: isSheetExpanded ? 'calc(65vh + 80px)' : '294px' }}
          >
            <button 
              onClick={() => onStartNavigation(planResult, decodePolyline6(planResult.polyline))}
              className="w-full bg-indigo-500 text-slate-950 h-14 rounded-full flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(234,88,12,0.4)] active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>navigation</span>
              <span className="text-xs font-bold uppercase tracking-widest font-mono">Start Live Navigation</span>
            </button>
          </div>
        )}

        {/* Floating Map Actions (Mobile & Desktop) */}
        <div className={`${isSheetExpanded ? 'hidden' : 'flex'} absolute ${planResult ? 'bottom-[362px]' : 'bottom-[285px]'} md:bottom-8 left-1/2 -translate-x-1/2 gap-2 md:gap-3 z-30 drop-shadow-2xl max-w-[95%] w-max transition-all duration-300`}>
          <button
            onClick={() => setSettingMode(settingMode === 'start' ? null : 'start')}
            className={`glass-panel px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-bold transition-all active:scale-95 text-white ${
              settingMode === 'start' ? 'bg-[#f97316]/80 border-[#ea580c] animate-pulse' : 'hover:bg-[#f97316]/10'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-[#f97316]">home</span>
            <span>SET START</span>
          </button>
          <button
            onClick={() => setSettingMode(settingMode === 'waypoint' ? null : 'waypoint')}
            className={`glass-panel px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-bold transition-all active:scale-95 text-white ${
              settingMode === 'waypoint' ? 'bg-[#f97316]/80 border-[#ea580c] animate-pulse' : 'hover:bg-[#f97316]/10'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-[#f97316]">add_location</span>
            <span>ADD MID STOP</span>
          </button>
          <button
            onClick={() => setSettingMode(settingMode === 'end' ? null : 'end')}
            className={`glass-panel px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-bold transition-all active:scale-95 text-white ${
              settingMode === 'end' ? 'bg-[#f97316]/80 border-[#ea580c] animate-pulse' : 'hover:bg-[#f97316]/10'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-[#f97316]">flag</span>
            <span>SET DESTINATION</span>
          </button>
        </div>

        {/* Re-calculating Path Loading Spinner overlay */}
        {calculating && (
          <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm z-[1000] flex items-center justify-center">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center shadow-2xl max-w-xs">
              <Navigation className="w-8 h-8 text-indigo-500 animate-bounce mx-auto mb-3" />
              <h4 className="font-bold text-xs text-white">Re-routing Path</h4>
              <p className="text-[10px] text-slate-400 mt-1">Executing EV physics equations and searching amenities via PostGIS...</p>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {planningError && (
          <div className="absolute bottom-4 left-4 right-4 md:left-8 md:right-auto bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold p-4 rounded-xl flex gap-2.5 items-start z-[1000] backdrop-blur-md max-w-md shadow-xl">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{planningError}</span>
          </div>
        )}
      </section>

      {/* Sidebar Pane (Desktop only) */}
      <aside className="hidden md:flex w-[360px] h-full flex-col bg-slate-900 border-l border-slate-800 z-40 overflow-hidden shrink-0">
        
        {/* Sidebar Header: Analytics */}
        <div className="p-5 border-b border-slate-800 space-y-6 shrink-0 bg-gradient-to-b from-indigo-950/20 to-transparent">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-black text-white tracking-tight">Trip Analytics</h2>
            {planResult && (
              <div className="flex flex-col items-end">
                <div className={`px-2 py-1 rounded-lg font-mono font-black text-sm transition-colors ${planResult.recommended_stop && planResult.recommended_stop.charge_cost_coins > 0 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-400'}`}>
                  {planResult.recommended_stop ? planResult.recommended_stop.charge_cost_coins.toFixed(1) : "0.0"} Coins
                </div>
                <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-1">Est. Cost</div>
              </div>
            )}
          </div>

          {planResult ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/50 text-center shadow-inner">
                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest font-mono">Distance</div>
                <div className="text-xl font-black text-white mt-1">{planResult.distance_km.toFixed(0)}<span className="text-[10px] font-bold ml-0.5">km</span></div>
              </div>
              <div className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/50 text-center shadow-inner">
                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest font-mono">Time</div>
                <div className="text-xl font-black text-white mt-1">{Math.floor(planResult.duration_mins / 60)}<span className="text-[10px] font-bold">h</span>{planResult.duration_mins % 60}<span className="text-[10px] font-bold">m</span></div>
              </div>
              <div className="bg-slate-800/60 p-3 rounded-2xl border border-slate-700/50 text-center shadow-inner">
                <div className="text-[9px] text-slate-400 font-bold uppercase tracking-widest font-mono">Arrival</div>
                <div className="text-xl font-black text-emerald-400 mt-1">{planResult.end_soc}<span className="text-[10px] font-bold ml-0.5">%</span></div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-2xl border border-dashed border-slate-800">
              Select waypoints to compute paths...
            </div>
          )}
        </div>

        {/* Recommended Stop Banner (Desktop only) */}
        {planResult?.recommended_stop && (
          <div className="mx-4 mb-4 mt-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-4 overflow-hidden relative shrink-0">
            <div className="flex items-start gap-3 relative z-10">
              <span className="material-symbols-outlined text-indigo-500 font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
              <div className="flex-1 min-w-0">
                <h3 className="text-[10px] font-bold text-indigo-500 mb-1 uppercase tracking-wider font-mono">Charging Recommendation</h3>
                <p className="text-xs font-bold text-white truncate">{planResult.recommended_stop.name}</p>
                <div className="flex gap-4 mt-2 text-[10px] font-mono text-slate-400">
                  <span>+{planResult.recommended_stop.charge_needed_kwh.toFixed(1)} kWh</span>
                  <span>{planResult.recommended_stop.charge_time_mins} mins</span>
                </div>
                <button
                  onClick={() => addStopToRoute(planResult.recommended_stop!.lat, planResult.recommended_stop!.lon, planResult.recommended_stop!.name, planResult.recommended_stop!.station_id)}
                  className="mt-3 w-full bg-indigo-500 hover:bg-indigo-400 text-slate-950 font-bold text-[10px] uppercase font-mono py-2 rounded-lg transition-all active:scale-[0.98]"
                >
                  Insert as Stop Waypoint
                </button>
              </div>
            </div>
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <span className="material-symbols-outlined text-6xl text-indigo-500">ev_station</span>
            </div>
          </div>
        )}

        {/* Tabs switcher */}
        <div className="flex border-b border-slate-800 shrink-0 bg-slate-900">
          <button
            onClick={() => setActiveTab('waypoints')}
            className={`flex-1 py-3 text-center text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 cursor-pointer ${
              activeTab === 'waypoints' ? 'border-indigo-500 text-indigo-500' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Waypoints
          </button>
          <button
            onClick={() => setActiveTab('perks')}
            className={`flex-1 py-3 text-center text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 cursor-pointer ${
              activeTab === 'perks' ? 'border-indigo-500 text-indigo-500' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Extra Perks
          </button>
          <button
            onClick={() => setActiveTab('saved')}
            className={`flex-1 py-3 text-center text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 cursor-pointer ${
              activeTab === 'saved' ? 'border-indigo-500 text-indigo-500' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Saved
          </button>
        </div>

        {/* Tab contents (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          {activeTab === 'waypoints' && (
            <div className="space-y-4">
              {waypoints.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No waypoints added yet.</div>
              ) : (
                <div className="space-y-3">
                  {waypoints.map((wp, index) => {
                    const est = planResult?.waypoint_estimates?.find(e => e.sequence_order === index + 1);
                    return (
                      <div key={index} className="glass-panel p-3.5 rounded-xl border border-slate-800 flex justify-between items-start gap-3">
                        <div className="flex gap-3">
                          <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-mono font-bold text-slate-350 shrink-0">{index + 1}</div>
                          <div>
                            <h4 className="text-xs font-bold text-white line-clamp-1">{wp.name}</h4>
                            {est && (
                              <p className="text-[10px] text-slate-400 mt-0.5">Arr: {est.arrival_soc}% SoC • Cost: {est.charge_cost_coins.toFixed(1)} Coins</p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setWaypoints(prev => prev.filter((_, i) => i !== index))}
                          className="text-slate-500 hover:text-red-400 transition-colors shrink-0"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'perks' && (
            <div className="space-y-4">
              <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => { setPerkCategory('stations'); setSelectedItem(null); }}
                  className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${
                    perkCategory === 'stations' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Stations
                </button>
                <button
                  onClick={() => { setPerkCategory('restaurants'); setSelectedItem(null); }}
                  className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${
                    perkCategory === 'restaurants' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Dining
                </button>
                <button
                  onClick={() => { setPerkCategory('amenities'); setSelectedItem(null); }}
                  className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${
                    perkCategory === 'amenities' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Parks
                </button>
              </div>

              {selectedItem ? (
                <div className="glass-panel p-4 rounded-xl space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-white">{selectedItem.data.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">{selectedItem.data.address || selectedItem.data.description}</p>
                    </div>
                    <button onClick={() => setSelectedItem(null)} className="text-[10px] text-indigo-500 hover:underline shrink-0">Close</button>
                  </div>

                  {selectedItem.type === 'station' && selectedItem.data.spots && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-800">
                      {selectedItem.data.spots.map((sp: any, i: number) => (
                        <div key={i} className="flex justify-between text-[10px] bg-slate-950/50 p-2 rounded-lg border border-slate-900">
                          <span className="font-bold text-slate-300">{sp.plug_id}</span>
                          <span className="text-indigo-400 font-bold">{sp.max_power_kw}kW</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedItem.type === 'restaurant' && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-800">
                      {loadingMenu ? (
                        <p className="text-[10px] text-slate-500">Loading menu...</p>
                      ) : restaurantMenu.map(menuItem => (
                        <div key={menuItem.item_id} className="flex justify-between text-[10px] bg-slate-950/50 p-2 rounded-lg border border-slate-900">
                          <span className="text-slate-300">{menuItem.name}</span>
                          <span className="text-[#ffc640] font-bold">{menuItem.price_coins} Coins</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => addStopToRoute(selectedItem.data.lat, selectedItem.data.lon, selectedItem.data.name, selectedItem.type === 'station' ? selectedItem.data.station_id : undefined)}
                    className="w-full py-2 bg-indigo-500 text-slate-950 font-bold text-[10px] uppercase rounded-lg transition-all active:scale-[0.98]"
                  >
                    Insert Stops Waypoint
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {planResult ? (
                    <>
                      {perkCategory === 'stations' && planResult.stations_along_route.map(st => (
                        <div key={st.station_id} onClick={() => setSelectedItem({ type: 'station', data: st })} className="glass-panel p-3 rounded-xl border border-slate-800 hover:border-indigo-500/50 transition-colors cursor-pointer flex justify-between items-center gap-3">
                          <div className="flex items-center gap-3">
                            <div className="bg-slate-800 p-2 rounded-lg text-indigo-500">
                              <span className="material-symbols-outlined text-sm">local_gas_station</span>
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-white">{st.name}</h4>
                              <p className="text-[10px] text-slate-400 mt-0.5">{st.address}</p>
                            </div>
                          </div>
                          <span className="material-symbols-outlined text-slate-500 text-sm">chevron_right</span>
                        </div>
                      ))}

                      {perkCategory === 'restaurants' && planResult.restaurants_along_route.map(rt => (
                        <div key={rt.restaurant_id} onClick={() => setSelectedItem({ type: 'restaurant', data: rt })} className="glass-panel p-3 rounded-xl border border-slate-800 hover:border-indigo-500/50 transition-colors cursor-pointer flex justify-between items-center gap-3">
                          <div className="flex items-center gap-3">
                            <div className="bg-slate-800 p-2 rounded-lg text-indigo-500">
                              <span className="material-symbols-outlined text-sm">restaurant</span>
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-white">{rt.name}</h4>
                              <p className="text-[10px] text-slate-400 mt-0.5">Dining spot off-route</p>
                            </div>
                          </div>
                          <span className="material-symbols-outlined text-slate-500 text-sm">chevron_right</span>
                        </div>
                      ))}

                      {perkCategory === 'amenities' && planResult.amenities_along_route.map(am => (
                        <div key={am.amenity_id} onClick={() => setSelectedItem({ type: 'amenity', data: am })} className="glass-panel p-3 rounded-xl border border-slate-800 hover:border-indigo-500/50 transition-colors cursor-pointer flex justify-between items-center gap-3">
                          <div className="flex items-center gap-3">
                            <div className="bg-slate-800 p-2 rounded-lg text-indigo-500">
                              <span className="material-symbols-outlined text-sm">park</span>
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-white">{am.name}</h4>
                              <p className="text-[10px] text-slate-400 mt-0.5">{am.category || 'Scenic Point'}</p>
                            </div>
                          </div>
                          <span className="material-symbols-outlined text-slate-500 text-sm">chevron_right</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="py-8 text-center text-xs text-slate-500">No route calculated.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'saved' && (
            <div className="space-y-3">
              {loadingSaved ? (
                <div className="py-8 text-center text-xs text-slate-500 animate-pulse">Loading saved logs...</div>
              ) : savedTrips.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No saved configurations.</div>
              ) : (
                savedTrips.map(trip => (
                  <div key={trip.trip_id} className="glass-panel p-4 rounded-xl border border-slate-800 space-y-3">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-white">Kathmandu Valley Trip</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">{trip.waypoints.length} stops • {new Date(trip.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleLoadSavedTrip(trip)} className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/30 transition-colors">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteSavedTrip(trip.trip_id)} className="p-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Sidebar Sticky Actions (Desktop only) */}
        {planResult && (
          <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-3 shrink-0">
            <button
              onClick={() => onStartNavigation(planResult, decodePolyline6(planResult.polyline))}
              className="w-full bg-indigo-600 text-white font-black py-4 rounded-xl flex items-center justify-center gap-3 shadow-xl shadow-indigo-950/40 active:scale-[0.98] transition-all cursor-pointer border border-indigo-400/20"
            >
              <Navigation className="w-5 h-5 fill-current" />
              <span className="uppercase tracking-widest text-sm">Start Live Navigation</span>
            </button>
            <button
              onClick={handleSaveTrip}
              disabled={savingTrip}
              className="w-full bg-slate-800/40 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-800/70 border border-slate-800 transition-colors uppercase text-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              <span>{savingTrip ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Trip Configuration'}</span>
            </button>
          </div>
        )}

      </aside>

      {/* Mobile Expandable Bottom Sheet (Mobile only) */}
      <div 
        className="md:hidden absolute bottom-16 left-0 right-0 bg-slate-900 border-t border-slate-800 rounded-t-[2rem] z-40 flex flex-col transition-all duration-350 shadow-2xl"
        style={{ height: isSheetExpanded ? '65vh' : '210px' }}
      >
        {/* Handle Bar with Drag/Swipe support */}
        <div 
          className="flex justify-center py-3.5 cursor-pointer shrink-0" 
          onClick={() => {
            if (didDrag.current) {
              didDrag.current = false;
              return;
            }
            setIsSheetExpanded(!isSheetExpanded);
          }}
          onTouchStart={(e) => {
            didDrag.current = false;
            touchStartY.current = e.touches[0].clientY;
          }}
          onTouchEnd={(e) => {
            if (touchStartY.current !== null) {
              const deltaY = touchStartY.current - e.changedTouches[0].clientY;
              if (Math.abs(deltaY) > 10) {
                didDrag.current = true;
              }
              if (deltaY > 50) {
                setIsSheetExpanded(true);
              } else if (deltaY < -50) {
                setIsSheetExpanded(false);
              }
              touchStartY.current = null;
            }
          }}
          onMouseDown={(e) => {
            didDrag.current = false;
            touchStartY.current = e.clientY;
          }}
          onMouseUp={(e) => {
            if (touchStartY.current !== null) {
              const deltaY = touchStartY.current - e.clientY;
              if (Math.abs(deltaY) > 10) {
                didDrag.current = true;
              }
              if (deltaY > 50) {
                setIsSheetExpanded(true);
              } else if (deltaY < -50) {
                setIsSheetExpanded(false);
              }
              touchStartY.current = null;
            }
          }}
        >
          <div className="w-12 h-1 bg-slate-700 rounded-full" />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 px-4 shrink-0 bg-slate-900">
          <button
            onClick={() => setActiveTab('waypoints')}
            className={`flex-1 py-2 text-center text-[10px] font-bold uppercase tracking-widest border-b-2 cursor-pointer ${
              activeTab === 'waypoints' ? 'border-indigo-500 text-indigo-500' : 'border-transparent text-slate-400'
            }`}
          >
            Waypoints
          </button>
          <button
            onClick={() => setActiveTab('perks')}
            className={`flex-1 py-2 text-center text-[10px] font-bold uppercase tracking-widest border-b-2 cursor-pointer ${
              activeTab === 'perks' ? 'border-indigo-500 text-indigo-500' : 'border-transparent text-slate-400'
            }`}
          >
            Extra Perks
          </button>
          <button
            onClick={() => setActiveTab('saved')}
            className={`flex-1 py-2 text-center text-[10px] font-bold uppercase tracking-widest border-b-2 cursor-pointer ${
              activeTab === 'saved' ? 'border-indigo-500 text-indigo-500' : 'border-transparent text-slate-400'
            }`}
          >
            Saved
          </button>
        </div>

        {/* Scrollable sheet content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          {activeTab === 'waypoints' && (
            <div className="space-y-3">
              {waypoints.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-6">No intermediate stops configured.</p>
              ) : (
                waypoints.map((wp, idx) => (
                  <div key={idx} className="glass-panel p-3.5 rounded-xl border border-slate-800 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-mono font-bold text-[10px]">{idx + 1}</span>
                      <span className="text-xs font-bold text-white">{wp.name}</span>
                    </div>
                    <button onClick={() => setWaypoints(prev => prev.filter((_, i) => i !== idx))} className="text-slate-500 hover:text-red-400">
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'perks' && (
            <div className="space-y-4">
              <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button onClick={() => setPerkCategory('stations')} className={`flex-1 py-1.5 rounded-md text-[9px] font-bold uppercase ${perkCategory === 'stations' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}>Stations</button>
                <button onClick={() => setPerkCategory('restaurants')} className={`flex-1 py-1.5 rounded-md text-[9px] font-bold uppercase ${perkCategory === 'restaurants' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}>Dining</button>
                <button onClick={() => setPerkCategory('amenities')} className={`flex-1 py-1.5 rounded-md text-[9px] font-bold uppercase ${perkCategory === 'amenities' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}>Parks</button>
              </div>

              <div className="space-y-2">
                {planResult ? (
                  <>
                    {perkCategory === 'stations' && planResult.stations_along_route.map(st => (
                      <div key={st.station_id} className="glass-panel p-3.5 rounded-xl flex justify-between items-center border border-slate-800">
                        <div>
                          <h4 className="text-xs font-bold text-white">{st.name}</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">{st.address}</p>
                        </div>
                        <button onClick={() => addStopToRoute(st.lat, st.lon, st.name, st.station_id)} className="bg-indigo-500/20 text-indigo-400 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase">Add</button>
                      </div>
                    ))}

                    {perkCategory === 'restaurants' && planResult.restaurants_along_route.map(rt => (
                      <div key={rt.restaurant_id} className="glass-panel p-3.5 rounded-xl flex justify-between items-center border border-slate-800">
                        <div>
                          <h4 className="text-xs font-bold text-white">{rt.name}</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">Off-route dining</p>
                        </div>
                        <button onClick={() => addStopToRoute(rt.lat, rt.lon, rt.name)} className="bg-indigo-500/20 text-indigo-400 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase">Add</button>
                      </div>
                    ))}

                    {perkCategory === 'amenities' && planResult.amenities_along_route.map(am => (
                      <div key={am.amenity_id} className="glass-panel p-3.5 rounded-xl flex justify-between items-center border border-slate-800">
                        <div>
                          <h4 className="text-xs font-bold text-white">{am.name}</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">{am.category || 'Scenic'}</p>
                        </div>
                        <button onClick={() => addStopToRoute(am.lat, am.lon, am.name)} className="bg-indigo-500/20 text-indigo-400 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase">Add</button>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-center text-xs text-slate-500 py-6">No calculated route.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'saved' && (
            <div className="space-y-3">
              {savedTrips.map(trip => (
                <div key={trip.trip_id} className="glass-panel p-3.5 rounded-xl border border-slate-800 flex justify-between items-center">
                  <div>
                    <h4 className="text-xs font-bold text-white">Trip Log</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5">{trip.waypoints.length} stops</p>
                  </div>
                  <button onClick={() => handleLoadSavedTrip(trip)} className="bg-indigo-500/20 text-indigo-400 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase">Load</button>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Sticky footer for Save Trip (Mobile only, when expanded) */}
        {isSheetExpanded && planResult && (
          <div className="p-4 bg-slate-950 border-t border-slate-900 space-y-2 shrink-0">
            <button
              onClick={handleSaveTrip}
              disabled={savingTrip}
              className="w-full bg-slate-800/40 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 hover:bg-slate-800/70 border border-slate-800 transition-colors uppercase text-xs cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              <span>{savingTrip ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Trip Configuration'}</span>
            </button>
          </div>
        )}
      </div>

    </div>
  );
};
