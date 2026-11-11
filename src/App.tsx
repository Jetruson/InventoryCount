/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { auth } from './firebase/config';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { AppUser, Store, InventoryCount, Product } from './types/inventory';
import { DEFAULT_STORES, getStoredActiveStore, setStoredActiveStore, fetchStores, seedStoresIfEmpty } from './services/storeService';
import { fetchAllCounts, subscribeToSyncStatus } from './services/offlineSyncService';
import { fetchCatalog } from './services/catalogService';
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
  const [stores, setStores] = useState<Store[]>(DEFAULT_STORES);
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('count');
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [isDeployGuideOpen, setIsDeployGuideOpen] = useState<boolean>(false);

  // Monitor Firebase Auth state or stored local counter session
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const storedStore = getStoredActiveStore();
        const isUserAdmin =
          firebaseUser.email?.toLowerCase() === 'jetgonzalgo@gmail.com' ||
          firebaseUser.email?.toLowerCase().includes('admin');
        const isUserSupervisor = firebaseUser.email?.toLowerCase().includes('supervisor');
        const resolvedRole: 'counter' | 'supervisor' | 'admin' = isUserAdmin
          ? 'admin'
          : isUserSupervisor
          ? 'supervisor'
          : 'counter';

        setCurrentUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || (isUserAdmin ? 'Jet Gonzalgo' : firebaseUser.email?.split('@')[0]) || 'Store Associate',
          role: resolvedRole,
          activeStoreId: storedStore.storeId,
        });
      } else {
        // Check if there is an active local session
        try {
          const localSession = localStorage.getItem('inventory_count_session_user');
          if (localSession) {
            setCurrentUser(JSON.parse(localSession));
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

  // Fetch stores, catalog, and counts
  useEffect(() => {
    if (currentUser) {
      seedStoresIfEmpty();
      fetchStores().then((fetchedStores) => {
        setStores(fetchedStores);
      });

      fetchAllCounts().then((fetchedCounts) => {
        setCounts(fetchedCounts);
      });

      fetchCatalog().then((fetchedCatalog) => {
        setCatalog(fetchedCatalog);
      });

      const unsubSync = subscribeToSyncStatus((status) => {
        setPendingSyncCount(status.pendingCount);
        if (status.pendingCount === 0 && !status.isSyncing) {
          // Refresh counts after sync
          fetchAllCounts().then(setCounts);
        }
      });

      return () => unsubSync();
    }
  }, [currentUser]);

  const handleSelectStore = (store: Store) => {
    setActiveStore(store);
    setStoredActiveStore(store);
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem('inventory_count_session_user');
      await signOut(auth);
      setCurrentUser(null);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleCountSaved = (newCount: InventoryCount) => {
    setCounts((prev) => [newCount, ...prev]);
  };

  // Loading state while verifying Firebase auth session
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

  // If not logged in, render the Auth Screen
  if (!currentUser) {
    return (
      <AuthScreen
        onLoginSuccess={(user, selectedStore) => {
          setCurrentUser(user);
          setActiveStore(selectedStore);
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
        {activeTab === 'count' && (
          <CountScreen
            currentUser={currentUser}
            activeStore={activeStore}
            onCountSaved={handleCountSaved}
          />
        )}

        {activeTab === 'history' && (
          <HistoryScreen
            counts={counts}
            activeStore={activeStore}
          />
        )}

        {activeTab === 'supervisor' && (
          <SupervisorScreen
            counts={counts}
            stores={stores}
            currentUser={currentUser}
          />
        )}

        {activeTab === 'admin' && (
          <AdminScreen
            currentUser={currentUser}
            counts={counts}
            stores={stores}
            catalog={catalog}
            onCatalogUpdated={() => fetchCatalog().then(setCatalog)}
          />
        )}

        {activeTab === 'catalog' && (
          <CatalogScreen
            onSelectProductForCount={(prod: Product) => {
              setActiveTab('count');
            }}
          />
        )}
      </main>

      {/* Floating Deployment & Architecture Guide Button */}
      <button
        onClick={() => setIsDeployGuideOpen(true)}
        className="fixed bottom-20 right-4 z-30 flex items-center gap-1.5 rounded-full bg-slate-800/90 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 shadow-lg active:scale-95 transition"
        title="View Architecture & Deployment Guide"
      >
        <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
        <span className="hidden sm:inline">Deployment Guide</span>
      </button>

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
