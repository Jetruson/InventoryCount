import { Store } from '../types/inventory';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';

export const DEFAULT_STORES: Store[] = [
  { storeId: 'ST-101', name: 'Downtown Flagship', location: '100 Main Street' },
  { storeId: 'ST-102', name: 'Westfield Galleria', location: '450 Galleria Mall, Fl 2' },
  { storeId: 'ST-103', name: 'Metro Supercenter', location: '780 Industrial Pkwy' },
  { storeId: 'ST-104', name: 'Harbor Outlet Store', location: '12 Waterfront Ave' },
  { storeId: 'ST-105', name: 'Airport Express Kiosk', location: 'Terminal 3 Concourse B' },
];

const ACTIVE_STORE_KEY = 'inventory_count_active_store';

export function getStoredActiveStore(): Store {
  try {
    const raw = localStorage.getItem(ACTIVE_STORE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading active store:', e);
  }
  return DEFAULT_STORES[0];
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
      return stores;
    }
  } catch (e) {
    console.warn('Using default preloaded stores list:', e);
  }
  return DEFAULT_STORES;
}

export async function seedStoresIfEmpty(): Promise<void> {
  try {
    const snapshot = await getDocs(collection(db, 'stores'));
    if (snapshot.empty) {
      for (const st of DEFAULT_STORES) {
        await setDoc(doc(db, 'stores', st.storeId), st);
      }
    }
  } catch (e) {
    // Non-fatal if offline or restricted
    console.warn('Store seeding skipped or offline:', e);
  }
}
