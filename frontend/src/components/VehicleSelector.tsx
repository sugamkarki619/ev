import React, { useEffect, useState, useRef } from 'react';
import { apiClient } from '../api/client';
import { Car, Battery, Plus, AlertTriangle } from 'lucide-react';

export interface CatalogModel {
  model_id: string;
  brand: string;
  model_name: string;
  vehicle_type: string;
  battery_capacity_kwh: number;
  base_drag_coefficient: number;
  supported_plugs: string[];
}

export interface UserVehicle {
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
    <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-8 shadow-xl text-white">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.3em] flex items-center gap-2 mb-1">
            <Car className="w-4 h-4" />
            Vehicle Fleet
          </h2>
          <p className="text-slate-400 text-xs font-medium">Manage your active electric vehicles</p>
        </div>
        {!registering && (
          <button
            onClick={() => setRegistering(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-indigo-900/20 active:scale-95"
          >
            <Plus className="w-4 h-4" />
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
        <form onSubmit={handleRegisterVehicle} className="space-y-6 bg-slate-950/60 p-6 rounded-3xl border border-slate-850">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Select Model</label>
            <select
              required
              value={selectedCatalogId}
              onChange={(e) => setSelectedCatalogId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer transition-colors appearance-none"
            >
              <option value="">Choose Catalog Model</option>
              {catalog.map(cat => (
                <option key={cat.model_id} value={cat.model_id}>
                  {cat.brand} {cat.model_name} ({cat.battery_capacity_kwh} kWh)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">License Plate</label>
              <input
                type="text"
                placeholder="ABC-1234"
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2">Battery SoC (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                required
                value={initialBattery}
                onChange={(e) => setInitialBattery(parseInt(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black transition-all cursor-pointer active:scale-95"
            >
              Register Vehicle
            </button>
            <button
              type="button"
              onClick={() => setRegistering(false)}
              className="flex-1 py-3 bg-slate-800 border border-slate-700 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-black transition-all cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-12 bg-slate-950/40 border-2 border-dashed border-slate-800 rounded-3xl">
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-slate-800">
            <Car className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-sm text-slate-400 font-medium px-8">No vehicles registered yet. Add your vehicle to begin dynamic trip energy calculations.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vehicles.map(vehicle => (
            <div
              key={vehicle.user_vehicle_id}
              className={`p-6 rounded-3xl border transition-all relative overflow-hidden group ${
                vehicle.is_active 
                  ? 'bg-gradient-to-br from-indigo-950/30 to-slate-900/50 border-indigo-500/40 shadow-xl ring-1 ring-indigo-500/20'
                  : 'bg-slate-950/40 border-slate-850 hover:bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between relative z-10">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl ${vehicle.is_active ? 'bg-indigo-500/20 text-indigo-400 shadow-inner shadow-indigo-500/10' : 'bg-slate-800 text-slate-500'}`}>
                    <Car className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-black text-white tracking-tight">
                        {vehicle.catalog_model?.model_name}
                      </h3>
                      {vehicle.is_active && (
                        <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                      )}
                    </div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      {vehicle.catalog_model?.brand}
                      {vehicle.license_plate && ` • ${vehicle.license_plate}`}
                    </p>
                  </div>
                </div>

                {!vehicle.is_active ? (
                  <button
                    onClick={() => handleSelectActive(vehicle.user_vehicle_id)}
                    disabled={savingId !== null}
                    className="py-1.5 px-4 bg-slate-800 hover:bg-indigo-600 text-[10px] font-black text-white rounded-xl cursor-pointer transition-all active:scale-95 shadow-lg border border-slate-700 hover:border-indigo-500"
                  >
                    ACTIVATE
                  </button>
                ) : (
                  <div className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[8px] font-black px-2 py-1 rounded-lg uppercase tracking-widest">
                    Primary
                  </div>
                )}
              </div>

              {/* Enhanced Slider for Current Battery Percent */}
              <div className={`mt-8 transition-all duration-500 ${vehicle.is_active ? 'opacity-100 translate-y-0' : 'opacity-30 pointer-events-none'}`}>
                <div className="flex justify-between items-end mb-3">
                  <div>
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Battery Level</div>
                    <div className="flex items-center gap-2">
                      <Battery className={`w-4 h-4 ${vehicle.current_battery_percent > 20 ? 'text-emerald-400' : 'text-rose-500'}`} />
                      <span className={`text-2xl font-black tracking-tighter ${vehicle.current_battery_percent > 20 ? 'text-white' : 'text-rose-500'}`}>
                        {vehicle.current_battery_percent}%
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Capacity</div>
                    <div className="text-sm font-black text-slate-300">{vehicle.catalog_model?.battery_capacity_kwh} <span className="text-[10px] text-slate-500">kWh</span></div>
                  </div>
                </div>

                <div className="relative group/slider">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={vehicle.current_battery_percent}
                    onChange={(e) => handleBatteryChange(vehicle.user_vehicle_id, parseInt(e.target.value))}
                    disabled={!vehicle.is_active}
                    className="battery-slider w-full cursor-pointer relative z-10"
                  />
                  {/* Progress track overlay for visual flair */}
                  <div
                    className="absolute top-[21px] left-0 h-1.5 bg-indigo-500 rounded-full pointer-events-none transition-all duration-300"
                    style={{ width: `${vehicle.current_battery_percent}%` }}
                  />
                </div>

                <div className="flex justify-between mt-3 px-1">
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Status</span>
                    <span className="text-[10px] font-bold text-slate-400">
                      {vehicle.current_battery_percent < 20 ? 'Critical' : vehicle.current_battery_percent < 50 ? 'Medium' : 'Optimal'}
                    </span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Degradation</span>
                    <span className="text-[10px] font-bold text-slate-400">{((1 - vehicle.battery_degradation_factor) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              {/* Subtle background decoration */}
              <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
