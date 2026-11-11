import React, { useEffect, useState } from 'react';
import { subscribeToSyncStatus, syncPendingCounts } from '../services/offlineSyncService';
import { Wifi, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsub = subscribeToSyncStatus((status) => {
      setPendingCount(status.pendingCount);
      setIsSyncing(status.isSyncing);
      if (status.pendingCount === 0 && !status.isSyncing && pendingCount > 0) {
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

  // If online and zero pending items, keep screen clean without clutter
  if (isOnline && pendingCount === 0 && !justSynced) {
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
          className="flex items-center gap-2 rounded-xl bg-slate-800/95 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-lg hover:bg-slate-700 active:scale-95 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{pendingCount} pending upload</span>
          <span className="text-[10px] text-emerald-400 font-semibold underline">Sync</span>
        </button>
      ) : null}
    </div>
  );
};
