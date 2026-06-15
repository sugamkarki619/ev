import React, { useEffect, useState, useRef } from 'react';
import { apiClient } from '../api/client';
import { Car, Battery, Info, Plus, AlertTriangle } from 'lucide-react';

interface CatalogModel {
  model_id: string;
  brand: string;
  model_name: string;
  battery_capacity_kwh: number;
  base_drag_coefficient: number;
  supported_plugs: string[];
}

interface UserVehicle {
  user_vehicle_id: string;
  user_id: string;
  model_id: string;
  license_plate: string | null;
  current_battery_percent: number;
  battery_degradation_factor: number;
  custom_aerodynamic_rating: number | null;
  is_active: boolean;
  catalog_model: CatalogModel | null;
}

interface VehicleSelectorProps {
  onVehicleSelected: (vehicle: UserVehicle | null) => void;
}

export const VehicleSelector: React.FC<VehicleSelectorProps> = ({ onVehicleSelected }) => {
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [vehicles, setVehicles] = useState<UserVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Registration Form State
  const [registering, setRegistering] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [initialBattery, setInitialBattery] = useState(80);

  // Update Form State
  const [savingId, setSavingId] = useState<string | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vehiclesRef = useRef<UserVehicle[]>(vehicles);

  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const fetchCatalogAndVehicles = async () => {
    setLoading(true);
    try {
      const catalogRes = await apiClient.get('/vehicles/catalog');
      const vehiclesRes = await apiClient.get('/vehicles/me');
      setCatalog(catalogRes.data);
      setVehicles(vehiclesRes.data);
      
      // Notify parent of active vehicle
      const active = vehiclesRes.data.find((v: UserVehicle) => v.is_active);
      if (active) {
        onVehicleSelected(active);
      } else if (vehiclesRes.data.length > 0) {
        onVehicleSelected(vehiclesRes.data[0]);
      } else {
        onVehicleSelected(null);
      }
    } catch (err: any) {
      console.error(err);
      setError('Failed to fetch vehicle profile data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalogAndVehicles();
  }, []);

  const handleRegisterVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCatalogId) return;
    setLoading(true);
    try {
      await apiClient.post('/vehicles/me', {
        model_id: selectedCatalogId,
        license_plate: licensePlate || null,
        current_battery_percent: initialBattery,
        battery_degradation_factor: 1.0
      });
      setRegistering(false);
      setLicensePlate('');
      await fetchCatalogAndVehicles();
    } catch (err: any) {
      setError('Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleBatteryChange = (vehicleId: string, percent: number) => {
    // 1. Immediately update local state for smooth sliding
    const updatedList = vehiclesRef.current.map(v => 
      v.user_vehicle_id === vehicleId 
        ? { ...v, current_battery_percent: percent } 
        : v
    );
    setVehicles(updatedList);

    // 2. Debounce the backend PUT update and parent state notification
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      const latestVehicles = vehiclesRef.current;
      const vehicle = latestVehicles.find(v => v.user_vehicle_id === vehicleId);
      if (!vehicle) return;

      setSavingId(vehicleId);
      try {
        await apiClient.put(`/vehicles/me/${vehicleId}`, {
          current_battery_percent: percent,
          battery_degradation_factor: vehicle.battery_degradation_factor,
          custom_aerodynamic_rating: vehicle.custom_aerodynamic_rating,
          is_active: true
        });

        const syncedList = latestVehicles.map(v => 
          v.user_vehicle_id === vehicleId 
            ? { ...v, current_battery_percent: percent, is_active: true } 
            : { ...v, is_active: false }
        );
        setVehicles(syncedList);
        onVehicleSelected(syncedList.find(v => v.is_active) || null);
      } catch (err) {
        console.error(err);
      } finally {
        setSavingId(null);
      }
    }, 400);
  };

  const handleSelectActive = async (vehicleId: string) => {
    const vehicle = vehicles.find(v => v.user_vehicle_id === vehicleId);
    if (!vehicle) return;
    setSavingId(vehicleId);
    
    try {
      await apiClient.put(`/vehicles/me/${vehicleId}`, {
        current_battery_percent: vehicle.current_battery_percent,
        battery_degradation_factor: vehicle.battery_degradation_factor,
        custom_aerodynamic_rating: vehicle.custom_aerodynamic_rating,
        is_active: true
      });
      await fetchCatalogAndVehicles();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingId(null);
    }
  };

  if (loading && vehicles.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 text-center text-slate-500 animate-pulse text-sm">
        Retrieving electric vehicle profiles...
      </div>
    );
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Car className="w-5 h-5 text-indigo-400" />
          My EV Configuration
        </h2>
        {!registering && (
          <button
            onClick={() => setRegistering(true)}
            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Vehicle
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-xl flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {registering ? (
        <form onSubmit={handleRegisterVehicle} className="space-y-4 bg-slate-950/60 p-4 rounded-xl border border-slate-850">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Select Model</label>
            <select
              required
              value={selectedCatalogId}
              onChange={(e) => setSelectedCatalogId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="">-- Choose Catalog Model --</option>
              {catalog.map(cat => (
                <option key={cat.model_id} value={cat.model_id}>
                  {cat.brand} {cat.model_name} ({cat.battery_capacity_kwh} kWh)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">License Plate</label>
              <input
                type="text"
                placeholder="FL 2419"
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Battery SoC (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                required
                value={initialBattery}
                onChange={(e) => setInitialBattery(parseInt(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg py-2 px-3 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => setRegistering(false)}
              className="flex-1 py-2 bg-slate-905 border border-slate-800 hover:bg-slate-900 text-slate-300 rounded-lg text-xs font-bold transition-all cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-6 bg-slate-950/40 border border-dashed border-slate-800 rounded-xl">
          <Info className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-500">No vehicles registered yet. Add your vehicle to begin dynamic trip energy calculations.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {vehicles.map(vehicle => (
            <div
              key={vehicle.user_vehicle_id}
              className={`p-4 rounded-xl border transition-all ${
                vehicle.is_active 
                  ? 'bg-indigo-950/20 border-indigo-500/50 shadow-md' 
                  : 'bg-slate-950/40 border-slate-850 opacity-60 hover:opacity-90'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${vehicle.is_active ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Car className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                      {vehicle.catalog_model?.brand} {vehicle.catalog_model?.model_name}
                      {vehicle.license_plate && (
                        <span className="text-[9px] bg-slate-800 border border-slate-700 text-slate-400 px-1 rounded font-normal">
                          {vehicle.license_plate}
                        </span>
                      )}
                    </h3>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Drag Coeff: {vehicle.catalog_model?.base_drag_coefficient} | Max Cap: {vehicle.catalog_model?.battery_capacity_kwh} kWh
                    </p>
                  </div>
                </div>

                {!vehicle.is_active && (
                  <button
                    onClick={() => handleSelectActive(vehicle.user_vehicle_id)}
                    disabled={savingId !== null}
                    className="py-1 px-2.5 bg-slate-800 hover:bg-slate-750 text-[10px] font-bold text-slate-300 rounded-lg cursor-pointer transition-all"
                  >
                    Select
                  </button>
                )}
              </div>

              {/* Slider for Current Battery Percent */}
              {vehicle.is_active && (
                <div className="mt-4 pt-3 border-t border-indigo-950/40">
                  <div className="flex justify-between items-center text-xs mb-1.5">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Battery className="w-4 h-4 text-emerald-400" /> Battery SoC
                    </span>
                    <span className="font-bold text-emerald-400">{vehicle.current_battery_percent}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={vehicle.current_battery_percent}
                    onChange={(e) => handleBatteryChange(vehicle.user_vehicle_id, parseInt(e.target.value))}
                    className="battery-slider w-full cursor-pointer"
                  />
                  <div className="flex justify-between text-[8px] text-slate-500 mt-1 font-semibold">
                    <span>EMPTY</span>
                    <span>100% CHARGED</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
