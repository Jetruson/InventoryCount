import React, { useEffect, useState } from 'react';
import { subscribeToSyncStatus, syncPendingCounts } from '../services/offlineSyncService';
import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsub = subscribeToSyncStatus((status) => {
      setPendingCount(status.pendingCount);
      setIsSyncing(status.isSyncing);
      setSyncError(status.error || null);
      if (status.pendingCount === 0 && !status.isSyncing && !status.error && pendingCount > 0) {
        setJustSynced(true);
        setTimeout(() => setJustSynced(false), 3000);
      }
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsub();
    };
  }, [pendingCount]);

  // If online, zero pending items, and no error, keep screen clean
  if (isOnline && pendingCount === 0 && !justSynced && !syncError) {
    return null;
  }

  const handleManualSync = async () => {
    if (isOnline) {
      await syncPendingCounts();
    }
  };

  return (
    <div className="fixed top-16 right-3 z-40 max-w-[90vw] animate-in fade-in slide-in-from-top-2 duration-200">
      {!isOnline ? (
        <div className="flex items-center gap-2 rounded-xl bg-amber-500/90 backdrop-blur-md px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-lg border border-amber-400/40">
          <WifiOff className="w-4 h-4 shrink-0 text-slate-950 animate-pulse" />
          <span>Offline Mode</span>
          {pendingCount > 0 && (
            <span className="rounded-md bg-amber-600/40 px-1.5 py-0.5 text-[11px] font-bold">
              {pendingCount} saved locally
            </span>
          )}
        </div>
      ) : justSynced ? (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-200" />
          <span>All counts synced to cloud</span>
        </div>
      ) : pendingCount > 0 ? (
        <button
          onClick={handleManualSync}
          disabled={isSyncing}
          className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium shadow-lg active:scale-95 transition ${
            syncError
              ? 'bg-rose-950/95 border-rose-500/50 text-rose-200 hover:bg-rose-900'
              : 'bg-slate-800/95 border-slate-700 text-slate-200 hover:bg-slate-700'
          }`}
          title={syncError || 'Tap to retry cloud sync'}
        >
          {syncError ? (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : (
            <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isSyncing ? 'animate-spin' : ''}`} />
          )}
          <span>{pendingCount} pending upload</span>
          <span className="text-[10px] text-emerald-400 font-semibold underline">
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </span>
        </button>
      ) : null}
    </div>
  );
};
