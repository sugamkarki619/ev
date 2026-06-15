import React, { useState } from 'react';
import { apiClient } from '../api/client';
import { Mail, Lock, User as UserIcon, LogIn, UserPlus, AlertCircle, Shield } from 'lucide-react';

interface AuthProps {
  onAuthSuccess: () => void;
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('ev_owner');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isLogin) {
        // Standard OAuth2 form data
        const formData = new URLSearchParams();
        formData.append('username', email);
        formData.append('password', password);

        const response = await apiClient.post('/auth/login', formData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        localStorage.setItem('access_token', response.data.access_token);
        localStorage.setItem('refresh_token', response.data.refresh_token);
        onAuthSuccess();
      } else {
        // User registration
        await apiClient.post('/users/register', {
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          role: role,
        });

        // After successful registration, log them in automatically
        const formData = new URLSearchParams();
        formData.append('username', email);
        formData.append('password', password);

        const loginResponse = await apiClient.post('/auth/login', formData, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        localStorage.setItem('access_token', loginResponse.data.access_token);
        localStorage.setItem('refresh_token', loginResponse.data.refresh_token);
        onAuthSuccess();
      }
    } catch (err: any) {
      console.error(err);
      setError(
        err.response?.data?.detail || 
        (typeof err.response?.data?.detail === 'object' 
          ? JSON.stringify(err.response?.data?.detail) 
          : 'An unexpected authentication error occurred.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-lg border border-slate-800 rounded-3xl p-8 shadow-2xl text-white">
      {/* Switcher Tab */}
      <div className="flex bg-slate-950/80 rounded-2xl p-1 mb-8 border border-slate-800/60">
        <button
          onClick={() => { setIsLogin(true); setError(null); }}
          className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
            isLogin ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
          }`}
        >
          <LogIn className="w-4 h-4" />
          Sign In
        </button>
        <button
          onClick={() => { setIsLogin(false); setError(null); }}
          className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
            !isLogin ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
          }`}
        >
          <UserPlus className="w-4 h-4" />
          Register
        </button>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h1>
        <p className="text-sm text-slate-400 mt-2">
          {isLogin ? 'Enter details to access your dashboard' : 'Join and launch your stack'}
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex gap-2.5 items-start">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Auth Failure: </span>
            {typeof error === 'string' ? error : 'Validation errors, check input format.'}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {!isLogin && (
          <>
            {/* First and Last name side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">First Name</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                    <UserIcon className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    className="w-full bg-slate-950/80 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-2.5 pl-9 pr-3 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Last Name</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
                    <UserIcon className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    className="w-full bg-slate-950/80 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-2.5 pl-9 pr-3 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Role dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Account Role</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                  <Shield className="w-5 h-5" />
                </span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-3 pl-11 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm appearance-none cursor-pointer"
                >
                  <option value="ev_owner">EV Vehicle Owner</option>
                  <option value="home_station_owner">Home P2P Station Owner</option>
                  <option value="restaurant_owner">Restaurant Partner Owner</option>
                  <option value="admin">Platform Administrator</option>
                </select>
                <span className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 pointer-events-none">
                  ▼
                </span>
              </div>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Email Address</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
              <Mail className="w-5 h-5" />
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-slate-950/80 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-3 pl-11 pr-4 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Password</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
              <Lock className="w-5 h-5" />
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              className="w-full bg-slate-950/80 border border-slate-800/80 focus:border-indigo-500 rounded-xl py-3 pl-11 pr-4 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full mt-2 py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:scale-98 text-white font-bold transition-all shadow-lg shadow-indigo-950/40 disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-2"
        >
          {loading ? (
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : isLogin ? (
            <>
              <LogIn className="w-5 h-5" /> Sign In
            </>
          ) : (
            <>
              <UserPlus className="w-5 h-5" /> Register
            </>
          )}
        </button>
      </form>
    </div>
  );
};
