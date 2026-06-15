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
        { time: new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }), ok: true, latency },
        ...prev.slice(0, 9)
      ]);
    } catch (err: any) {
      const end = performance.now();
      const latency = Math.round(end - start);
      setError(err.response?.data?.detail || 'Could not reach backend health check endpoint');
      setHealth(null);
      setHistory(prev => [
        { time: new Date().toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 }), ok: false, latency },
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
    <div className="bg-slate-950/20 border border-slate-900 rounded-3xl p-6 text-white shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[9px] font-black text-slate-600 uppercase tracking-[0.3em] flex items-center gap-2">
          <Activity className="w-3 h-3 text-emerald-500" />
          System Status
        </h2>
        <div className="flex items-center gap-2">
          {loading && <RefreshCw className="w-3 h-3 animate-spin text-slate-600" />}
          <div className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'}`} />
        </div>
      </div>

      <div className="space-y-3 mb-6">
        {/* API Server Row */}
        <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-900/40 border border-slate-800/50">
          <div className="flex items-center gap-3">
            <Server className={`w-4 h-4 ${error ? 'text-rose-500' : 'text-slate-400'}`} />
            <span className="text-[10px] font-bold text-slate-300">Backend API</span>
          </div>
          <div className="text-right">
            <div className={`text-[10px] font-black uppercase ${error ? 'text-rose-500' : 'text-emerald-500'}`}>
              {error ? 'Offline' : 'Operational'}
            </div>
            {!error && <div className="text-[8px] font-bold text-slate-600 tracking-tighter">{health?.latency || 0}ms</div>}
          </div>
        </div>

        {/* Database Row */}
        <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-900/40 border border-slate-800/50">
          <div className="flex items-center gap-3">
            <Database className={`w-4 h-4 ${error || health?.database !== 'connected' ? 'text-rose-500' : 'text-slate-400'}`} />
            <span className="text-[10px] font-bold text-slate-300">PostgreSQL</span>
          </div>
          <div className="text-right">
            <div className={`text-[10px] font-black uppercase ${error || health?.database !== 'connected' ? 'text-rose-500' : 'text-emerald-500'}`}>
              {error ? 'Unreachable' : health?.database === 'connected' ? 'Connected' : 'Disconnected'}
            </div>
            <div className="text-[8px] font-bold text-slate-600 tracking-tighter">Active Pool</div>
          </div>
        </div>
      </div>

      {/* Compact Diagnostics Log */}
      <div className="bg-slate-950/60 rounded-2xl p-4 border border-slate-900">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          Connection Log History
        </div>
        
        {loading && history.length === 0 ? (
          <div className="py-4 text-center text-slate-500 text-[10px] animate-pulse uppercase font-black">Scanning...</div>
        ) : (
          <div className="space-y-1 max-h-24 overflow-y-auto no-scrollbar">
            {history.map((log, i) => (
              <div key={i} className="flex items-center justify-between py-1 border-b border-slate-900/40 last:border-0">
                <span className="text-[9px] font-bold text-slate-600">{log.time.split(',')[0]}</span>
                <span className="flex items-center gap-2">
                  <span className={`text-[8px] font-black tracking-tighter ${log.ok ? 'text-emerald-500/60' : 'text-rose-500/60'}`}>
                    {log.ok ? 'SUCCESS' : 'ERR'}
                  </span>
                  <span className="text-[9px] font-black text-slate-500 w-10 text-right">{log.latency}ms</span>
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
