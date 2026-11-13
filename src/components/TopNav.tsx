import React, { useState } from 'react';
import { Store, AppUser, UserRole } from '../types/inventory';
import { PWAInstallButton } from './PWAInstallButton';
import {
  Barcode,
  Building2,
  ChevronDown,
  LogOut,
  Check,
  X,
} from 'lucide-react';

interface TopNavProps {
  user: AppUser;
  activeStore: Store;
  stores: Store[];
  onSelectStore: (store: Store) => void;
  onLogout: () => void;
}

function getRoleDisplayLabel(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'System Administrator';
    case 'ops_supervisor':
      return 'Counter Supervisor (Ops)';
    case 'supervisor':
      return 'Store Supervisor';
    case 'ops_counter':
      return 'Operations Counter';
    case 'audit':
      return 'Audit User';
    case 'counter':
    default:
      return 'Store Counter';
  }
}

export const TopNav: React.FC<TopNavProps> = ({
  user,
  activeStore,
  stores,
  onSelectStore,
  onLogout,
}) => {
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);

  const canSwitchStore =
    user.role === 'admin' ||
    user.role === 'ops_counter' ||
    user.role === 'ops_supervisor' ||
    (user.role === 'audit' && (!user.assignedStoreId || user.assignedStoreId === 'ALL'));

  return (
    <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3 py-2">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
        {/* Brand Lockup */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-md">
            <Barcode className="w-5 h-5" />
          </div>
          <span className="text-sm font-extrabold tracking-tight text-white hidden md:inline whitespace-nowrap">
            Inventory Count
          </span>
        </div>

        {/* Store Indicator / Switcher: Admin, Operations Counter, and Counter Supervisor (Ops) can switch stores */}
        <div className="relative flex-1 max-w-[200px] sm:max-w-[260px]">
          {canSwitchStore ? (
            <button
              onClick={() => {
                setIsStoreMenuOpen(!isStoreMenuOpen);
                setIsAccountMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-1.5 rounded-xl bg-slate-800 border px-2.5 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 active:scale-95 transition min-h-[36px] ${
                user.role === 'admin'
                  ? 'border-purple-500/30'
                  : user.role === 'ops_supervisor'
                  ? 'border-cyan-500/30'
                  : user.role === 'audit'
                  ? 'border-indigo-500/30'
                  : 'border-teal-500/30'
              }`}
              title="Switch Store Location"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Building2
                  className={`w-3.5 h-3.5 shrink-0 ${
                    user.role === 'admin'
                      ? 'text-purple-400'
                      : user.role === 'ops_supervisor'
                      ? 'text-cyan-400'
                      : user.role === 'audit'
                      ? 'text-indigo-400'
                      : 'text-teal-400'
                  }`}
                />
                <span className="truncate text-[11px] sm:text-xs">
                  {activeStore.name}
                </span>
              </div>
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>
          ) : (
            <div
              className={`w-full flex items-center justify-between gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold select-none shadow-xs min-h-[36px] ${
                user.role === 'supervisor'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              }`}
              title={`Designated Store: ${activeStore.name} (${activeStore.storeId}). Access is restricted exclusively to your assigned store.`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Building2
                  className={`w-3.5 h-3.5 shrink-0 ${
                    user.role === 'supervisor' ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                />
                <span className="truncate text-[11px] sm:text-xs font-bold">
                  {activeStore.name}
                </span>
              </div>
              <span
                className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                  user.role === 'supervisor'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-emerald-500/20 text-emerald-400'
                }`}
              >
                Assigned
              </span>
            </div>
          )}

          {isStoreMenuOpen && canSwitchStore && (
            <>
              <div
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-2xs"
                onClick={() => setIsStoreMenuOpen(false)}
              />
              <div className="absolute left-0 mt-2 z-50 w-72 rounded-2xl bg-slate-900 border border-slate-800 p-2 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100">
                <div
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b border-slate-800 flex items-center justify-between ${
                    user.role === 'admin'
                      ? 'text-purple-400'
                      : user.role === 'ops_supervisor'
                      ? 'text-cyan-400'
                      : user.role === 'audit'
                      ? 'text-indigo-400'
                      : 'text-teal-400'
                  }`}
                >
                  <span>
                    {user.role === 'admin'
                      ? 'Switch Retail Store (Admin)'
                      : user.role === 'audit'
                      ? 'Filter Retail Store (Audit)'
                      : 'Select Store to Count (Ops)'}
                  </span>
                  <span className="text-[9px] text-slate-400 font-normal">{stores.length} stores</span>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-1 py-1.5">
                  {stores.map((s) => {
                    const isCurrent = s.storeId === activeStore.storeId;
                    return (
                      <button
                        key={s.storeId}
                        onClick={() => {
                          onSelectStore(s);
                          setIsStoreMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs transition ${
                          isCurrent
                            ? 'bg-emerald-600/20 text-emerald-300 font-bold border border-emerald-500/30'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-white">{s.name}</div>
                          <div className="text-[10px] text-slate-400">{s.storeId} · {s.location}</div>
                        </div>
                        {isCurrent && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Zone: PWA Install + User Profile & Mobile Logout Trigger */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* PWA Install Button */}
          <PWAInstallButton compact />

          {/* User Profile Badge */}
          <div className="relative">
            <button
              onClick={() => {
                setIsAccountMenuOpen(!isAccountMenuOpen);
                setIsStoreMenuOpen(false);
              }}
              className="flex items-center gap-1.5 rounded-xl bg-slate-800/90 border border-slate-700/80 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-700 active:scale-95 transition min-h-[36px]"
              title="Account Menu & Logout"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600/30 text-emerald-400 text-[10px] font-bold">
                {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
              </div>
              <span className="font-semibold text-[11px] truncate max-w-[65px] xs:max-w-[85px] sm:max-w-[110px]">
                {user.displayName || user.email.split('@')[0]}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>

            {/* Account & Logout Dropdown Menu */}
            {isAccountMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/50 backdrop-blur-2xs"
                  onClick={() => setIsAccountMenuOpen(false)}
                />
                <div className="absolute right-0 mt-2 z-50 w-64 rounded-2xl bg-slate-900 border border-slate-800 p-3 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100">
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      User Account
                    </span>
                    <button
                      onClick={() => setIsAccountMenuOpen(false)}
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="py-3 space-y-1">
                    <div className="font-bold text-sm text-white truncate">
                      {user.displayName || 'Counter Staff'}
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {user.email || 'local-session'}
                    </div>
                    <div className="pt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          user.role === 'admin'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : user.role === 'ops_supervisor'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : user.role === 'supervisor'
                            ? 'bg-amber-500/15 text-amber-400'
                            : user.role === 'ops_counter'
                            ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                            : user.role === 'audit'
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                            : 'bg-emerald-500/15 text-emerald-400'
                        }`}
                      >
                        {getRoleDisplayLabel(user.role)}
                      </span>
                      <span className="text-[10px] text-slate-500">· {activeStore.storeId}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800">
                    <button
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-500/15 border border-rose-500/30 hover:bg-rose-500/25 py-2.5 text-xs font-bold text-rose-300 active:scale-95 transition"
                    >
                      <LogOut className="w-4 h-4 text-rose-400" />
                      <span>Log Out (Sign Out)</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Direct 1-Tap Logout Icon Button */}
          <button
            onClick={onLogout}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/30 active:scale-95 transition shrink-0"
            title="Log Out"
            aria-label="Log Out"
          >
            <LogOut className="w-4 h-4 text-rose-400/90" />
          </button>
        </div>
      </div>
    </header>
  );
};
