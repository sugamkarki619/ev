import React, { useEffect, useState } from 'react';
import { HealthCheck } from './components/HealthCheck';
import { Auth } from './components/Auth';
import { VehicleSelector } from './components/VehicleSelector';
import type { UserVehicle } from './components/VehicleSelector';
import { NavigationMap } from './components/NavigationMap';
import { TripPlanner } from './components/TripPlanner';
import { LiveNavigationScreen } from './components/LiveNavigationScreen';
import { apiClient, handleLogout } from './api/client';
import { LogOut, User as UserIcon, Cpu, Layers, ShieldCheck, Mail, Save, ShieldAlert, Award, RefreshCw, Database, LayoutDashboard, MapPin, Compass, History, ArrowRight } from 'lucide-react';

interface User {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  role: string;
  is_kyc_verified: boolean;
}



interface SavedTrip {
  trip_id: string;
  user_vehicle_id: string;
  start_address: string;
  end_address: string;
  total_distance_km: number;
  total_duration_mins: number;
  estimated_arrival_time: string;
  created_at: string;
  waypoints: any[];
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    !!localStorage.getItem('access_token')
  );
  const [user, setUser] = useState<User | null>(null);
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [activeVehicle, setActiveVehicle] = useState<UserVehicle | null>(null);
  const [currentPage, setCurrentPage] = useState<'dashboard' | 'station-search' | 'trip-planner' | 'live-navigation'>('dashboard');
  const [activeNavPlan, setActiveNavPlan] = useState<any | null>(null);
  const [activeNavRouteCoords, setActiveNavRouteCoords] = useState<[number, number][]>([]);
  const [navigatedFromPage, setNavigatedFromPage] = useState<'station-search' | 'trip-planner'>('trip-planner');

  const [loadingUser, setLoadingUser] = useState(false);
  const [loadingTrips, setLoadingTrips] = useState(false);

  // Database Seeding State
  const [seeding, setSeeding] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);

  // Profile update form state
  const [editMode, setEditMode] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [updating, setUpdating] = useState(false);

  const fetchUserProfile = async () => {
    if (!isAuthenticated) return;
    setLoadingUser(true);
    try {
      const response = await apiClient.get('/users/me');
      setUser(response.data);
      setNewFirstName(response.data.first_name || '');
      setNewLastName(response.data.last_name || '');
      setNewEmail(response.data.email || '');
      setNewPhone(response.data.phone_number || '');
    } catch (err) {
      console.error("Failed to load user profile", err);
      setIsAuthenticated(false);
    } finally {
      setLoadingUser(false);
    }
  };


  const fetchSavedTrips = async () => {
    if (!isAuthenticated) return;
    setLoadingTrips(true);
    try {
      const response = await apiClient.get('/trips');
      setSavedTrips(response.data);
    } catch (err) {
      console.error("Failed to load saved trips", err);
    } finally {
      setLoadingTrips(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    setUpdateError(null);
    setUpdateSuccess(false);
    try {
      const response = await apiClient.put('/users/me', {
        first_name: newFirstName,
        last_name: newLastName,
        email: newEmail,
        phone_number: newPhone || null
      });
      setUser(response.data);
      setUpdateSuccess(true);
      setEditMode(false);
    } catch (err: any) {
      setUpdateError(err.response?.data?.detail || "Failed to update profile.");
    } finally {
      setUpdating(false);
    }
  };

  const handleRunSeeding = async () => {
    if (!window.confirm("Are you sure you want to seed demo data? This will overwrite or supplement existing database records.")) {
      return;
    }
    setSeeding(true);
    setSeedStatus(null);
    try {
      const response = await apiClient.post('/seed/run');
      setSeedStatus(response.data.message);
      // Reload states
      await fetchUserProfile();
    } catch (err: any) {
      setSeedStatus("Seeding failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchUserProfile();
      fetchSavedTrips();
    } else {
      setUser(null);
      setActiveVehicle(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const handleAuthLogout = () => {
      setIsAuthenticated(false);
      setUser(null);
      setActiveVehicle(null);
    };
    window.addEventListener('auth_logout', handleAuthLogout);
    return () => window.removeEventListener('auth_logout', handleAuthLogout);
  }, []);

  const logout = () => {
    handleLogout();
    setIsAuthenticated(false);
    setUser(null);
    setActiveVehicle(null);
  };

  const formatRole = (roleStr: string) => {
    switch (roleStr) {
      case 'ev_owner': return 'EV Owner';
      case 'home_station_owner': return 'Home Station Partner';
      case 'restaurant_owner': return 'Restaurant Partner';
      case 'admin': return 'Administrator';
      default: return roleStr;
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Animated Background Gradients */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none" />

        {/* Logo and Intro Header */}
        <div className="text-center mb-8 max-w-lg">
          <div className="inline-flex p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-400 mb-4 items-center justify-center">
            <Layers className="w-10 h-10" />
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-3">
            OctoWaffle <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Boilerplate</span>
          </h1>
          <p className="text-slate-400 text-base">
            Enterprise stack scaffold featuring FastAPI, React, TypeScript, Tailwind, PostgreSQL, and multi-stage container orchestration.
          </p>
        </div>

        <Auth onAuthSuccess={() => setIsAuthenticated(true)} />
      </div>
    );
  }

  if (currentPage === 'live-navigation' && activeNavPlan) {
    return (
      <LiveNavigationScreen
        planResult={activeNavPlan}
        routeCoords={activeNavRouteCoords}
        onClose={() => setCurrentPage(navigatedFromPage)}
        activeVehicleName={
          activeVehicle
            ? `${activeVehicle.catalog_model?.brand} ${activeVehicle.catalog_model?.model_name}`
            : undefined
        }
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans h-screen overflow-hidden">
      {/* Header Navigation */}
      <header className={`border-b border-slate-900/50 bg-slate-950/60 backdrop-blur-xl sticky top-0 z-50 px-8 py-4 flex items-center justify-between h-20 shrink-0 ${
        currentPage !== 'dashboard' ? 'hidden md:flex' : 'flex'
      }`}>
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-500 flex items-center justify-center shadow-inner">
            <span className="material-symbols-outlined text-indigo-500 font-black text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>electric_car</span>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-2xl font-black text-white leading-none m-0 tracking-tighter">
              Volt<span className="text-indigo-500">Route</span>
            </h1>
            <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em]">Intelligence</span>
          </div>
        </div>

        {/* Desktop Navigation Links - More Spacing, Modern Look */}
        <nav className="hidden md:flex items-center gap-2 bg-slate-900/30 border border-slate-800/50 p-1.5 rounded-2xl shadow-inner">
          <button
            onClick={() => setCurrentPage('dashboard')}
            className={`px-5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 tracking-tight ${currentPage === 'dashboard'
                ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-900/20'
                : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => setCurrentPage('station-search')}
            className={`px-5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 tracking-tight ${currentPage === 'station-search'
                ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-900/20'
                : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
          >
            <MapPin className="w-4 h-4" />
            Stations
          </button>
          <button
            onClick={() => setCurrentPage('trip-planner')}
            className={`px-5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-2 tracking-tight ${currentPage === 'trip-planner'
                ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-900/20'
                : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
          >
            <Compass className="w-4 h-4" />
            Planner
          </button>
        </nav>

        {user && (
          <div className="flex items-center gap-4">
            <div className="hidden lg:flex items-center gap-3 bg-slate-900/40 border border-slate-800/50 py-2 px-4 rounded-2xl text-xs transition-colors hover:border-slate-700">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white font-black text-[10px] shadow-lg">
                {user.first_name.charAt(0)}
              </div>
              <div>
                <div className="font-black text-slate-200 tracking-tight leading-none mb-0.5">
                  {user.first_name} {user.last_name}
                </div>
                <div className="text-[9px] font-black text-indigo-500 uppercase tracking-widest opacity-80">
                  {formatRole(user.role)}
                </div>
              </div>
            </div>

            <button
              onClick={logout}
              className="p-3 bg-slate-900 hover:bg-rose-950/30 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-900/50 rounded-2xl transition-all cursor-pointer active:scale-95 shadow-lg group"
            >
              <LogOut className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        )}
      </header>

      {/* Main Dashboard Layout */}
      <main className={
        currentPage === 'dashboard'
          ? "flex-1 w-full overflow-y-auto"
          : "flex-1 w-full max-w-none p-0 overflow-hidden relative flex flex-col min-h-0"
      }>
        {currentPage === 'dashboard' && (
          <div className="max-w-7xl w-full mx-auto p-6 pb-20 md:pb-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Left Column: Primary Focus - Vehicle & Wallet */}
            <div className="lg:col-span-2 space-y-6">

              {/* Enhanced Welcome Panel */}
              <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/30 border border-slate-800 rounded-3xl p-8 relative overflow-hidden shadow-2xl">
                <div className="absolute right-[-5%] top-[-10%] w-[40%] h-[120%] bg-indigo-500/10 blur-[100px] pointer-events-none rotate-12" />

                <div className="relative z-10">
                  <div className="flex justify-between items-start gap-6 flex-wrap">
                    <div className="max-w-xl">
                      <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight">
                        Hello, {user?.first_name || 'Driver'}
                      </h2>
                      <p className="text-slate-400 text-base mt-2 leading-relaxed">
                        Ready for your next journey? Manage your electric vehicles and plan optimal routes with real-time charging insights.
                      </p>
                      {seedStatus && (
                        <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-black uppercase tracking-widest text-indigo-400 rounded-xl inline-block">
                          {seedStatus}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleRunSeeding}
                        disabled={seeding}
                        className="py-2.5 px-4 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <Database className={`w-4 h-4 ${seeding ? 'animate-spin' : ''}`} />
                        Sync Demo Data
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-8 flex-wrap">
                    <button
                      onClick={() => setCurrentPage('trip-planner')}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-black transition-all shadow-lg shadow-indigo-900/20 flex items-center gap-2 group cursor-pointer active:scale-95"
                    >
                      <Compass className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                      Plan New Trip
                    </button>
                    <button
                      onClick={() => setCurrentPage('station-search')}
                      className="px-5 py-2.5 bg-slate-800 hover:bg-slate-750 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 border border-slate-700 cursor-pointer active:scale-95"
                    >
                      <MapPin className="w-4 h-4" />
                      Find Stations
                    </button>
                  </div>
                </div>
              </div>

              {/* Main Column Priority: Vehicle Management */}
              <VehicleSelector onVehicleSelected={setActiveVehicle} />

              {/* Horizontal Stats/Saved Trips Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Recent Saved Trips Panel */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden group flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2">
                      <History className="w-4 h-4 text-indigo-500" />
                      Recent Saved Trips
                    </h2>
                    <button
                      onClick={fetchSavedTrips}
                      className="p-1.5 bg-slate-800/50 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-indigo-400 transition-all cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingTrips ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {loadingTrips ? (
                    <div className="space-y-3">
                      {[1, 2].map(i => <div key={i} className="h-16 bg-slate-800/40 rounded-2xl animate-pulse" />)}
                    </div>
                  ) : savedTrips.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-8 text-center bg-slate-950/30 rounded-2xl border border-dashed border-slate-800/50">
                      <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center mb-3">
                        <MapPin className="w-5 h-5 text-slate-700" />
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">No trips saved yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[180px] overflow-y-auto no-scrollbar">
                      {savedTrips.slice(0, 3).map((trip) => (
                        <div key={trip.trip_id} className="bg-slate-950/60 border border-slate-800/50 p-3.5 rounded-2xl flex items-center justify-between group/trip hover:border-indigo-500/30 transition-all">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs font-bold text-white mb-1">
                              <span className="truncate max-w-[100px]">{trip.start_address.split(',')[0]}</span>
                              <ArrowRight className="w-3 h-3 text-indigo-500 shrink-0" />
                              <span className="truncate max-w-[100px]">{trip.end_address.split(',')[0]}</span>
                            </div>
                            <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                              <span>{trip.total_distance_km.toFixed(1)} km</span>
                              <span className="w-1 h-1 bg-slate-700 rounded-full" />
                              <span>{trip.total_duration_mins} mins</span>
                            </div>
                          </div>
                          <button
                            className="ml-3 p-2 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-500 hover:text-white rounded-xl transition-all cursor-pointer shadow-lg active:scale-95"
                            onClick={() => setCurrentPage('trip-planner')}
                          >
                            <Compass className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Quick Info / Tips */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-center">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-400">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg leading-tight">Optimization Active</h3>
                      <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                        Your aerodynamic rating is being calculated using the latest Valhalla 3.4 routing engine benchmarks.
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest bg-slate-950/50 p-3 rounded-2xl border border-slate-900">
                    <Cpu className="w-4 h-4 text-indigo-500" /> PostGIS spatial indexing enabled
                  </div>
                </div>
              </div>

            </div>

            {/* Right Column: Profile & Secondary Info */}
            <div className="space-y-6">

              {/* Profile Details Panel */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 shadow-xl">
                <h2 className="text-[10px] font-black text-indigo-500/80 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                  <UserIcon className="w-4 h-4" />
                  Account Settings
                </h2>

                {loadingUser ? (
                  <div className="py-8 text-center text-slate-500 animate-pulse text-sm">Loading profile data...</div>
                ) : user && (
                  <div className="space-y-4">
                    {updateSuccess && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-xl font-semibold">
                        Profile updated successfully!
                      </div>
                    )}
                    {updateError && (
                      <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-xl font-semibold">
                        {updateError}
                      </div>
                    )}

                    {editMode ? (
                      <form onSubmit={handleUpdateProfile} className="space-y-3.5">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">First Name</label>
                            <input
                              type="text"
                              required
                              value={newFirstName}
                              onChange={(e) => setNewFirstName(e.target.value)}
                              className="w-full bg-slate-950/80 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-2 px-3 text-white focus:outline-none transition-all text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Last Name</label>
                            <input
                              type="text"
                              required
                              value={newLastName}
                              onChange={(e) => setNewLastName(e.target.value)}
                              className="w-full bg-slate-950/80 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-2 px-3 text-white focus:outline-none transition-all text-xs"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Email</label>
                          <input
                            type="email"
                            required
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            className="w-full bg-slate-950/80 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-2 px-3 text-white focus:outline-none transition-all text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Phone Number</label>
                          <input
                            type="text"
                            value={newPhone}
                            onChange={(e) => setNewPhone(e.target.value)}
                            placeholder="e.g. +1 555-0199"
                            className="w-full bg-slate-950/80 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-2 px-3 text-white focus:outline-none transition-all text-sm"
                          />
                        </div>
                        <div className="flex gap-2 pt-2">
                          <button
                            type="submit"
                            disabled={updating}
                            className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5" />
                            {updating ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditMode(false); setUpdateError(null); }}
                            className="flex-1 py-2 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-900 text-slate-300 font-semibold text-xs transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="space-y-4 bg-slate-950/60 p-6 rounded-3xl border border-slate-850 shadow-inner">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white font-black text-xl shadow-xl">
                            {user.first_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-black text-lg text-white tracking-tight leading-none mb-1">{user.first_name} {user.last_name}</div>
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                              <Mail className="w-3 h-3" />
                              {user.email}
                            </div>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-slate-900/50 text-[10px] font-black space-y-2.5 text-slate-500 uppercase tracking-widest">
                          <div className="flex justify-between items-center">
                            <span>KYC Status</span>
                            {user.is_kyc_verified ? (
                              <span className="text-emerald-500 flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                                <Award className="w-3 h-3" /> Verified
                              </span>
                            ) : (
                              <span className="text-amber-500 flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                                <ShieldAlert className="w-3 h-3" /> Pending
                              </span>
                            )}
                          </div>
                          {user.phone_number && (
                            <div className="flex justify-between items-center">
                              <span>Phone</span>
                              <span className="text-slate-300 normal-case font-bold text-xs">{user.phone_number}</span>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => setEditMode(true)}
                          className="w-full mt-2 py-3 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all cursor-pointer shadow-lg active:scale-[0.98]"
                        >
                          Modify Profile
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Health Check Diagnostics - Compact in Sidebar */}
              <HealthCheck />

              {/* Quick Access Card - Streamlined */}
              <div className="bg-slate-950/40 border border-slate-900 rounded-3xl p-6 text-xs space-y-4">
                <h2 className="text-[9px] font-black text-slate-600 uppercase tracking-[0.3em] flex items-center gap-2">
                  Developer Console
                </h2>
                <div className="space-y-1">
                  <a href="http://192.168.254.53:8000/docs" target="_blank" rel="noreferrer" className="flex justify-between p-2 rounded-xl hover:bg-slate-900 transition-colors group">
                    <span className="text-slate-500 font-semibold group-hover:text-slate-300">API Documentation</span>
                    <span className="text-indigo-500 group-hover:underline">Open</span>
                  </a>
                  <a href="http://192.168.254.53:8000/api/v1/health" target="_blank" rel="noreferrer" className="flex justify-between p-2 rounded-xl hover:bg-slate-900 transition-colors group">
                    <span className="text-slate-500 font-semibold group-hover:text-slate-300">Health Endpoint</span>
                    <span className="text-indigo-500 group-hover:underline">View</span>
                  </a>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
        {currentPage === 'station-search' && (
          <NavigationMap 
            activeVehicle={activeVehicle} 
            onStartNavigation={(plan, decodedCoords) => {
              setActiveNavPlan(plan);
              setActiveNavRouteCoords(decodedCoords);
              setNavigatedFromPage('station-search');
              setCurrentPage('live-navigation');
            }}
          />
        )}
        {currentPage === 'trip-planner' && (
          <TripPlanner
            activeVehicle={activeVehicle}
            onStartNavigation={(plan, decodedCoords) => {
              setActiveNavPlan(plan);
              setActiveNavRouteCoords(decodedCoords);
              setNavigatedFromPage('trip-planner');
              setCurrentPage('live-navigation');
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <div className={`md:hidden fixed bottom-0 left-0 right-0 bg-slate-950/90 backdrop-blur-md border-t border-slate-900 z-50 py-3 px-6 flex justify-around items-center safe-area-bottom ${
        currentPage === 'live-navigation' ? 'hidden' : 'flex'
      }`}>
        <button
          onClick={() => setCurrentPage('dashboard')}
          className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${currentPage === 'dashboard' ? 'text-indigo-400' : 'text-slate-500'
            }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[10px] font-bold">Home</span>
        </button>
        <button
          onClick={() => setCurrentPage('station-search')}
          className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${currentPage === 'station-search' ? 'text-indigo-400' : 'text-slate-500'
            }`}
        >
          <MapPin className="w-5 h-5" />
          <span className="text-[10px] font-bold">Stations</span>
        </button>
        <button
          onClick={() => setCurrentPage('trip-planner')}
          className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${currentPage === 'trip-planner' ? 'text-indigo-400' : 'text-slate-500'
            }`}
        >
          <Compass className="w-5 h-5" />
          <span className="text-[10px] font-bold">Planner</span>
        </button>
      </div>
    </div>
  );
}

export default App;

