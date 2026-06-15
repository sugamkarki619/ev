import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { Activity, Database, Server, RefreshCw } from 'lucide-react';

interface HealthData {
  status: string;
  database: string;
  message: string;
  latency?: number;
}

export const HealthCheck: React.FC = () => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ time: string; ok: boolean; latency: number }[]>([]);

  const checkHealth = async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const response = await apiClient.get('/health');
      const end = performance.now();
      const latency = Math.round(end - start);
      setHealth({ ...response.data, latency });
      setError(null);
      
      setHistory(prev => [
        { time: new Date().toLocaleTimeString(), ok: true, latency },
        ...prev.slice(0, 9)
      ]);
    } catch (err: any) {
      const end = performance.now();
      const latency = Math.round(end - start);
      setError(err.response?.data?.detail || 'Could not reach backend health check endpoint');
      setHealth(null);
      setHistory(prev => [
        { time: new Date().toLocaleTimeString(), ok: false, latency },
        ...prev.slice(0, 9)
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 10000); // check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl text-white">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold flex items-center gap-2 text-indigo-400">
          <Activity className="w-5 h-5 animate-pulse text-indigo-400" />
          System Health Monitor
        </h2>
        <button
          onClick={checkHealth}
          disabled={loading}
          className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/40 hover:scale-105 active:scale-95 transition-all text-sm flex items-center gap-1 font-semibold cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* API Server Card */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center gap-4">
          <div className={`p-3 rounded-lg ${error ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
            <Server className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">FASTAPI BACKEND</div>
            <div className="font-bold text-lg flex items-center gap-2 mt-0.5">
              {error ? 'Offline' : 'Online'}
              <span className={`w-2.5 h-2.5 rounded-full inline-block ${error ? 'bg-rose-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {error ? 'Service connection failed' : `Latency: ${health?.latency || 0}ms`}
            </div>
          </div>
        </div>

        {/* Database Card */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center gap-4">
          <div className={`p-3 rounded-lg ${error || health?.database !== 'connected' ? 'bg-rose-500/10 text-rose-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
            <Database className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs text-slate-400 font-medium">POSTGRESQL DB</div>
            <div className="font-bold text-lg flex items-center gap-2 mt-0.5">
              {error ? 'Unknown' : health?.database === 'connected' ? 'Connected' : 'Disconnected'}
              <span className={`w-2.5 h-2.5 rounded-full inline-block ${error || health?.database !== 'connected' ? 'bg-rose-500 animate-ping' : 'bg-indigo-500 animate-pulse'}`} />
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {error ? 'Database host unreachable' : 'Pool connections active'}
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostics Panel */}
      <div className="border border-slate-800 bg-slate-950/40 rounded-xl p-4">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          Connection Log History
        </div>
        
        {loading && history.length === 0 ? (
          <div className="py-4 text-center text-slate-500 text-sm animate-pulse">Running diagnostic check...</div>
        ) : (
          <div className="space-y-2 max-h-36 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
            {history.map((log, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-slate-900/60 last:border-0">
                <span className="text-slate-500">{log.time}</span>
                <span className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${log.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                    {log.ok ? 'PING OK' : 'FAILED'}
                  </span>
                  <span className="text-slate-400 w-12 text-right">{log.latency}ms</span>
                </span>
              </div>
            ))}
            {history.length === 0 && (
              <div className="text-center text-xs text-slate-500 py-3">No logs recorded yet. Waiting for polls...</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
