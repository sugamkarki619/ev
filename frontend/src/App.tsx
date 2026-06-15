import React, { useEffect, useState } from 'react';
import { HealthCheck } from './components/HealthCheck';
import { Auth } from './components/Auth';
import { VehicleSelector } from './components/VehicleSelector';
import { NavigationMap } from './components/NavigationMap';
import { TripPlanner } from './components/TripPlanner';
import { LiveNavigationScreen } from './components/LiveNavigationScreen';
import { apiClient, handleLogout } from './api/client';
import { LogOut, User as UserIcon, Cpu, Layers, ShieldCheck, Mail, Save, Wallet as WalletIcon, Coins, ShieldAlert, Award, RefreshCw, Database, LayoutDashboard, MapPin, Compass } from 'lucide-react';

interface User {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  role: string;
  is_kyc_verified: boolean;
}

interface Wallet {
  wallet_id: string;
  user_id: string;
  balance_coins: number;
  currency_code: string;
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

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    !!localStorage.getItem('access_token')
  );
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [activeVehicle, setActiveVehicle] = useState<UserVehicle | null>(null);
  const [currentPage, setCurrentPage] = useState<'dashboard' | 'station-search' | 'trip-planner' | 'live-navigation'>('dashboard');
  const [activeNavPlan, setActiveNavPlan] = useState<any | null>(null);
  const [activeNavRouteCoords, setActiveNavRouteCoords] = useState<[number, number][]>([]);
  const [navigatedFromPage, setNavigatedFromPage] = useState<'station-search' | 'trip-planner'>('trip-planner');

  const [loadingUser, setLoadingUser] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);

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

  const fetchUserWallet = async () => {
    if (!isAuthenticated) return;
    setLoadingWallet(true);
    try {
      const response = await apiClient.get('/wallets/me');
      setWallet(response.data);
    } catch (err) {
      console.error("Failed to load wallet data", err);
    } finally {
      setLoadingWallet(false);
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
    setSeeding(true);
    setSeedStatus(null);
    try {
      const response = await apiClient.post('/seed/run');
      setSeedStatus(response.data.message);
      // Reload states
      await fetchUserProfile();
      await fetchUserWallet();
    } catch (err: any) {
      setSeedStatus("Seeding failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchUserProfile();
      fetchUserWallet();
    } else {
      setUser(null);
      setWallet(null);
      setActiveVehicle(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const handleAuthLogout = () => {
      setIsAuthenticated(false);
      setUser(null);
      setWallet(null);
      setActiveVehicle(null);
    };
    window.addEventListener('auth_logout', handleAuthLogout);
    return () => window.removeEventListener('auth_logout', handleAuthLogout);
  }, []);

  const logout = () => {
    handleLogout();
    setIsAuthenticated(false);
    setUser(null);
    setWallet(null);
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
      <header className={`border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3 flex items-center justify-between h-16 shrink-0 ${
        currentPage !== 'dashboard' ? 'hidden md:flex' : 'flex'
      }`}>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-500 flex items-center justify-center">
            <span className="material-symbols-outlined text-indigo-500 font-bold" style={{ fontVariationSettings: "'FILL' 1" }}>electric_car</span>
          </div>
          <div>
            <h1 className="text-xl font-black text-white leading-none m-0 tracking-tight">
              Volt<span className="text-indigo-500">Route</span>
            </h1>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">Navigation Portal</span>
          </div>
        </div>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1.5 bg-slate-900/40 border border-slate-850 p-1 rounded-xl">
          <button
            onClick={() => setCurrentPage('dashboard')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${currentPage === 'dashboard'
                ? 'bg-indigo-650 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            Dashboard
          </button>
          <button
            onClick={() => setCurrentPage('station-search')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${currentPage === 'station-search'
                ? 'bg-indigo-650 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            Station Search
          </button>
          <button
            onClick={() => setCurrentPage('trip-planner')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${currentPage === 'trip-planner'
                ? 'bg-indigo-650 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
          >
            <Compass className="w-3.5 h-3.5" />
            Trip Planner
          </button>
        </nav>

        {user && (
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2.5 bg-slate-900/50 border border-slate-800/80 py-1.5 px-3 rounded-xl text-xs">
              <UserIcon className="w-4 h-4 text-indigo-400" />
              <span className="font-semibold text-slate-300">
                {user.first_name} {user.last_name}
              </span>
              <span className="bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 font-bold px-1.5 py-0.2 rounded text-[9px] uppercase tracking-wide">
                {formatRole(user.role)}
              </span>
            </div>

            <button
              onClick={logout}
              className="p-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:scale-105 active:scale-95 border border-rose-500/20 rounded-xl transition-all cursor-pointer flex items-center gap-2 text-xs font-bold"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
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

            {/* Left Column: Welcomes, Health */}
            <div className="lg:col-span-2 space-y-6">

              {/* Welcome Panel */}
              <div className="bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute right-0 bottom-0 top-0 w-[40%] bg-gradient-to-l from-indigo-500/5 to-transparent pointer-events-none" />

                <div className="flex justify-between items-start gap-4 flex-wrap">
                  <div>
                    <h2 className="text-2xl font-black text-white">
                      Welcome back, {user?.first_name || 'Developer'}!
                    </h2>
                    <p className="text-slate-400 text-sm mt-1 max-w-xl">
                      Your session is authenticated. Seed database stations and compute your geographic paths using the navigation planner.
                    </p>
                  </div>

                  <button
                    onClick={handleRunSeeding}
                    disabled={seeding}
                    className="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:pointer-events-none rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-950/40"
                  >
                    <Database className={`w-4 h-4 ${seeding ? 'animate-spin' : ''}`} />
                    {seeding ? 'Seeding...' : 'Seed Demo Data'}
                  </button>
                </div>

                {seedStatus && (
                  <div className="mt-4 p-3 bg-slate-950/60 border border-slate-800 text-[11px] font-semibold text-slate-300 rounded-xl">
                    {seedStatus}
                  </div>
                )}

                <div className="flex gap-4 mt-6 flex-wrap">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 bg-slate-950/40 px-3 py-1.5 rounded-lg border border-slate-900">
                    <Cpu className="w-4 h-4 text-indigo-400" /> Valhalla 3.4
                  </div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 bg-slate-950/40 px-3 py-1.5 rounded-lg border border-slate-900">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" /> PostGIS Point Index
                  </div>
                </div>
              </div>

              {/* Health Check Diagnostics */}
              <HealthCheck />

            </div>

            {/* Right Column: User Profile, Wallets, and Vehicle Configuration */}
            <div className="space-y-6">

              {/* Wallet Dashboard Widget */}
              <div className="bg-gradient-to-br from-indigo-950/40 to-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-5 text-indigo-400">
                  <WalletIcon className="w-24 h-24" />
                </div>

                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Coins className="w-4 h-4 text-indigo-400" />
                  Digital Token Wallet
                </h2>

                {loadingWallet ? (
                  <div className="py-4 text-center text-slate-500 animate-pulse text-xs">Fetching tokens...</div>
                ) : wallet ? (
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-3xl font-black text-white tracking-tight flex items-baseline gap-1">
                        {wallet.balance_coins.toFixed(2)}
                        <span className="text-xs text-indigo-400 font-bold uppercase tracking-wider">{wallet.currency_code}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-2">
                        Top-up balance allocated for charging reservations.
                      </p>
                    </div>
                    <button
                      onClick={fetchUserWallet}
                      className="p-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-850 rounded-lg transition-all text-slate-400 hover:text-white cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="py-2 text-xs text-slate-500">Wallet context unavailable. Reload.</div>
                )}
              </div>

              {/* Vehicle Selector Panel */}
              <VehicleSelector onVehicleSelected={setActiveVehicle} />

              {/* Profile Details Panel */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl">
                <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <UserIcon className="w-5 h-5 text-indigo-400" />
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
                      <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-850">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-black">
                            {user.first_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-sm text-white">{user.first_name} {user.last_name}</div>
                            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                              <Mail className="w-3 h-3 text-slate-500" />
                              {user.email}
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-900 text-xs space-y-1.5 text-slate-400">
                          <div className="flex justify-between">
                            <span>Identity Verification (KYC)</span>
                            {user.is_kyc_verified ? (
                              <span className="text-emerald-400 font-bold flex items-center gap-1">
                                <Award className="w-3.5 h-3.5" /> Verified
                              </span>
                            ) : (
                              <span className="text-amber-500 font-bold flex items-center gap-1">
                                <ShieldAlert className="w-3.5 h-3.5" /> Pending Verification
                              </span>
                            )}
                          </div>
                          {user.phone_number && (
                            <div className="flex justify-between">
                              <span>Phone Number</span>
                              <span className="text-slate-300 font-semibold">{user.phone_number}</span>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => setEditMode(true)}
                          className="w-full mt-2 py-2 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-white border border-slate-800 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                        >
                          Edit Profile
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Quick Access Card */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-xl text-xs space-y-4">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  Stack Endpoints Reference
                </h2>
                <div className="space-y-2.5">
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-500 font-medium">Swagger API Docs</span>
                    <a href="http://192.168.254.53:8000/docs" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline font-bold">192.168.254.53:8000/docs</a>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-500 font-medium">Health Status Endpoint</span>
                    <a href="http://192.168.254.53:8000/api/v1/health" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline font-bold">/api/v1/health</a>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-900">
                    <span className="text-slate-500 font-medium">React App Local Dev</span>
                    <span className="text-slate-300 font-bold">{window.location.host}</span>
                  </div>
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
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-950/90 backdrop-blur-md border-t border-slate-900 z-50 py-2 px-6 flex justify-around items-center">
        <button
          onClick={() => setCurrentPage('dashboard')}
          className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${currentPage === 'dashboard' ? 'text-indigo-400' : 'text-slate-500'
            }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[10px] font-bold">Dashboard</span>
        </button>
        <button
          onClick={() => setCurrentPage('station-search')}
          className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${currentPage === 'station-search' ? 'text-indigo-400' : 'text-slate-500'
            }`}
        >
          <MapPin className="w-5 h-5" />
          <span className="text-[10px] font-bold">Station Search</span>
        </button>
        <button
          onClick={() => setCurrentPage('trip-planner')}
          className={`flex flex-col items-center gap-1 transition-all cursor-pointer ${currentPage === 'trip-planner' ? 'text-indigo-400' : 'text-slate-500'
            }`}
        >
          <Compass className="w-5 h-5" />
          <span className="text-[10px] font-bold">Trip Planner</span>
        </button>
      </div>
    </div>
  );
}

export default App;

