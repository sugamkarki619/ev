import { useState, useEffect, useRef } from 'react';

// --- GEOSPATIAL MATH HELPERS ---

/**
 * Decode Valhalla's polyline6 format
 */
export function decodePolyline6(str: string): [number, number][] {
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

/**
 * Calculates bearing between two coordinates in degrees (0-360)
 */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Interpolates two angles along the shortest path
 */
export function interpolateAngle(current: number, target: number, factor: number): number {
  let diff = ((target - current + 180) % 360) - 180;
  if (diff < -180) diff += 360;
  return (current + diff * factor + 360) % 360;
}

/**
 * Calculates straight line distance in meters using Haversine formula
 */
export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Projects point C onto line segment AB.
 * Returns the projected point and parameter t (clamped between 0 and 1).
 */
function projectPointToSegment(
  latC: number,
  lonC: number,
  latA: number,
  lonA: number,
  latB: number,
  lonB: number
): { lat: number; lon: number; t: number } {
  const dx = lonB - lonA;
  const dy = latB - latA;
  if (dx === 0 && dy === 0) {
    return { lat: latA, lon: lonA, t: 0 };
  }

  let t = ((lonC - lonA) * dx + (latC - latA) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t)); // clamp projection to segment

  return {
    lat: latA + t * dy,
    lon: lonA + t * dx,
    t,
  };
}

/**
 * Snaps a coordinate to the closest point on the route polyline
 */
export function snapToRoute(
  lat: number,
  lon: number,
  routeCoords: [number, number][]
): {
  snappedLat: number;
  snappedLon: number;
  distanceMeters: number;
  segmentIndex: number;
} | null {
  if (routeCoords.length < 2) return null;

  let minDistance = Infinity;
  let bestPoint = { lat, lon };
  let bestSegmentIdx = 0;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const ptA = routeCoords[i];
    const ptB = routeCoords[i + 1];

    const proj = projectPointToSegment(lat, lon, ptA[0], ptA[1], ptB[0], ptB[1]);
    const dist = getDistanceMeters(lat, lon, proj.lat, proj.lon);

    if (dist < minDistance) {
      minDistance = dist;
      bestPoint = { lat: proj.lat, lon: proj.lon };
      bestSegmentIdx = i;
    }
  }

  return {
    snappedLat: bestPoint.lat,
    snappedLon: bestPoint.lon,
    distanceMeters: minDistance,
    segmentIndex: bestSegmentIdx,
  };
}

// --- MAIN HOOK INTERFACE ---

interface SmoothGPSProps {
  routeCoords: [number, number][];
  isActive: boolean;
  simulatedSpeedKmh?: number;
}

export function useSmoothGPS({
  routeCoords,
  isActive,
  simulatedSpeedKmh = 50,
}: SmoothGPSProps) {
  const [isSimulating, setIsSimulating] = useState<boolean>(false); // Start in real-world mode by default
  const [isCentered, setIsCentered] = useState<boolean>(true);

  // Output States
  const [coords, setCoords] = useState<[number, number]>(
    routeCoords.length > 0 ? [routeCoords[0][0], routeCoords[0][1]] : [47.1415, 9.5215]
  );
  const [rerouteTrigger, setRerouteTrigger] = useState<number>(0);
  const [bearing, setBearing] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(0);
  const [offRoute, setOffRoute] = useState<boolean>(false);
  const offRouteTimerRef = useRef<number | null>(null);
  const [distanceRemainingMeters, setDistanceRemainingMeters] = useState<number>(0);
  const [nextManeuverIndex, setNextManeuverIndex] = useState<number>(0);

  // New Output States
  const [locationError, setLocationError] = useState<string | null>(null);
  const [bearingSource, setBearingSource] = useState<'compass' | 'gps' | 'route' | 'none'>('none');
  const [compassPermission, setCompassPermission] = useState<'granted' | 'denied' | 'prompt' | null>(null);
  const [isCompassActive, setIsCompassActive] = useState<boolean>(false);

  // References for Animation & Smoothing Loop
  const currentPosRef = useRef<[number, number]>(
    routeCoords.length > 0 ? [routeCoords[0][0], routeCoords[0][1]] : [47.1415, 9.5215]
  );
  const currentBearingRef = useRef<number>(0);
  
  const targetPosRef = useRef<[number, number]>(
    routeCoords.length > 0 ? [routeCoords[0][0], routeCoords[0][1]] : [47.1415, 9.5215]
  );
  const targetBearingRef = useRef<number>(0);
  const targetSpeedRef = useRef<number>(0);
  const targetAccuracyRef = useRef<number>(0);

  // Compass, Raw GPS Heading, and Snapped Route Segment Bearing References
  const compassHeadingRef = useRef<number | null>(null);
  const rawHeadingRef = useRef<number | null>(null);
  const routeSegmentBearingRef = useRef<number>(0);

  // Simulation Progress variables
  const simProgressMetersRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const routeDistancesRef = useRef<number[]>([]); // cumulative distances at each polyline node
  const totalRouteDistanceRef = useRef<number>(0);

  // Geolocation Watch ID
  const watchIdRef = useRef<number | null>(null);

  // Check compass permissions (primarily for iOS devices)
  useEffect(() => {
    // @ts-ignore
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      setCompassPermission('prompt');
    } else {
      setCompassPermission('granted'); // Auto-granted or not restricted on other platforms
    }
  }, []);

  const requestCompassPermission = async (): Promise<boolean> => {
    // @ts-ignore
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        // @ts-ignore
        const result = await DeviceOrientationEvent.requestPermission();
        setCompassPermission(result);
        return result === 'granted';
      } catch (err) {
        console.error("Failed to request compass permission:", err);
        setCompassPermission('denied');
        return false;
      }
    }
    return true;
  };

  // Listen to Device Orientation events to determine physical facing direction
  useEffect(() => {
    if (!isActive || isSimulating || compassPermission !== 'granted') {
      setIsCompassActive(false);
      compassHeadingRef.current = null;
      return;
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      let heading: number | null = null;

      // iOS specific webkitCompassHeading
      // @ts-ignore
      if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        // @ts-ignore
        heading = event.webkitCompassHeading;
      } else if (event.alpha !== null) {
        // Android / Chrome: alpha is 0 to 360 relative or absolute depending on event.absolute.
        // We use it as degrees from North (360 - alpha) % 360.
        heading = (360 - event.alpha) % 360;
      }

      if (heading !== null && !isNaN(heading)) {
        setIsCompassActive(true);
        compassHeadingRef.current = heading;
      } else {
        setIsCompassActive(false);
        compassHeadingRef.current = null;
      }
    };

    const win = window as any;
    if ('ondeviceorientationabsolute' in win) {
      win.addEventListener('deviceorientationabsolute', handleOrientation, true);
      return () => {
        win.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      };
    } else if ('ondeviceorientation' in win) {
      win.addEventListener('deviceorientation', handleOrientation, true);
      return () => {
        win.removeEventListener('deviceorientation', handleOrientation, true);
      };
    }
  }, [isActive, isSimulating, compassPermission]);

  // 1. Calculate cumulative distances along route polyline
  useEffect(() => {
    if (routeCoords.length < 2) {
      routeDistancesRef.current = [0];
      totalRouteDistanceRef.current = 0;
      setDistanceRemainingMeters(0);
      return;
    }

    const dists: number[] = [0];
    let total = 0;
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const d = getDistanceMeters(
        routeCoords[i][0],
        routeCoords[i][1],
        routeCoords[i + 1][0],
        routeCoords[i + 1][1]
      );
      total += d;
      dists.push(total);
    }
    routeDistancesRef.current = dists;
    totalRouteDistanceRef.current = total;
    setDistanceRemainingMeters(total);

    // Initialize position and target at beginning of route
    const initialCoords: [number, number] = [routeCoords[0][0], routeCoords[0][1]];
    currentPosRef.current = initialCoords;
    targetPosRef.current = initialCoords;
    setCoords(initialCoords);

    // Initial bearing pointing to second node
    if (routeCoords.length > 1) {
      const initialBearing = calculateBearing(
        routeCoords[0][0],
        routeCoords[0][1],
        routeCoords[1][0],
        routeCoords[1][1]
      );
      currentBearingRef.current = initialBearing;
      targetBearingRef.current = initialBearing;
      routeSegmentBearingRef.current = initialBearing;
      setBearing(initialBearing);
    }

    simProgressMetersRef.current = 0;
  }, [routeCoords]);

  // Helper: Get coordinate along route polyline at a given distance in meters
  const getRouteCoordinateAtDistance = (
    dist: number
  ): { coords: [number, number]; segmentIndex: number; segmentBearing: number } => {
    const dists = routeDistancesRef.current;
    if (dists.length < 2 || dist <= 0) {
      const segmentBearing = routeCoords.length > 1 
        ? calculateBearing(routeCoords[0][0], routeCoords[0][1], routeCoords[1][0], routeCoords[1][1])
        : 0;
      return { coords: [routeCoords[0][0], routeCoords[0][1]], segmentIndex: 0, segmentBearing };
    }

    const lastIdx = dists.length - 1;
    if (dist >= dists[lastIdx]) {
      const segmentBearing = calculateBearing(
        routeCoords[lastIdx - 1][0],
        routeCoords[lastIdx - 1][1],
        routeCoords[lastIdx][0],
        routeCoords[lastIdx][1]
      );
      return {
        coords: [routeCoords[lastIdx][0], routeCoords[lastIdx][1]],
        segmentIndex: lastIdx - 1,
        segmentBearing,
      };
    }

    // Binary search or linear scan for the segment
    let idx = 0;
    for (let i = 0; i < dists.length - 1; i++) {
      if (dist >= dists[i] && dist < dists[i + 1]) {
        idx = i;
        break;
      }
    }

    const dStart = dists[idx];
    const dEnd = dists[idx + 1];
    const segmentLength = dEnd - dStart;
    const t = segmentLength > 0 ? (dist - dStart) / segmentLength : 0;

    const ptA = routeCoords[idx];
    const ptB = routeCoords[idx + 1];

    const lat = ptA[0] + t * (ptB[0] - ptA[0]);
    const lon = ptA[1] + t * (ptB[1] - ptA[1]);

    const segmentBearing = calculateBearing(ptA[0], ptA[1], ptB[0], ptB[1]);

    return {
      coords: [lat, lon],
      segmentIndex: idx,
      segmentBearing,
    };
  };

  // 2. Geolocation Handling (Real Mode)
  useEffect(() => {
    if (!isActive || isSimulating) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setLocationError(null);
      return;
    }

    setLocationError(null);

    const handleSuccess = (pos: GeolocationPosition) => {
      const rawLat = pos.coords.latitude;
      const rawLon = pos.coords.longitude;
      const rawAccuracy = pos.coords.accuracy;
      const rawHeading = pos.coords.heading;
      const rawSpeed = pos.coords.speed; // meters per second

      // Clear any prior location error on successful read
      setLocationError(null);

      // Filter out low accuracy updates (greater than 60 meters)
      if (rawAccuracy > 60) {
        return;
      }

      targetAccuracyRef.current = rawAccuracy;
      setAccuracy(rawAccuracy);

      if (rawSpeed !== null) {
        targetSpeedRef.current = rawSpeed * 3.6; // convert m/s to km/h
      } else {
        targetSpeedRef.current = 0;
      }

      if (rawHeading !== null && rawHeading !== undefined && !isNaN(rawHeading)) {
        rawHeadingRef.current = rawHeading;
      } else {
        rawHeadingRef.current = null;
      }

      // Snapping to route logic
      if (routeCoords.length >= 2) {
        const snapResult = snapToRoute(rawLat, rawLon, routeCoords);
        if (snapResult) {
          const isOff = snapResult.distanceMeters > 40; // Off route threshold: 40m
          setOffRoute(isOff);

          // Handle Reroute Trigger (Persistent off-route for 6 seconds)
          if (isOff) {
            if (offRouteTimerRef.current === null) {
              offRouteTimerRef.current = window.setTimeout(() => {
                setRerouteTrigger(prev => prev + 1);
                offRouteTimerRef.current = null;
              }, 6000);
            }
          } else {
            if (offRouteTimerRef.current !== null) {
              clearTimeout(offRouteTimerRef.current);
              offRouteTimerRef.current = null;
            }
          }

          if (!isOff) {
            targetPosRef.current = [snapResult.snappedLat, snapResult.snappedLon];
            
            // Calculate bearing of the current segment for route fallback orientation
            const currentSegment = routeCoords[snapResult.segmentIndex];
            const nextSegment = routeCoords[snapResult.segmentIndex + 1];
            routeSegmentBearingRef.current = calculateBearing(
              currentSegment[0],
              currentSegment[1],
              nextSegment[0],
              nextSegment[1]
            );

            // Estimate distance remaining along snapped route
            const dists = routeDistancesRef.current;
            const snapDist = dists[snapResult.segmentIndex] + getDistanceMeters(
              routeCoords[snapResult.segmentIndex][0],
              routeCoords[snapResult.segmentIndex][1],
              snapResult.snappedLat,
              snapResult.snappedLon
            );
            const remaining = Math.max(totalRouteDistanceRef.current - snapDist, 0);
            setDistanceRemainingMeters(remaining);
            setNextManeuverIndex(snapResult.segmentIndex);
          } else {
            // Off route - don't snap
            targetPosRef.current = [rawLat, rawLon];
          }
        }
      } else {
        targetPosRef.current = [rawLat, rawLon];
      }
    };

    const handleError = (error: GeolocationPositionError) => {
      console.warn("Geolocation watchPosition error:", error.message);
      let message = "Unable to retrieve device location.";
      if (error.code === error.PERMISSION_DENIED) {
        message = "Location access was denied. Please enable location services and grant permission in your browser/device settings to use live navigation.";
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        message = "GPS position is unavailable. Please ensure your device has a GPS signal and location services are turned on.";
      } else if (error.code === error.TIMEOUT) {
        message = "Location request timed out. Trying to acquire GPS signal again...";
      }
      setLocationError(message);
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 1000,
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [isActive, isSimulating, routeCoords]);

  // 3. Animation Loop (Handles Lerping & Simulation progression)
  useEffect(() => {
    if (!isActive) return;

    let animFrameId: number;
    lastTimeRef.current = performance.now();

    const loop = (timestamp: number) => {
      const elapsedSeconds = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      // Safe guard against large frames (background tab, pauses, etc.)
      const frameDelta = Math.min(elapsedSeconds, 0.1);

      if (isSimulating && routeCoords.length >= 2) {
        // Progression along the simulation path
        const speedMps = (simulatedSpeedKmh * 1000) / 3600;
        simProgressMetersRef.current += speedMps * frameDelta;

        const totalDist = totalRouteDistanceRef.current;
        if (simProgressMetersRef.current >= totalDist) {
          simProgressMetersRef.current = totalDist;
          // Completed simulation
          targetSpeedRef.current = 0;
          setSpeed(0);
        } else {
          targetSpeedRef.current = simulatedSpeedKmh;
          setSpeed(simulatedSpeedKmh);
        }

        const simResult = getRouteCoordinateAtDistance(simProgressMetersRef.current);
        targetPosRef.current = simResult.coords;
        targetBearingRef.current = simResult.segmentBearing;
        setDistanceRemainingMeters(Math.max(totalDist - simProgressMetersRef.current, 0));
        setNextManeuverIndex(simResult.segmentIndex);
        setAccuracy(5.0); // simulated accuracy is excellent
        setOffRoute(false);
      }

      // LERP Factor (smoothness tuning)
      const lerpFactor = isSimulating ? 0.08 : 0.05;

      // Smooth Position Gliding
      const currLat = currentPosRef.current[0];
      const currLon = currentPosRef.current[1];
      const tarLat = targetPosRef.current[0];
      const tarLon = targetPosRef.current[1];

      const newLat = currLat + (tarLat - currLat) * lerpFactor;
      const newLon = currLon + (tarLon - currLon) * lerpFactor;
      
      currentPosRef.current = [newLat, newLon];
      setCoords([newLat, newLon]);

      // Choose bearing based on priority hierarchy
      let tarBearing = targetBearingRef.current;
      let source: 'compass' | 'gps' | 'route' | 'none' = 'none';

      if (isSimulating) {
        tarBearing = targetBearingRef.current;
        source = 'gps';
      } else {
        if (isCompassActive && compassHeadingRef.current !== null) {
          tarBearing = compassHeadingRef.current;
          source = 'compass';
        } else if (rawHeadingRef.current !== null) {
          tarBearing = rawHeadingRef.current;
          source = 'gps';
        } else if (routeCoords.length >= 2 && !offRoute) {
          tarBearing = routeSegmentBearingRef.current;
          source = 'route';
        } else {
          tarBearing = currentBearingRef.current;
          source = 'none';
        }
      }

      setBearingSource(source);
      targetBearingRef.current = tarBearing;

      // Smooth Bearing Rotation (using shortest path interpolation)
      const currBearing = currentBearingRef.current;
      const newBearing = interpolateAngle(currBearing, tarBearing, lerpFactor);
      currentBearingRef.current = newBearing;
      setBearing(newBearing);

      animFrameId = requestAnimationFrame(loop);
    };

    animFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [isActive, isSimulating, routeCoords, simulatedSpeedKmh, isCompassActive]);

  const recenter = () => {
    setIsCentered(true);
    // Align map camera target immediately with current smoothed coords
    targetPosRef.current = currentPosRef.current;
    targetBearingRef.current = currentBearingRef.current;
  };

  return {
    coords,
    bearing,
    speed,
    accuracy,
    offRoute,
    rerouteTrigger,
    distanceRemainingMeters,
    totalDistanceMeters: totalRouteDistanceRef.current,
    nextManeuverIndex,
    isSimulating,
    setIsSimulating,
    isCentered,
    setIsCentered,
    recenter,
    locationError,
    bearingSource,
    compassPermission,
    requestCompassPermission,
  };
}
