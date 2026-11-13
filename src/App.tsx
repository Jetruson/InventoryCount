/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { auth } from './firebase/config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { AppUser, Store, InventoryCount, Product, UserRole } from './types/inventory';
import {
  getLocalStores,
  getStoredActiveStore,
  setStoredActiveStore,
  subscribeToStores,
  seedStoresIfEmpty,
} from './services/storeService';
import { seedUsersIfEmpty } from './services/userService';
import {
  subscribeToCounts,
  subscribeToSyncStatus,
  syncPendingCounts,
} from './services/offlineSyncService';
import {
  fetchCatalog,
  subscribeToCatalog,
  seedCatalogIfEmpty,
} from './services/catalogService';
import { AuthScreen } from './components/AuthScreen';
import { TopNav } from './components/TopNav';
import { BottomNav, ActiveTab } from './components/BottomNav';
import { CountScreen } from './components/CountScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { SupervisorScreen } from './components/SupervisorScreen';
import { CatalogScreen } from './components/CatalogScreen';
import { AdminScreen } from './components/AdminScreen';
import { OfflineIndicator } from './components/OfflineIndicator';
import { DeploymentGuideModal } from './components/DeploymentGuideModal';
import { Barcode, HelpCircle } from 'lucide-react';

export default function App() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [activeStore, setActiveStore] = useState<Store>(getStoredActiveStore());
  const [stores, setStores] = useState<Store[]>(getLocalStores());
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('count');
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [isDeployGuideOpen, setIsDeployGuideOpen] = useState<boolean>(false);

  // Subscribe to retail stores in real time (needed both before and after login)
  useEffect(() => {
    seedStoresIfEmpty();
    const unsubStores = subscribeToStores((fetchedStores) => {
      setStores(fetchedStores);
    });
    return () => unsubStores();
  }, []);

  // Monitor Firebase Auth state or stored local session
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const storedStore = getStoredActiveStore();
        const isUserAdmin =
          firebaseUser.email?.toLowerCase() === 'jetgonzalgo@gmail.com' ||
          firebaseUser.email?.toLowerCase().includes('admin');
        const isUserSupervisor = firebaseUser.email?.toLowerCase().includes('supervisor');
        let resolvedRole: UserRole = isUserAdmin
          ? 'admin'
          : isUserSupervisor
          ? 'supervisor'
          : 'counter';

        // Check local session storage for assignment metadata
        let assignedStoreId: string | undefined = undefined;
        let assignedStoreName: string | undefined = undefined;
        try {
          const localSession = localStorage.getItem('inventory_count_session_user');
          if (localSession) {
            const parsed = JSON.parse(localSession);
            if (parsed.uid === firebaseUser.uid || parsed.email === firebaseUser.email) {
              assignedStoreId = parsed.assignedStoreId;
              assignedStoreName = parsed.assignedStoreName;
              if (parsed.role) resolvedRole = parsed.role;
            }
          }
        } catch {
          // ignore error
        }

        const userObj: AppUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName:
            firebaseUser.displayName ||
            (isUserAdmin ? 'Jet Gonzalgo' : firebaseUser.email?.split('@')[0]) ||
            'Store Associate',
          role: resolvedRole,
          activeStoreId:
            assignedStoreId && assignedStoreId !== 'ALL' ? assignedStoreId : storedStore.storeId,
          assignedStoreId: assignedStoreId,
          assignedStoreName: assignedStoreName,
        };

        setCurrentUser(userObj);

        if (
          (resolvedRole === 'counter' || resolvedRole === 'supervisor') &&
          assignedStoreId &&
          assignedStoreId !== 'ALL'
        ) {
          const currentStores = getLocalStores();
          const matched = currentStores.find((s) => s.storeId === assignedStoreId);
          if (matched) {
            setActiveStore(matched);
            setStoredActiveStore(matched);
          }
        }
      } else {
        // Check if there is an active credential-provisioned local session
        try {
          const localSession = localStorage.getItem('inventory_count_session_user');
          if (localSession) {
            const parsed: AppUser = JSON.parse(localSession);
            setCurrentUser(parsed);
            if (
              (parsed.role === 'counter' || parsed.role === 'supervisor') &&
              parsed.assignedStoreId &&
              parsed.assignedStoreId !== 'ALL'
            ) {
              const currentStores = getLocalStores();
              const matched = currentStores.find((s) => s.storeId === parsed.assignedStoreId);
              if (matched) {
                setActiveStore(matched);
                setStoredActiveStore(matched);
              }
            }
          } else {
            setCurrentUser(null);
          }
        } catch {
          setCurrentUser(null);
        }
      }
      setIsAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Keep locked roles bound to their assigned store when stores list updates
  useEffect(() => {
    if (
      currentUser &&
      (currentUser.role === 'counter' ||
        currentUser.role === 'supervisor' ||
        currentUser.role === 'audit') &&
      currentUser.assignedStoreId &&
      currentUser.assignedStoreId !== 'ALL'
    ) {
      const matched = stores.find((s) => s.storeId === currentUser.assignedStoreId);
      if (matched && matched.storeId !== activeStore.storeId) {
        setActiveStore(matched);
        setStoredActiveStore(matched);
      }
    }
  }, [currentUser, stores, activeStore.storeId]);

  // Admin users do not have a Count page; Audit users can ONLY access History
  useEffect(() => {
    if (currentUser?.role === 'admin' && activeTab === 'count') {
      setActiveTab('admin');
    } else if (currentUser?.role === 'audit' && activeTab !== 'history') {
      setActiveTab('history');
    }
  }, [currentUser?.role, activeTab]);

  // Real-time cloud subscriptions for catalog, counts, and pending sync flushing
  useEffect(() => {
    if (!currentUser) return;

    seedUsersIfEmpty();
    seedCatalogIfEmpty();

    // Immediately flush any pending offline counts from this device
    if (navigator.onLine) {
      syncPendingCounts();
    }

    const unsubCounts = subscribeToCounts((liveCounts) => {
      setCounts(liveCounts);
    });

    const unsubCatalog = subscribeToCatalog((liveCatalog) => {
      setCatalog(liveCatalog);
    });

    const unsubSync = subscribeToSyncStatus((status) => {
      setPendingSyncCount(status.pendingCount);
    });

    return () => {
      unsubCounts();
      unsubCatalog();
      unsubSync();
    };
  }, [currentUser]);

  const handleSelectStore = (store: Store) => {
    const canSwitchStore =
      currentUser?.role === 'admin' ||
      currentUser?.role === 'ops_counter' ||
      currentUser?.role === 'ops_supervisor' ||
      (currentUser?.role === 'audit' &&
        (!currentUser.assignedStoreId || currentUser.assignedStoreId === 'ALL'));
    if (!canSwitchStore) {
      return;
    }
    setActiveStore(store);
    setStoredActiveStore(store);
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem('inventory_count_session_user');
      await signOut(auth);
      setCurrentUser(null);
      setActiveTab('count');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleCountSaved = (newCount: InventoryCount) => {
    setCounts((prev) => {
      const filtered = prev.filter((c) => c.id !== newCount.id);
      return [newCount, ...filtered];
    });
  };

  // Loading state while verifying auth session
  if (isAuthLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-950 text-slate-100">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 shadow-2xl animate-pulse">
          <Barcode className="w-9 h-9 text-white" />
        </div>
        <p className="mt-4 text-sm font-bold tracking-wide text-slate-300">
          Loading Inventory Count...
        </p>
      </div>
    );
  }

  // If not logged in, render the Auth Screen with dynamically available stores
  if (!currentUser) {
    return (
      <AuthScreen
        stores={stores}
        onLoginSuccess={(user, selectedStore) => {
          setCurrentUser(user);
          setActiveStore(selectedStore);
          setStoredActiveStore(selectedStore);
          setActiveTab(
            user.role === 'admin'
              ? 'admin'
              : user.role === 'audit'
              ? 'history'
              : 'count'
          );
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-emerald-500 selection:text-white">
      {/* Offline Status Toast */}
      <OfflineIndicator />

      {/* Top Navigation Bar */}
      <TopNav
        user={currentUser}
        activeStore={activeStore}
        stores={stores}
        onSelectStore={handleSelectStore}
        onLogout={handleLogout}
      />

      {/* Main View Area */}
      <main className="flex-1 w-full max-w-4xl mx-auto pt-2">
        {activeTab === 'count' && currentUser.role !== 'admin' && currentUser.role !== 'audit' && (
          <CountScreen
            currentUser={currentUser}
            activeStore={activeStore}
            catalog={catalog}
            onCountSaved={handleCountSaved}
          />
        )}

        {activeTab === 'history' && (
          <HistoryScreen
            counts={counts}
            activeStore={activeStore}
            currentUser={currentUser}
          />
        )}

        {activeTab === 'supervisor' && currentUser.role !== 'audit' && (
          <SupervisorScreen
            counts={counts}
            stores={stores}
            currentUser={currentUser}
          />
        )}

        {activeTab === 'admin' && currentUser.role === 'admin' && (
          <AdminScreen
            currentUser={currentUser}
            counts={counts}
            stores={stores}
            catalog={catalog}
            onCatalogUpdated={() => fetchCatalog().then(setCatalog)}
            onStoresUpdated={(updatedStores) => {
              setStores(updatedStores);
              if (!updatedStores.some((s) => s.storeId === activeStore.storeId) && updatedStores.length > 0) {
                setActiveStore(updatedStores[0]);
                setStoredActiveStore(updatedStores[0]);
              }
            }}
          />
        )}

        {activeTab === 'catalog' && currentUser.role !== 'audit' && (
          <CatalogScreen
            currentUser={currentUser}
            catalog={catalog}
            onSelectProductForCount={
              currentUser.role !== 'admin'
                ? () => {
                    setActiveTab('count');
                  }
                : undefined
            }
          />
        )}
      </main>

      {/* Floating Deployment & Architecture Guide Button */}
      {currentUser.role !== 'audit' && (
        <button
          onClick={() => setIsDeployGuideOpen(true)}
          className="fixed bottom-20 right-4 z-30 flex items-center gap-1.5 rounded-full bg-slate-800/90 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 shadow-lg active:scale-95 transition"
          title="View Architecture & Deployment Guide"
        >
          <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Deployment Guide</span>
        </button>
      )}

      {/* Bottom Ergonomic Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        pendingSyncCount={pendingSyncCount}
        currentUser={currentUser}
      />

      {/* Deployment & Architecture Modal */}
      <DeploymentGuideModal
        isOpen={isDeployGuideOpen}
        onClose={() => setIsDeployGuideOpen(false)}
      />
    </div>
  );
}
