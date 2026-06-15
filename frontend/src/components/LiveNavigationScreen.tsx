import React, { useEffect, useRef, useState } from 'react';
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import { useSmoothGPS, calculateBearing, getDistanceMeters } from '../hooks/useSmoothGPS';
import {
  Navigation, Compass, AlertTriangle, Play, Pause,
  X, Map as MapIcon, Zap
} from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';

interface RecommendedStop {
  station_id: string;
  name: string;
  lat: number;
  lon: number;
  charge_needed_kwh: number;
  charge_time_mins: number;
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
}

interface LiveNavigationScreenProps {
  planResult: TripPlanResponse;
  routeCoords: [number, number][];
  onClose: () => void;
  activeVehicleName?: string;
}

// Map styles reference (No API keys needed)
const MAP_STYLES = {
  dark: {
    version: 8,
    sources: {
      'carto-dark-tiles': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap, © CartoDB'
      }
    },
    layers: [
      {
        id: 'carto-dark-layer',
        type: 'raster',
        source: 'carto-dark-tiles',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  } as any,
  voyager: {
    version: 8,
    sources: {
      'carto-voyager-tiles': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap, © CartoDB'
      }
    },
    layers: [
      {
        id: 'carto-voyager-layer',
        type: 'raster',
        source: 'carto-voyager-tiles',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  } as any,
  osm: {
    version: 8,
    sources: {
      'osm-raster-tiles': {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [
      {
        id: 'osm-raster-layer',
        type: 'raster',
        source: 'osm-raster-tiles',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  } as any
};

export const LiveNavigationScreen: React.FC<LiveNavigationScreenProps> = ({
  planResult,
  routeCoords,
  onClose,
  activeVehicleName = "Electric Vehicle"
}) => {
  const mapRef = useRef<MapRef>(null);

  // States
  const [mapStyleKey, setMapStyleKey] = useState<keyof typeof MAP_STYLES>('dark');
  const [simSpeed, setSimSpeed] = useState<number>(60); // km/h for simulation

  // 1. Initialize custom hook
  const {
    coords,
    bearing,
    speed,
    accuracy,
    offRoute,
    distanceRemainingMeters,
    totalDistanceMeters,
    nextManeuverIndex,
    isSimulating,
    setIsSimulating,
    isCentered,
    setIsCentered,
    recenter,
    locationError,
    bearingSource,
    compassPermission,
    requestCompassPermission
  } = useSmoothGPS({
    routeCoords,
    isActive: true,
    simulatedSpeedKmh: simSpeed
  });

  // 2. Automatically guide the camera viewport for 3D navigation perspective
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isCentered) return;

    map.easeTo({
      center: [coords[1], coords[0]], // [longitude, latitude]
      bearing: bearing,
      pitch: 55, // 3D Tilt perspective looking forward
      zoom: speed > 80 ? 15.5 : speed > 40 ? 16.5 : 17.2, // Dynamic zoom based on speed
      duration: 120,
      easing: (t) => t // Linear transition for ultra-smooth movement
    });
  }, [coords, bearing, speed, isCentered]);

  // 3. User manually moved map -> disable auto-centering
  const handleMapInteraction = () => {
    if (isCentered) {
      setIsCentered(false);
    }
  };

  // 4. Calculate dynamic HUD statistics
  const pctCompleted = totalDistanceMeters > 0
    ? ((totalDistanceMeters - distanceRemainingMeters) / totalDistanceMeters) * 100
    : 0;

  // Remaining duration simulation
  const progressRatio = totalDistanceMeters > 0 ? distanceRemainingMeters / totalDistanceMeters : 0;
  const remDurationMins = Math.round(planResult.duration_mins * progressRatio);

  // Remaining SoC decay simulation
  const socDiff = planResult.start_soc - planResult.end_soc;
  const currentEstSoC = Math.max(
    Math.round(planResult.start_soc - socDiff * (1 - progressRatio)),
    0
  );

  // Next maneuvers text generator
  const getNextManeuverText = () => {
    if (distanceRemainingMeters < 50) {
      return "Arrive at Destination";
    }

    if (planResult.recommended_stop) {
      const distToCharge = getDistanceMeters(
        coords[0], coords[1],
        planResult.recommended_stop.lat, planResult.recommended_stop.lon
      );
      if (distToCharge > 0 && distToCharge < 350) {
        return `In ${Math.round(distToCharge)}m, pull over to charge at ${planResult.recommended_stop.name}`;
      }
    }

    if (routeCoords.length > nextManeuverIndex + 2) {
      const ptA = routeCoords[nextManeuverIndex];
      const ptB = routeCoords[nextManeuverIndex + 1];
      const ptC = routeCoords[nextManeuverIndex + 2];

      const brng1 = calculateBearing(ptA[0], ptA[1], ptB[0], ptB[1]);
      const brng2 = calculateBearing(ptB[0], ptB[1], ptC[0], ptC[1]);

      let diff = brng2 - brng1;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;

      const formatDist = (d: number) => {
        return d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
      };

      // Find distance from current location to that next turn node
      const distToTurn = getDistanceMeters(coords[0], coords[1], ptB[0], ptB[1]);

      if (diff > 25) {
        return `In ${formatDist(distToTurn)}, Turn Right`;
      } else if (diff < -25) {
        return `In ${formatDist(distToTurn)}, Turn Left`;
      }
    }

    const distLeft = distanceRemainingMeters;
    return `Continue on route for ${distLeft > 1000 ? `${(distLeft / 1000).toFixed(1)} km` : `${Math.round(distLeft)} m`}`;
  };

  // ETA Calculation
  const getETAString = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + remDurationMins);
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // GeoJSON data wrapper for vector rendering
  const routeGeoJSON: any = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: routeCoords.map((c) => [c[1], c[0]]), // convert [lat, lon] to [lon, lat]
    },
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col font-sans overflow-hidden select-none">

      {/* Geolocation Compulsory Block Screen */}
      {!isSimulating && locationError && (
        <div className="absolute inset-0 z-[10000] bg-slate-950 flex flex-col items-center justify-center p-6 text-center animate-fadeIn">
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-450 rounded-2xl mb-6 flex items-center justify-center animate-pulse">
            <AlertTriangle className="w-12 h-12" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">Location Required</h2>
          <p className="text-slate-400 text-sm max-w-md mb-8 leading-relaxed">
            {locationError}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-slate-900 hover:bg-slate-850 text-slate-350 font-bold rounded-xl border border-slate-800 transition-all cursor-pointer text-xs uppercase tracking-wider"
            >
              Exit
            </button>
            <button
              onClick={() => setIsSimulating(true)}
              className="flex-1 py-3 bg-indigo-650 hover:bg-indigo-600 text-white font-bold rounded-xl shadow-lg transition-all cursor-pointer text-xs uppercase tracking-wider"
            >
              Try Simulator
            </button>
          </div>
        </div>
      )}

      {/* 1. TOP BAR - MANEUVER OVERLAY */}
      <div className="absolute top-4 left-4 right-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-4 flex items-center gap-4 shadow-2xl max-w-xl mx-auto transition-all animate-fadeIn">
        <div className="p-3 bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 rounded-xl flex items-center justify-center shrink-0">
          <Navigation className="w-8 h-8 rotate-45 transform" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Next Direction</div>
          <div className="text-sm md:text-base font-extrabold text-white leading-snug truncate">
            {getNextManeuverText()}
          </div>
        </div>
        {offRoute && (
          <div className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black rounded-lg uppercase tracking-wide flex items-center gap-1 animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5" /> Off Route
          </div>
        )}
      </div>

      {/* 2. MAP VIEWPORT CANVAS */}
      <div className="flex-1 relative w-full h-full">
        <Map
          ref={mapRef}
          initialViewState={{
            latitude: routeCoords.length > 0 ? routeCoords[0][0] : 47.1415,
            longitude: routeCoords.length > 0 ? routeCoords[0][1] : 9.5215,
            zoom: 17,
            pitch: 55,
            bearing: 0
          }}
          mapStyle={MAP_STYLES[mapStyleKey]}
          onDragStart={handleMapInteraction}
          onZoomStart={handleMapInteraction}
          onRotateStart={handleMapInteraction}
          attributionControl={false}
        >
          {/* Navigation Route Line Layer */}
          {routeCoords.length > 0 && (
            <Source id="nav-route-source" type="geojson" data={routeGeoJSON}>
              {/* Outer Glow / Casing */}
              <Layer
                id="nav-route-glow"
                type="line"
                layout={{
                  'line-cap': 'round',
                  'line-join': 'round',
                }}
                paint={{
                  'line-color': '#7c2d12',
                  'line-width': 11,
                  'line-opacity': 0.35,
                }}
              />
              {/* Main Vector Path */}
              <Layer
                id="nav-route-line"
                type="line"
                layout={{
                  'line-cap': 'round',
                  'line-join': 'round',
                }}
                paint={{
                  'line-color': '#ea580c',
                  'line-width': 6.5,
                }}
              />
            </Source>
          )}

          {/* User Location Smoothed Arrow Indicator */}
          <Marker
            latitude={coords[0]}
            longitude={coords[1]}
            anchor="center"
            rotation={bearingSource === 'none' ? 0 : bearing}
            rotationAlignment="map"
          >
            {/* Custom Location Indicator with GPS aura pulse */}
            <div className="relative flex items-center justify-center w-12 h-12">
              <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-500/20 animate-ping opacity-75" />
              
              {bearingSource === 'none' ? (
                // Circular dot fallback when direction is not available
                <div className="w-6 h-6 bg-indigo-650 border-2 border-white rounded-full shadow-lg flex items-center justify-center text-white" />
              ) : (
                // Directional arrow with optional facing radar cone
                <div className="relative w-8 h-8 bg-indigo-650 border-2 border-white rounded-full shadow-lg flex items-center justify-center text-white">
                  {bearingSource === 'compass' && (
                    // Beautiful semi-transparent radar cone pointing forward (upward relative to marker rotation)
                    <div 
                      className="absolute bottom-1/2 left-1/2 -translate-x-1/2 w-16 h-16 pointer-events-none origin-bottom"
                      style={{
                        background: 'radial-gradient(circle at bottom, rgba(99, 102, 241, 0.4) 0%, rgba(99, 102, 241, 0) 70%)',
                        clipPath: 'polygon(50% 100%, 0 0, 100% 0)',
                        transform: 'translate(-50%, 0)',
                      }}
                    />
                  )}
                  <svg className="w-5 h-5 -rotate-45" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
                  </svg>
                </div>
              )}
            </div>
          </Marker>

          {/* Plot Charging Target Stop if one exists on path */}
          {planResult.recommended_stop && (
            <Marker
              latitude={planResult.recommended_stop.lat}
              longitude={planResult.recommended_stop.lon}
              anchor="bottom"
            >
              <div className="flex flex-col items-center group">
                <div className="bg-amber-500 text-slate-950 font-extrabold text-[9px] px-2 py-0.5 rounded shadow-lg border border-white uppercase mb-1 whitespace-nowrap">
                  Charge Stop
                </div>
                <div className="w-8 h-8 rounded-full bg-amber-500 border-2 border-white flex items-center justify-center text-slate-950 shadow-xl">
                  <Zap className="w-4 h-4 fill-current" />
                </div>
              </div>
            </Marker>
          )}
        </Map>

        {/* 3. FLOATING ACTION CONTROLS */}
        <div className="absolute right-4 top-24 z-20 flex flex-col gap-2">

          {/* Map style toggle */}
          <button
            onClick={() => setMapStyleKey(k => k === 'dark' ? 'voyager' : k === 'voyager' ? 'osm' : 'dark')}
            className="p-3 bg-slate-900/90 border border-slate-800 text-slate-350 hover:text-white rounded-xl shadow-lg backdrop-blur-md cursor-pointer transition-all hover:scale-105 active:scale-95"
            title="Toggle Map Skin"
          >
            <MapIcon className="w-5 h-5" />
          </button>

          {/* Compass Orientation Enable (iOS gesture requirements) */}
          {!isSimulating && compassPermission === 'prompt' && (
            <button
              onClick={requestCompassPermission}
              className="p-3 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white rounded-xl shadow-lg cursor-pointer transition-all hover:scale-105 active:scale-95 flex items-center justify-center animate-pulse"
              title="Enable Compass Direction"
            >
              <Compass className="w-5 h-5" />
            </button>
          )}

          {/* Simulation Play / Pause */}
          <button
            onClick={() => setIsSimulating(!isSimulating)}
            className={`p-3 border rounded-xl shadow-lg backdrop-blur-md cursor-pointer transition-all hover:scale-105 active:scale-95 flex items-center justify-center ${isSimulating
              ? 'bg-amber-600/10 border-amber-500/30 text-amber-400'
              : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white'
              }`}
            title={isSimulating ? "Pause Simulator" : "Start Simulator"}
          >
            {isSimulating ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>

          {/* Speed slider dialog for simulator */}
          {isSimulating && (
            <div className="p-2.5 bg-slate-900/90 border border-slate-800 text-xs text-slate-300 rounded-xl shadow-lg backdrop-blur-md flex flex-col gap-1.5 items-center w-28 animate-slideIn">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Sim Speed</span>
              <span className="font-extrabold text-white">{simSpeed} km/h</span>
              <input
                type="range"
                min="10"
                max="120"
                step="10"
                value={simSpeed}
                onChange={(e) => setSimSpeed(Number(e.target.value))}
                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          )}
        </div>

        {/* RECENTER BUTTON FAB */}
        {!isCentered && (
          <button
            onClick={recenter}
            className="absolute bottom-32 left-1/2 -translate-x-1/2 z-20 px-5 py-2.5 bg-indigo-650 hover:bg-indigo-600 text-white rounded-full font-black text-xs shadow-2xl shadow-indigo-500/35 hover:scale-105 active:scale-95 transition-all flex items-center gap-1.5 border border-indigo-450/25 cursor-pointer uppercase tracking-wider animate-bounce"
          >
            <Compass className="w-4 h-4 animate-spin-slow" />
            Recenter View
          </button>
        )}
      </div>

      {/* 4. BOTTOM BAR - NAVIGATION METRICS DASHBOARD */}
      <div className="bg-slate-900 border-t border-slate-800/80 px-6 py-5 shrink-0 relative z-20 shadow-[0_-8px_30px_rgb(0,0,0,0.45)]">

        {/* Route Progress indicator line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-slate-800">
          <div
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${pctCompleted}%` }}
          />
        </div>

        <div className="max-w-xl mx-auto flex flex-col gap-4">
          <div className="flex justify-between items-center">

            {/* Speed, Accuracy & Compass Status Panel */}
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-white tracking-tight leading-none">
                  {Math.round(speed)}
                </span>
                <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest">
                  KM/H
                </span>
              </div>
              {!isSimulating && (
                <div className="flex items-center gap-1.5 mt-0.5 text-[9px] font-bold tracking-wider text-slate-500 uppercase">
                  <span>GPS: ±{Math.round(accuracy)}m</span>
                  <span className="text-slate-700">•</span>
                  <span>
                    {bearingSource === 'compass' ? (
                      <span className="text-indigo-400 font-extrabold">Compass Active</span>
                    ) : bearingSource === 'gps' ? (
                      <span className="text-emerald-500 font-extrabold">GPS Heading</span>
                    ) : bearingSource === 'route' ? (
                      <span className="text-amber-500/80 font-bold">Route Lock</span>
                    ) : (
                      <span className="text-rose-500">No Direction</span>
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* General Trip stats */}
            <div className="flex gap-6 items-center">
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Duration</span>
                <span className="text-lg font-extrabold text-white">
                  {remDurationMins > 60
                    ? `${Math.floor(remDurationMins / 60)}h ${remDurationMins % 60}m`
                    : `${remDurationMins} mins`
                  }
                </span>
              </div>

              <div className="text-right border-l border-slate-800 pl-6">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Distance</span>
                <span className="text-lg font-extrabold text-white">
                  {(distanceRemainingMeters / 1000).toFixed(1)} km
                </span>
              </div>

              <div className="text-right border-l border-slate-800 pl-6">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">ETA</span>
                <span className="text-lg font-extrabold text-indigo-400">
                  {getETAString()}
                </span>
              </div>
            </div>
          </div>

          {/* Sub-Metrics Panel: EV SoC tracker */}
          <div className="flex items-center justify-between py-2 border-t border-slate-850 text-xs">
            <div className="flex items-center gap-2">
              <div className="text-slate-400 font-medium">Vehicle Profile:</div>
              <div className="bg-slate-950 border border-slate-850 px-2 py-0.5 rounded text-[10px] font-bold text-slate-300">
                {activeVehicleName}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-slate-400 font-medium">Est. Battery SoC:</span>
              <div className="flex items-center gap-1.5">
                <span className={`font-black ${currentEstSoC < 20 ? 'text-rose-400 animate-pulse' : currentEstSoC < 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {currentEstSoC}%
                </span>
                <div className="w-10 h-4 bg-slate-950 border border-slate-800 rounded p-0.5 flex">
                  <div
                    className={`h-full rounded-sm transition-all duration-500 ${currentEstSoC < 20 ? 'bg-rose-500' : currentEstSoC < 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${currentEstSoC}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ACTION ROW */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-2xl transition-all shadow-xl shadow-rose-950/20 active:scale-98 flex items-center justify-center gap-2 cursor-pointer uppercase text-xs tracking-wider"
            >
              <X className="w-4 h-4" />
              Exit Navigation
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
