import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import axios from 'axios';
import L from 'leaflet';
import { Compass, ShieldAlert, MapPin, Locate, Search, X } from 'lucide-react';
import { decodePolyline6 } from '../hooks/useSmoothGPS';

interface Station {
  station_id: string;
  name: string;
  type: string;
  address: string;
  lat: number;
  lon: number;
  distance_meters: number;
  environment_description: string | null;
  spots: any[];
  access_instructions: string | null;
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

interface NavigationMapProps {
  activeVehicle: UserVehicle | null;
  onStartNavigation?: (plan: any, routeCoords: [number, number][]) => void;
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

export const NavigationMap: React.FC<NavigationMapProps> = ({ activeVehicle, onStartNavigation }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const routeLineRef = useRef<L.Polyline | null>(null);

  // Coordinates State (Kathmandu Center: Thamel)
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number }>({ lat: 27.7150, lon: 85.3110 });
  const [stations, setStations] = useState<Station[]>([]);
  const [loadingStations, setLoadingStations] = useState(false);
  const [radius, setRadius] = useState<number>(10);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Routing points
  const [startPoint, setStartPoint] = useState<{ lat: number; lon: number } | null>({ lat: 27.7150, lon: 85.3110 });
  const [endPoint, setEndPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [settingPointMode, setSettingPointMode] = useState<'start' | 'end' | null>(null);

  // Persistent readable addresses for start & destination
  const [startAddress, setStartAddress] = useState('Thamel, Kathmandu');
  const [endAddress, setEndAddress] = useState('');

  // Search input & suggestion states for the active settingPointMode
  const [searchQueryLocation, setSearchQueryLocation] = useState('');
  const [suggestions, setSuggestions] = useState<OsmPlace[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const settingPointModeRef = useRef<'start' | 'end' | null>(null);
  useEffect(() => {
    settingPointModeRef.current = settingPointMode;
  }, [settingPointMode]);

  // Sync searchQueryLocation when settingPointMode changes
  useEffect(() => {
    if (settingPointMode === 'start') {
      setSearchQueryLocation(startAddress);
    } else if (settingPointMode === 'end') {
      setSearchQueryLocation(endAddress);
    }
    setSuggestions([]);
  }, [settingPointMode, startAddress, endAddress]);

  // Debounced search for OSM places
  useEffect(() => {
    if (!settingPointMode || !searchQueryLocation) {
      setSuggestions([]);
      return;
    }

    if (settingPointMode === 'start' && searchQueryLocation === startAddress) return;
    if (settingPointMode === 'end' && searchQueryLocation === endAddress) return;
    if (searchQueryLocation.match(/^[-+]?[0-9]*\.?[0-9]+,\s*[-+]?[0-9]*\.?[0-9]+$/)) return;

    const delayDebounceFn = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQueryLocation)}&limit=5`, {
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
  }, [searchQueryLocation, settingPointMode, startAddress, endAddress]);

  // Suggestion selection handler
  const handleSelectSuggestion = (place: OsmPlace) => {
    if (settingPointMode === 'start') {
      setStartPoint({ lat: place.lat, lon: place.lon });
      setStartAddress(place.name);
    } else if (settingPointMode === 'end') {
      setEndPoint({ lat: place.lat, lon: place.lon });
      setEndAddress(place.name);
    }

    if (mapRef.current) {
      mapRef.current.setView([place.lat, place.lon], 14);
    }

    setSuggestions([]);
    setSettingPointMode(null);
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
        if (settingPointMode === 'start') {
          setStartPoint({ lat: latitude, lon: longitude });
          const address = await reverseGeocode(latitude, longitude);
          setStartAddress(address);
        } else if (settingPointMode === 'end') {
          setEndPoint({ lat: latitude, lon: longitude });
          const address = await reverseGeocode(latitude, longitude);
          setEndAddress(address);
        }

        if (mapRef.current) {
          mapRef.current.setView([latitude, longitude], 14);
        }

        setSettingPointMode(null);
      },
      (error) => {
        console.error("Error fetching geolocation", error);
        alert("Failed to get current location. Please verify location permissions.");
      }
    );
  };

  // Routing calculations outcomes
  const [routeInstructions, setRouteInstructions] = useState<string[]>([]);
  const [routeSummary, setRouteSummary] = useState<{ distance_km: number; time_min: number } | null>(null);
  const [energyEstimate, setEnergyEstimate] = useState<{ energy_required_kwh: number; soc_arrival: number; ok: boolean; isDefaultVehicle?: boolean } | null>(null);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [calculatingRoute, setCalculatingRoute] = useState(false);
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([]);
  const [rawPolyline, setRawPolyline] = useState<string>('');

  // Sidebar current view state ('list' | 'route')
  const [sidebarState, setSidebarState] = useState<'list' | 'route'>('list');
  const [hoveredStationId, setHoveredStationId] = useState<string | null>(null);

  // Mobile Bottom Sheet expand state
  const [isSheetExpanded, setIsSheetExpanded] = useState<boolean>(false);
  const touchStartY = useRef<number | null>(null);
  const didDrag = useRef<boolean>(false);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Initialize map
    const map = L.map(mapContainerRef.current, {
      center: [mapCenter.lat, mapCenter.lon],
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

    // Map Click Handler for Setting Custom Points
    map.on('click', async (e) => {
      const { lat, lng } = e.latlng;
      const current = settingPointModeRef.current;
      if (current === 'start') {
        setStartPoint({ lat, lon: lng });
        setSettingPointMode(null);
        const address = await reverseGeocode(lat, lng);
        setStartAddress(address);
      } else if (current === 'end') {
        setEndPoint({ lat, lon: lng });
        setSettingPointMode(null);
        const address = await reverseGeocode(lat, lng);
        setEndAddress(address);
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Sync Markers
  const updateMapMarkers = () => {
    const map = mapRef.current;
    if (!map) return;

    // 1. Clear existing markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // 2. Plot Charging Stations (Rotated orange squares with bolt)
    stations.forEach(station => {
      const isHovered = hoveredStationId === station.station_id;
      const stationIcon = L.divIcon({
        className: 'custom-station-icon',
        html: `
          <div class="relative flex flex-col items-center transition-all duration-200 ${isHovered ? 'scale-125 z-[1000]' : ''}">
            <div class="bg-[#161416] border ${isHovered ? 'border-white shadow-[0_0_15px_rgba(255,255,255,0.6)]' : 'border-[#ea580c] shadow-[0_0_8px_rgba(234,88,12,0.4)]'} w-7 h-7 rotate-45 flex items-center justify-center transition-colors">
              <span class="material-symbols-outlined ${isHovered ? 'text-white' : 'text-[#ea580c]'} text-[14px] -rotate-45 transition-colors" style="font-variation-settings: 'FILL' 1;">bolt</span>
            </div>
            <div class="w-0.5 h-2 ${isHovered ? 'bg-white' : 'bg-[#ea580c]/50'} transition-colors"></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      });

      const m = L.marker([station.lat, station.lon], { icon: stationIcon })
        .addTo(map)
        .bindPopup(`
          <div class="text-slate-900 font-sans p-1">
            <h4 class="font-bold text-xs">${station.name}</h4>
            <p class="text-[10px] text-slate-500 mt-1">${station.address}</p>
            <p class="text-[10px] text-indigo-650 font-bold mt-1">${(station.distance_meters / 1000).toFixed(1)} km away</p>
            <button onclick="window.setRouteDestination(${station.lat}, ${station.lon})" class="mt-2 w-full py-1 bg-[#ea580c] hover:bg-[#c2410c] text-white text-[9px] font-bold uppercase rounded cursor-pointer text-center">Route To Hub</button>
          </div>
        `);
      markersRef.current.push(m);
    });

    // 3. Plot Start Point (if set)
    if (startPoint) {
      const startIcon = L.divIcon({
        className: 'start-point-icon',
        html: `
          <div class="relative flex flex-col items-center">
            <div class="bg-[#161416] text-[#10b981] font-sans font-bold text-xs px-2.5 py-1.5 rounded-xl border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.4)] flex items-center gap-1.5">
              <span>A</span>
            </div>
            <div class="w-0.5 h-2 bg-emerald-500"></div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
      });

      const m = L.marker([startPoint.lat, startPoint.lon], { icon: startIcon })
        .addTo(map);
      markersRef.current.push(m);
    }

    // 4. Plot Destination Point (if set)
    if (endPoint) {
      const destIcon = L.divIcon({
        className: 'dest-point-icon',
        html: `
          <div class="relative flex flex-col items-center">
            <div class="bg-[#161416] text-[#ef4444] font-sans font-bold text-xs px-2.5 py-1.5 rounded-xl border border-red-500/30 shadow-[0_0_12px_rgba(239,68,68,0.4)] flex items-center gap-1.5">
              <span>B</span>
            </div>
            <div class="w-0.5 h-2 bg-red-500"></div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 40]
      });

      const m = L.marker([endPoint.lat, endPoint.lon], { icon: destIcon })
        .addTo(map);
      markersRef.current.push(m);
    }
  };

  // Bind custom popup buttons to window context for Leaflet callbacks
  useEffect(() => {
    (window as any).setRouteDestination = (lat: number, lon: number) => {
      setEndPoint({ lat, lon });
      setSidebarState('route');
    };
    return () => {
      delete (window as any).setRouteDestination;
    };
  }, []);

  // Fetch stations nearby
  const fetchNearbyStations = async () => {
    setLoadingStations(true);
    try {
      const response = await apiClient.get('/stations/nearby', {
        params: {
          lat: mapCenter.lat,
          lon: mapCenter.lon,
          radius_km: radius
        }
      });
      setStations(response.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingStations(false);
    }
  };

  // Trigger stations search on center change or radius change
  useEffect(() => {
    fetchNearbyStations();
  }, [mapCenter, radius]);

  // Sync markers when stations list or points list change
  useEffect(() => {
    updateMapMarkers();
  }, [stations, startPoint, endPoint, hoveredStationId]);

  // Calculate Routing using local Valhalla docker routing container
  const calculateRoute = async () => {
    if (!startPoint || !endPoint) return;

    setCalculatingRoute(true);
    setRoutingError(null);

    if (routeLineRef.current) {
      routeLineRef.current.remove();
      routeLineRef.current = null;
    }

    try {
      const payload = {
        locations: [
          { lat: startPoint.lat, lon: startPoint.lon, type: "break" },
          { lat: endPoint.lat, lon: endPoint.lon, type: "break" }
        ],
        costing: "auto",
        directions_options: {
          units: "kilometers",
          language: "en-US"
        }
      };

      const valhallaUrl = import.meta.env.VITE_VALHALLA_URL || 'http://192.168.254.53:8002';
      const response = await axios.get(`${valhallaUrl}/route`, {
        params: {
          json: JSON.stringify(payload)
        }
      });

      const trip = response.data.trip;
      const leg = trip.legs[0];
      const distance = trip.summary.length;
      const timeSecs = trip.summary.time;

      setRouteSummary({
        distance_km: distance,
        time_min: Math.round(timeSecs / 60)
      });

      // Decode shape line geometry
      const coordinates = decodePolyline6(leg.shape);
      setRouteCoords(coordinates);
      setRawPolyline(leg.shape);

      // Plot polyline on leaflet map
      if (mapRef.current) {
        const line = L.polyline(coordinates, {
          color: '#ea580c',
          weight: 5,
          opacity: 0.9,
          className: 'marker-glow-primary'
        }).addTo(mapRef.current);

        routeLineRef.current = line;

        // Pan and fit map
        mapRef.current.fitBounds(line.getBounds(), { padding: [40, 40] });
      }

      // Map Turn-by-Turn Text Instructions
      const instructions = leg.maneuvers.map((m: any) => m.instruction);
      setRouteInstructions(instructions);

      // Estimate battery cost using vehicle physics formula
      const hasVehicleModel = !!(activeVehicle && activeVehicle.catalog_model);
      const capacity = hasVehicleModel ? activeVehicle.catalog_model!.battery_capacity_kwh : 60;
      const dragCoeff = hasVehicleModel ? activeVehicle.catalog_model!.base_drag_coefficient : 0.23;
      const degradation = activeVehicle ? activeVehicle.battery_degradation_factor : 1.0;
      const startSoC = activeVehicle ? activeVehicle.current_battery_percent : 80;

      const baseConsumptionFactor = 0.165; // ~165 Wh/km
      const dragPenalty = (dragCoeff - 0.23) * 0.5;
      const degradationPenalty = (1.0 - degradation) * 0.15;

      const energyRequired = distance * (baseConsumptionFactor + dragPenalty + degradationPenalty);
      const socConsumed = (energyRequired / capacity) * 100;
      const finalSoC = Math.round(startSoC - socConsumed);

      setEnergyEstimate({
        energy_required_kwh: parseFloat(energyRequired.toFixed(2)),
        soc_arrival: finalSoC,
        ok: finalSoC >= 15,
        isDefaultVehicle: !hasVehicleModel
      });

    } catch (err: any) {
      console.error(err);
      setRoutingError(
        err.response?.data?.error ||
        'Could not calculate route. Ensure start and destination are within the Kathmandu map tiles.'
      );
      setRouteSummary(null);
      setRouteInstructions([]);
      setEnergyEstimate(null);
      setRouteCoords([]);
      setRawPolyline('');
    } finally {
      setCalculatingRoute(false);
    }
  };

  useEffect(() => {
    if (startPoint && endPoint) {
      calculateRoute();
    }
  }, [startPoint, endPoint, activeVehicle]);

  const handleMapSearchArea = () => {
    if (mapRef.current) {
      const center = mapRef.current.getCenter();
      setMapCenter({ lat: center.lat, lon: center.lng });
    }
  };

  const handleSetStationAsDestination = (station: Station) => {
    setEndPoint({ lat: station.lat, lon: station.lon });
    setSidebarState('route');
  };

  const filteredStations = stations.filter(st => 
    st.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    st.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col md:flex-row-reverse h-full w-full bg-[#0C0B0C] overflow-hidden text-[#e7e1e3] relative">
      
      {/* Map Viewport Area */}
      <section className="flex-1 relative overflow-hidden h-full bg-[#0C0B0C] min-h-0 flex flex-col">
        <div className="absolute inset-0 z-0">
          <div ref={mapContainerRef} className="w-full h-full bg-[#0c0b0c]" />
          <div className="absolute inset-0 z-5 map-overlay pointer-events-none" />
        </div>

        {/* Unified Search Panel (Mobile & Desktop) */}
        {settingPointMode && (settingPointMode === 'start' || settingPointMode === 'end') && (
          <div className="absolute top-4 left-4 right-4 md:right-auto md:w-96 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-2xl flex flex-col gap-3 z-50 transition-all duration-300">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 className="text-xs font-bold text-[#f97316] uppercase tracking-wider font-mono">
                {settingPointMode === 'start' && 'Set Start Location'}
                {settingPointMode === 'end' && 'Set Destination'}
              </h3>
              <button 
                onClick={() => setSettingPointMode(null)}
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
                  value={searchQueryLocation}
                  onChange={(e) => setSearchQueryLocation(e.target.value)}
                  placeholder={
                    settingPointMode === 'start' ? 'Search start point...' : 'Search destination...'
                  }
                  className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-500 w-full"
                  autoFocus
                />
                {searchLoading && <div className="w-3.5 h-3.5 border-2 border-[#f97316] border-t-transparent rounded-full animate-spin shrink-0" />}
              </div>

              {/* Suggestions dropdown */}
              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl z-55 max-h-48 overflow-y-auto no-scrollbar">
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

        {/* Floating Search & Filter tags (Mobile only) */}
        <div className="md:hidden absolute top-4 left-0 right-0 px-4 z-30 flex flex-col gap-2.5">
          <div className="glass-panel flex items-center gap-3 px-4 h-12 rounded-xl shadow-xl">
            <span className="material-symbols-outlined text-slate-400">search</span>
            <input 
              type="text" 
              placeholder="Search charging hubs..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none focus:ring-0 text-xs font-semibold text-white w-full placeholder:text-slate-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar shrink-0">
            {[5, 10, 25].map(d => (
              <button 
                key={d} 
                onClick={() => setRadius(d)}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full border text-[10px] font-bold font-mono transition-all glass-panel ${
                  radius === d ? 'border-[#ffc640] text-[#ffc640]' : 'border-slate-800 text-slate-400'
                }`}
              >
                {d}km
              </button>
            ))}
            <button className="flex-shrink-0 px-3 py-1.5 rounded-full border border-slate-800 text-slate-400 glass-panel">
              <span className="material-symbols-outlined text-xs leading-none">tune</span>
            </button>
          </div>
        </div>

        {/* Floating Search Area Button (Mobile only) */}
        <div className="md:hidden absolute bottom-[270px] left-1/2 -translate-x-1/2 z-30">
          <button 
            onClick={handleMapSearchArea}
            className="bg-slate-900 border border-slate-800 text-[#e7e1e3] flex items-center gap-2 px-5 py-2.5 rounded-full shadow-2xl transition-transform active:scale-95"
          >
            <span className="material-symbols-outlined text-[#ea580c] text-sm font-bold">refresh</span>
            <span className="text-[10px] font-bold font-mono uppercase tracking-wider">Search Area</span>
          </button>
        </div>

        {/* Floating Start Navigation Button (Mobile only) */}
        {routeSummary && (
          <div 
            className="md:hidden absolute left-0 right-0 px-4 z-45 transition-all duration-300"
            style={{ bottom: isSheetExpanded ? 'calc(65vh + 20px)' : '230px' }}
          >
            <button 
              onClick={() => {
                if (onStartNavigation) {
                  const plan = {
                    polyline: rawPolyline,
                    distance_km: routeSummary.distance_km,
                    duration_mins: routeSummary.time_min,
                    start_soc: activeVehicle ? activeVehicle.current_battery_percent : 80,
                    end_soc: energyEstimate ? energyEstimate.soc_arrival : 80,
                    requires_charge: energyEstimate ? !energyEstimate.ok : false,
                    recommended_stop: null
                  };
                  onStartNavigation(plan, routeCoords);
                }
              }}
              className="w-full bg-indigo-600 text-white h-14 rounded-full flex items-center justify-center gap-3 shadow-[0_0_25px_rgba(234,88,12,0.5)] active:scale-95 transition-all border-2 border-indigo-400/20"
            >
              <Compass className="w-5 h-5 animate-pulse" />
              <span className="text-xs font-black uppercase tracking-widest">Start Live Navigation</span>
            </button>
          </div>
        )}

        {/* Floating Map Actions (Mobile & Desktop) */}
        <div className={`${isSheetExpanded ? 'hidden' : 'flex'} absolute ${routeSummary ? 'bottom-[362px]' : 'bottom-[285px]'} md:bottom-8 left-1/2 -translate-x-1/2 gap-2 md:gap-3 z-30 drop-shadow-2xl max-w-[95%] w-max transition-all duration-300`}>
          <button
            onClick={() => setSettingPointMode(settingPointMode === 'start' ? null : 'start')}
            className={`glass-panel px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-bold transition-all active:scale-95 text-white ${
              settingPointMode === 'start' ? 'bg-[#f97316]/80 border-[#ea580c] animate-pulse' : 'hover:bg-indigo-500/10'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-[#f97316]">location_on</span>
            <span>SET START</span>
          </button>
          <button
            onClick={() => setSettingPointMode(settingPointMode === 'end' ? null : 'end')}
            className={`glass-panel px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-bold transition-all active:scale-95 text-white ${
              settingPointMode === 'end' ? 'bg-[#f97316]/80 border-[#ea580c] animate-pulse' : 'hover:bg-indigo-500/10'
            }`}
          >
            <span className="material-symbols-outlined text-sm text-red-500">flag</span>
            <span>SET DESTINATION</span>
          </button>
          <button
            onClick={handleMapSearchArea}
            className="bg-indigo-600 text-white px-3.5 py-2 md:px-5 md:py-2.5 rounded-xl flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-bold shadow-xl hover:bg-indigo-500 transition-all active:scale-95 border border-indigo-500/30"
          >
            <span className="material-symbols-outlined text-sm">my_location</span>
            <span>SEARCH AREA</span>
          </button>
        </div>

        {/* Calculating Overlay */}
        {calculatingRoute && (
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm z-[1000] flex items-center justify-center">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center shadow-xl">
              <Compass className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-2" />
              <span className="text-xs font-bold">Querying Valhalla engine route...</span>
            </div>
          </div>
        )}

        {/* Routing Error alert */}
        {routingError && (
          <div className="absolute bottom-4 left-4 right-4 md:left-8 md:right-auto bg-rose-500/10 border border-rose-500/30 text-rose-450 text-xs font-semibold p-4 rounded-xl flex gap-2.5 items-start z-[1000] backdrop-blur-md max-w-md shadow-xl animate-fadeIn">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{routingError}</span>
          </div>
        )}
      </section>

      {/* Sidebar Pane (Desktop only, positioned on left) */}
      <aside className="hidden md:flex w-[360px] h-full flex-col bg-slate-900 border-r border-slate-800 z-40 overflow-hidden shrink-0">
        
        {/* Search header in sidebar */}
        <div className="p-4 border-b border-slate-800 space-y-4 shrink-0">
          <div className="flex bg-slate-950 rounded-xl p-1 border border-slate-800">
            <button
              onClick={() => setSidebarState('list')}
              className={`flex-grow py-2 text-[10px] font-bold tracking-widest rounded-lg transition-all cursor-pointer ${
                sidebarState === 'list' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Nearby
            </button>
            <button
              onClick={() => setSidebarState('route')}
              className={`flex-grow py-2 text-[10px] font-bold tracking-widest rounded-lg transition-all cursor-pointer ${
                sidebarState === 'route' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Route
            </button>
          </div>

          {sidebarState === 'list' && (
            <div className="flex gap-2 items-center">
              <div className="flex-1 bg-slate-950 rounded-lg px-3 py-2 flex items-center gap-2 border border-slate-800/80">
                <span className="material-symbols-outlined text-slate-500 text-sm">search</span>
                <input 
                  type="text" 
                  placeholder="Filter stations..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none text-xs font-semibold text-white focus:outline-none w-full placeholder:text-slate-500 focus:ring-0 p-0"
                />
              </div>
              <select
                value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value))}
                className="bg-slate-950 border border-slate-800 rounded-lg py-2 px-3 text-xs font-bold font-mono focus:outline-none cursor-pointer text-slate-350"
              >
                <option value="5">5km</option>
                <option value="10">10km</option>
                <option value="25">25km</option>
              </select>
            </div>
          )}
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          
          {/* List state */}
          {sidebarState === 'list' && (
            <div className="space-y-4">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recommended Stations</div>
              
              {loadingStations ? (
                <div className="py-8 text-center text-xs text-slate-500 animate-pulse">Scanning proximity indexes...</div>
              ) : filteredStations.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No stations found nearby.</div>
              ) : (
                filteredStations.map(station => (
                  <div
                    key={station.station_id}
                    onMouseEnter={() => setHoveredStationId(station.station_id)}
                    onMouseLeave={() => setHoveredStationId(null)}
                    className={`glass-panel p-4 rounded-xl space-y-3 transition-all cursor-pointer border-l-4 ${
                      hoveredStationId === station.station_id ? 'border-l-indigo-500 bg-indigo-500/5 border-orange-500/30' : 'border-l-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-sm font-bold text-white leading-tight">{station.name}</h3>
                        <p className="text-[10px] text-slate-400 mt-1">{station.address}</p>
                      </div>
                      <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border border-emerald-500/20">Available</span>
                    </div>

                    <div className="flex items-center gap-4 py-2 border-y border-slate-800/60 font-mono text-[10px]">
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-slate-400 text-sm">distance</span>
                        <span>{(station.distance_meters / 1000).toFixed(1)} km</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-slate-400 text-sm">bolt</span>
                        <span>50 kW</span>
                      </div>
                    </div>

                    <button 
                      onClick={() => handleSetStationAsDestination(station)}
                      className="w-full bg-indigo-500 hover:bg-[#c2410c] text-slate-950 font-bold py-2.5 rounded-lg text-xs uppercase tracking-wide transition-all active:scale-[0.98]"
                    >
                      Route To Hub
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Route state */}
          {sidebarState === 'route' && (
            <div className="space-y-6">
              
              {routeSummary ? (
                <div className="space-y-6">
                  {/* Trip details box */}
                  <div className="glass-panel p-5 rounded-xl space-y-4">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-sans">Distance</p>
                        <p className="text-xl font-bold text-indigo-500">{routeSummary.distance_km.toFixed(1)} <span className="text-xs font-normal text-slate-400">km</span></p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider font-sans">Arrival ETA</p>
                        <p className="text-xl font-bold text-white">{routeSummary.time_min} <span className="text-xs font-normal text-slate-400">mins</span></p>
                      </div>
                    </div>

                    {energyEstimate && (
                      <div className={`p-3 rounded-lg border ${
                        energyEstimate.ok ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30 animate-pulse'
                      }`}>
                        <div className="flex justify-between items-center mb-1 text-xs">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-350">
                            {energyEstimate.isDefaultVehicle ? 'Est. SoC at Arrival (Default EV)' : 'Estimated SoC at Arrival'}
                          </span>
                          <span className={`font-bold ${energyEstimate.ok ? 'text-emerald-400' : 'text-red-400'}`}>{energyEstimate.soc_arrival}%</span>
                        </div>
                        <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div 
                            className={`h-full ${energyEstimate.ok ? 'bg-emerald-500' : 'bg-red-500'}`} 
                            style={{ width: `${Math.max(energyEstimate.soc_arrival, 0)}%` }}
                          />
                        </div>
                        {!energyEstimate.ok && (
                          <p className="text-[9px] text-red-400 font-bold mt-2 leading-snug">
                            Warning: Battery predicted below threshold. Detouring to a charging station is recommended.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Directions steps */}
                  <div className="space-y-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Navigation Steps</div>
                    <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1 no-scrollbar text-xs">
                      {routeInstructions.map((inst, i) => (
                        <div key={i} className="flex gap-3 p-2 border-l-2 border-[#ea580c]/30">
                          <span className="material-symbols-outlined text-indigo-500 text-sm mt-0.5">straight</span>
                          <div className="space-y-0.5">
                            <p className="font-semibold text-white">{inst}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Desktop navigation trigger */}
                  <div className="space-y-3">
                    {onStartNavigation && (
                      <button
                        onClick={() => {
                          const plan = {
                            polyline: rawPolyline,
                            distance_km: routeSummary.distance_km,
                            duration_mins: routeSummary.time_min,
                            start_soc: activeVehicle ? activeVehicle.current_battery_percent : 80,
                            end_soc: energyEstimate ? energyEstimate.soc_arrival : 80,
                            requires_charge: energyEstimate ? !energyEstimate.ok : false,
                            recommended_stop: null
                          };
                          onStartNavigation(plan, routeCoords);
                        }}
                        className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-xs uppercase tracking-widest flex justify-center items-center gap-2 shadow-xl hover:bg-indigo-500 transition-all active:scale-[0.98] cursor-pointer"
                      >
                        <Compass className="w-4 h-4" />
                        <span>Start Live Navigation</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEndPoint(null);
                        setRouteSummary(null);
                        setRouteInstructions([]);
                        setEnergyEstimate(null);
                        setRouteCoords([]);
                        setRawPolyline('');
                        setSidebarState('list');
                      }}
                      className="w-full bg-slate-800/40 text-slate-350 hover:text-white border border-slate-800 font-bold text-xs uppercase py-2.5 rounded-xl transition-colors cursor-pointer"
                    >
                      Clear Route
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-500">
                  Select a destination station or click the map to plan a route.
                </div>
              )}
            </div>
          )}

        </div>
      </aside>

      {/* Expandable Bottom Sheet (Mobile only) */}
      <div 
        className="md:hidden absolute bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 rounded-t-[2rem] z-40 flex flex-col transition-all duration-350 shadow-2xl pb-20"
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

        <div className="px-4 flex-1 flex flex-col min-h-0">
          {routeSummary ? (
            /* Route Active Details on Mobile */
            <div className="flex-grow flex flex-col min-h-0">
              <div className="flex items-center justify-between pb-3 shrink-0">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Route Active</h2>
                <span className="text-[10px] font-mono text-[#ea580c] uppercase font-bold">OSM Valhalla</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-4 pb-6 no-scrollbar">
                {/* Trip stats card */}
                <div className="glass-panel p-4 rounded-xl space-y-3 border border-slate-800">
                  <div className="grid grid-cols-2 gap-2 text-xs text-center">
                    <div className="bg-slate-950/60 p-2 rounded-lg">
                      <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider font-mono">Distance</div>
                      <div className="font-bold text-white mt-0.5">{routeSummary.distance_km.toFixed(1)} km</div>
                    </div>
                    <div className="bg-slate-950/60 p-2 rounded-lg">
                      <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider font-mono">ETA Time</div>
                      <div className="font-bold text-white mt-0.5">{routeSummary.time_min} mins</div>
                    </div>
                  </div>

                  {energyEstimate && (
                    <div className={`p-2.5 rounded-lg border text-xs ${
                      energyEstimate.ok ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30 animate-pulse'
                    }`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                          {energyEstimate.isDefaultVehicle ? 'Est. SoC at Arrival (Default EV)' : 'Est. SoC at Arrival'}
                        </span>
                        <span className={`font-bold ${energyEstimate.ok ? 'text-emerald-400' : 'text-red-400'}`}>{energyEstimate.soc_arrival}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                        <div 
                          className={`h-full ${energyEstimate.ok ? 'bg-emerald-500' : 'bg-red-500'}`} 
                          style={{ width: `${Math.max(energyEstimate.soc_arrival, 0)}%` }}
                        />
                      </div>
                      {!energyEstimate.ok && (
                        <p className="text-[9px] text-red-400 font-bold mt-1.5 leading-snug">
                          Warning: Battery predicted below threshold.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Directions list */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Directions list</span>
                  <div className="space-y-2 text-xs">
                    {routeInstructions.map((inst, i) => (
                      <div key={i} className="flex gap-2.5 p-2 bg-slate-950/30 rounded-lg border border-slate-900 items-start">
                        <span className="material-symbols-outlined text-indigo-500 text-sm shrink-0">straight</span>
                        <span className="text-slate-355">{inst}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Clear route button */}
                <button
                  onClick={() => {
                    setEndPoint(null);
                    setRouteSummary(null);
                    setRouteInstructions([]);
                    setEnergyEstimate(null);
                    setRouteCoords([]);
                    setRawPolyline('');
                    setSidebarState('list');
                  }}
                  className="w-full bg-slate-800/40 text-slate-350 hover:text-white border border-slate-800 font-bold text-xs uppercase py-2.5 rounded-xl transition-colors cursor-pointer"
                >
                  Clear Route
                </button>
              </div>
            </div>
          ) : (
            /* Proximity Scan list on Mobile */
            <div className="flex-grow flex flex-col min-h-0">
              <div className="flex items-center justify-between pb-3 shrink-0">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Proximity Scan</h2>
                <span className="text-[10px] font-mono text-slate-400">{filteredStations.length} Hubs Found</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pb-6 no-scrollbar animate-fadeIn">
                {loadingStations ? (
                  <p className="text-center text-xs text-slate-500 py-6 animate-pulse">Scanning nearby chargers...</p>
                ) : filteredStations.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-6">No stations in range.</p>
                ) : (
                  filteredStations.map(station => (
                    <div key={station.station_id} className="glass-panel p-4 rounded-xl flex justify-between items-center border border-slate-800">
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold text-white truncate">{station.name}</h3>
                        <div className="flex items-center gap-2 mt-1 text-[9px] font-mono">
                          <span className="text-emerald-500 uppercase font-bold">Available</span>
                          <span className="w-1 h-1 bg-slate-500 rounded-full" />
                          <span className="text-slate-400">{(station.distance_meters / 1000).toFixed(1)}km • 50kW</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleSetStationAsDestination(station)}
                        className="bg-indigo-500 text-slate-950 px-4.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider font-mono shrink-0 active:scale-95"
                      >
                        Route To
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
