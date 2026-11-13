import { Camera, Clock, ShieldCheck, Package, ShieldAlert } from 'lucide-react';
import { AppUser } from '../types/inventory';

export type ActiveTab = 'count' | 'history' | 'supervisor' | 'catalog' | 'admin';

interface BottomNavProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
  pendingSyncCount?: number;
  currentUser?: AppUser | null;
}

interface TabItem {
  id: ActiveTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | null;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  pendingSyncCount = 0,
  currentUser,
}) => {
  const role = currentUser?.role || 'counter';

  const allTabs: TabItem[] = [
    { id: 'count', label: 'Count', icon: Camera },
    { id: 'history', label: 'History', icon: Clock, badge: pendingSyncCount > 0 ? pendingSyncCount : null },
    ...(role === 'supervisor' || role === 'ops_supervisor' || role === 'admin'
      ? [{ id: 'supervisor' as ActiveTab, label: 'Supervisor', icon: ShieldCheck }]
      : []),
    ...(role === 'admin'
      ? [{ id: 'admin' as ActiveTab, label: 'Admin', icon: ShieldAlert }]
      : []),
    { id: 'catalog', label: 'Catalog', icon: Package },
  ];

  const gridColsClass =
    allTabs.length === 5
      ? 'grid-cols-5'
      : allTabs.length === 4
      ? 'grid-cols-4'
      : 'grid-cols-3';

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 pb-safe">
      <div className={`max-w-md mx-auto grid ${gridColsClass} h-16 items-center px-1`}>
        {allTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id as ActiveTab)}
              className={`relative flex flex-col items-center justify-center h-full min-h-[48px] py-1 transition-all active:scale-95 ${
                isActive
                  ? tab.id === 'admin'
                    ? 'text-purple-400 font-bold'
                    : 'text-emerald-400 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110 stroke-[2.4]' : 'stroke-[1.8]'}`} />
                {tab.badge && (
                  <span className="absolute -top-1.5 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-black text-slate-950">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[11px] mt-1 tracking-tight ${isActive ? 'font-bold' : 'font-medium'}`}>
                {tab.label}
              </span>
              {isActive && (
                <span className={`absolute bottom-1 w-6 h-0.5 rounded-full ${tab.id === 'admin' ? 'bg-purple-400' : 'bg-emerald-400'}`} />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
