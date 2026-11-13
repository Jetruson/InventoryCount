import { Store } from '../types/inventory';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc, onSnapshot, query, limit } from 'firebase/firestore';

export const DEFAULT_STORES: Store[] = [
  { storeId: 'ST-101', name: 'Downtown Flagship', location: '100 Main Street' },
  { storeId: 'ST-102', name: 'Westfield Galleria', location: '450 Galleria Mall, Fl 2' },
  { storeId: 'ST-103', name: 'Metro Supercenter', location: '780 Industrial Pkwy' },
  { storeId: 'ST-104', name: 'Harbor Outlet Store', location: '12 Waterfront Ave' },
  { storeId: 'ST-105', name: 'Airport Express Kiosk', location: 'Terminal 3 Concourse B' },
];

const ACTIVE_STORE_KEY = 'inventory_count_active_store';
const LOCAL_STORES_KEY = 'inventory_count_local_stores';

export function getLocalStores(): Store[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error reading local stores cache:', e);
  }
  return DEFAULT_STORES;
}

export function saveLocalStores(stores: Store[]): void {
  try {
    localStorage.setItem(LOCAL_STORES_KEY, JSON.stringify(stores));
  } catch (e) {
    console.warn('Error saving local stores cache:', e);
  }
}

export function getStoredActiveStore(): Store {
  try {
    const raw = localStorage.getItem(ACTIVE_STORE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading active store:', e);
  }
  const currentStores = getLocalStores();
  return currentStores[0] || DEFAULT_STORES[0];
}

export function setStoredActiveStore(store: Store): void {
  try {
    localStorage.setItem(ACTIVE_STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.error('Error saving active store:', e);
  }
}

export async function fetchStores(): Promise<Store[]> {
  try {
    const snapshot = await getDocs(collection(db, 'stores'));
    if (!snapshot.empty) {
      const stores: Store[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        stores.push({
          storeId: data.storeId || docSnap.id,
          name: data.name,
          location: data.location || '',
        });
      });
      stores.sort((a, b) => a.storeId.localeCompare(b.storeId));
      saveLocalStores(stores);
      return stores;
    }
  } catch (e) {
    console.warn('Network offline or error fetching stores from Firestore. Using local stores cache:', e);
  }
  return getLocalStores();
}

export function subscribeToStores(onUpdate: (stores: Store[]) => void): () => void {
  try {
    return onSnapshot(
      collection(db, 'stores'),
      (snapshot) => {
        if (!snapshot.empty) {
          const stores: Store[] = [];
          snapshot.forEach(docSnap => {
            const data = docSnap.data();
            stores.push({
              storeId: data.storeId || docSnap.id,
              name: data.name,
              location: data.location || '',
            });
          });
          stores.sort((a, b) => a.storeId.localeCompare(b.storeId));
          saveLocalStores(stores);
          onUpdate(stores);
        } else {
          onUpdate(getLocalStores());
        }
      },
      (err) => {
        console.warn('Realtime stores listener error:', err);
        onUpdate(getLocalStores());
      }
    );
  } catch (err) {
    console.warn('Could not attach realtime stores listener:', err);
    onUpdate(getLocalStores());
    return () => {};
  }
}

const STORES_SEEDED_KEY = 'inventory_count_stores_seeded';

export async function seedStoresIfEmpty(): Promise<void> {
  try {
    if (localStorage.getItem(STORES_SEEDED_KEY) === 'true') return;
    const snapshot = await getDocs(query(collection(db, 'stores'), limit(1)));
    if (snapshot.empty) {
      for (const st of DEFAULT_STORES) {
        await setDoc(doc(db, 'stores', st.storeId), st);
      }
    }
    localStorage.setItem(STORES_SEEDED_KEY, 'true');
  } catch (e) {
    console.warn('Store seeding skipped or offline:', e);
  }
}

/**
 * Admin action: Adds a new retail store branch.
 */
export async function addStore(newStore: Store): Promise<Store[]> {
  const currentStores = getLocalStores();
  // Check for duplicate ID
  const existingIdx = currentStores.findIndex(s => s.storeId.toLowerCase() === newStore.storeId.toLowerCase());
  let updatedStores: Store[];
  if (existingIdx >= 0) {
    updatedStores = currentStores.map(s => s.storeId.toLowerCase() === newStore.storeId.toLowerCase() ? newStore : s);
  } else {
    updatedStores = [...currentStores, newStore];
  }

  saveLocalStores(updatedStores);

  try {
    await setDoc(doc(db, 'stores', newStore.storeId), {
      storeId: newStore.storeId,
      name: newStore.name,
      location: newStore.location || '',
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Offline: Store saved locally and will sync when online.', e);
  }

  return updatedStores;
}

/**
 * Admin action: Deletes a retail store branch.
 */
export async function deleteStore(storeId: string): Promise<Store[]> {
  const currentStores = getLocalStores();
  const updatedStores = currentStores.filter(s => s.storeId !== storeId);

  // If deleted store was the active store, switch active store to first available
  const activeStore = getStoredActiveStore();
  if (activeStore.storeId === storeId) {
    const nextStore = updatedStores[0] || DEFAULT_STORES[0];
    setStoredActiveStore(nextStore);
  }

  saveLocalStores(updatedStores);

  try {
    await deleteDoc(doc(db, 'stores', storeId));
  } catch (e) {
    console.warn('Offline: Store deleted locally and will sync when online.', e);
  }

  return updatedStores;
}

/**
 * Admin action: Updates an existing retail store.
 */
export async function updateStore(updatedStore: Store): Promise<Store[]> {
  const currentStores = getLocalStores();
  const updatedStores = currentStores.map(s => s.storeId === updatedStore.storeId ? updatedStore : s);

  saveLocalStores(updatedStores);

  const activeStore = getStoredActiveStore();
  if (activeStore.storeId === updatedStore.storeId) {
    setStoredActiveStore(updatedStore);
  }

  try {
    await setDoc(doc(db, 'stores', updatedStore.storeId), {
      storeId: updatedStore.storeId,
      name: updatedStore.name,
      location: updatedStore.location || '',
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (e) {
    console.warn('Offline: Store updated locally and will sync when online.', e);
  }

  return updatedStores;
}
