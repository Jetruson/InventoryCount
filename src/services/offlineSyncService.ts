import { InventoryCount } from '../types/inventory';
import { db } from '../firebase/config';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';

const LOCAL_COUNTS_KEY = 'inventory_counts_local_history';
const PENDING_QUEUE_KEY = 'inventory_counts_pending_sync_queue';

export function getLocalCounts(): InventoryCount[] {
  try {
    const raw = localStorage.getItem(LOCAL_COUNTS_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed reading local counts:', e);
  }
  return [];
}

export function saveLocalCounts(counts: InventoryCount[]): void {
  try {
    localStorage.setItem(LOCAL_COUNTS_KEY, JSON.stringify(counts));
  } catch (e) {
    console.error('Failed writing local counts:', e);
  }
}

export function getPendingQueue(): InventoryCount[] {
  try {
    const raw = localStorage.getItem(PENDING_QUEUE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed reading pending queue:', e);
  }
  return [];
}

export function savePendingQueue(queue: InventoryCount[]): void {
  try {
    localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Failed saving pending queue:', e);
  }
}

export type SyncCallback = (status: {
  pendingCount: number;
  isSyncing: boolean;
  lastSyncedAt?: number;
  error?: string | null;
}) => void;

const listeners: Set<SyncCallback> = new Set();
let isSyncing = false;
let lastSyncError: string | null = null;

export function subscribeToSyncStatus(cb: SyncCallback): () => void {
  listeners.add(cb);
  cb({
    pendingCount: getPendingQueue().length,
    isSyncing,
    error: lastSyncError,
  });
  return () => {
    listeners.delete(cb);
  };
}

function notifyListeners(error: string | null = null) {
  lastSyncError = error;
  const pending = getPendingQueue().length;
  listeners.forEach(cb => cb({
    pendingCount: pending,
    isSyncing,
    lastSyncedAt: Date.now(),
    error,
  }));
}

function mergeWithPendingQueue(firestoreItems: InventoryCount[]): InventoryCount[] {
  const pending = getPendingQueue();
  const map = new Map<string, InventoryCount>();

  firestoreItems.forEach(item => map.set(item.id, item));
  pending.forEach(item => map.set(item.id, { ...item, syncStatus: 'pending' }));

  const merged = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  saveLocalCounts(merged);
  return merged;
}

function parseCountDoc(id: string, d: Record<string, any>): InventoryCount {
  return {
    id,
    username: d.username || 'Associate',
    userId: d.userId || '',
    store: d.store || '',
    storeId: d.storeId || '',
    sku: d.sku || '',
    barcode: d.barcode || '',
    itemDescription: d.itemDescription || '',
    countedQuantity: Number(d.countedQuantity) || 0,
    condition: d.condition === 'Damage' ? 'Damage' : 'Good',
    remarks: d.remarks || '',
    location: d.location || '',
    date: d.date || '',
    time: d.time || '',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    syncStatus: 'synced',
  };
}

/**
 * Saves a new count record.
 * Writes immediately to local storage and attempts Firestore sync.
 * If offline or write fails, preserves in pending queue.
 */
export async function recordCount(countData: Omit<InventoryCount, 'id' | 'createdAt' | 'syncStatus'>): Promise<InventoryCount> {
  const id = `cnt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  const newCount: InventoryCount = {
    ...countData,
    id,
    createdAt: now,
    syncStatus: 'pending',
  };

  // 1. Save to local history immediately
  const existingHistory = getLocalCounts();
  saveLocalCounts([newCount, ...existingHistory]);

  // 2. Add to pending queue
  const currentQueue = getPendingQueue();
  savePendingQueue([...currentQueue, newCount]);
  notifyListeners();

  // 3. Try flushing immediately if online (works for both Google & credential-logged sessions)
  if (typeof navigator === 'undefined' || navigator.onLine) {
    await syncPendingCounts();
  }

  return getLocalCounts().find(c => c.id === id) || newCount;
}

/**
 * Synchronizes all pending count records with Firestore
 */
export async function syncPendingCounts(): Promise<{ synced: number; remaining: number; error?: string | null }> {
  if (isSyncing) return { synced: 0, remaining: getPendingQueue().length, error: lastSyncError };
  const queue = getPendingQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0, error: null };

  isSyncing = true;
  notifyListeners(null);

  const remaining: InventoryCount[] = [];
  let syncedCount = 0;
  let errorMsg: string | null = null;

  for (const item of queue) {
    try {
      const docRef = doc(db, 'inventory_counts', item.id);
      await setDoc(docRef, {
        id: item.id,
        username: item.username || 'Counter',
        userId: item.userId || item.username || 'device-user',
        store: item.store || 'Unknown Store',
        storeId: item.storeId || '',
        sku: item.sku || 'UNKNOWN',
        barcode: item.barcode || item.sku || '',
        itemDescription: item.itemDescription || '',
        countedQuantity: Number(item.countedQuantity) || 0,
        condition: item.condition === 'Damage' ? 'Damage' : 'Good',
        remarks: item.remarks || '',
        location: item.location || '',
        date: item.date,
        time: item.time,
        createdAt: item.createdAt,
      });

      // Update syncStatus in local history
      const history = getLocalCounts();
      const updated = history.map(h => h.id === item.id ? { ...h, syncStatus: 'synced' as const } : h);
      saveLocalCounts(updated);
      syncedCount++;
    } catch (err: any) {
      errorMsg = err?.message || 'Cloud sync failed';
      console.warn(`Failed syncing count ${item.id} to Firestore. Kept in queue:`, err);
      remaining.push(item);
    }
  }

  savePendingQueue(remaining);
  isSyncing = false;
  notifyListeners(errorMsg);

  return { synced: syncedCount, remaining: remaining.length, error: errorMsg };
}

/**
 * Fetches all counts from Firestore (with local merge)
 */
export async function fetchAllCounts(): Promise<InventoryCount[]> {
  try {
    const q = query(collection(db, 'inventory_counts'), orderBy('createdAt', 'desc'), limit(1000));
    const snapshot = await getDocs(q);
    const firestoreItems: InventoryCount[] = [];

    snapshot.forEach(docSnap => {
      firestoreItems.push(parseCountDoc(docSnap.id, docSnap.data()));
    });

    return mergeWithPendingQueue(firestoreItems);
  } catch (err) {
    console.warn('Network or permission issue fetching counts. Returning local cached counts:', err);
    return getLocalCounts();
  }
}

/**
 * Subscribes to live Firestore count updates across all devices.
 */
export function subscribeToCounts(onUpdate: (counts: InventoryCount[]) => void): () => void {
  try {
    const q = query(collection(db, 'inventory_counts'), orderBy('createdAt', 'desc'), limit(1000));
    return onSnapshot(
      q,
      (snapshot) => {
        const firestoreItems: InventoryCount[] = [];
        snapshot.forEach(docSnap => {
          firestoreItems.push(parseCountDoc(docSnap.id, docSnap.data()));
        });
        const merged = mergeWithPendingQueue(firestoreItems);
        onUpdate(merged);
      },
      (err) => {
        console.warn('Realtime counts listener error:', err);
        onUpdate(getLocalCounts());
      }
    );
  } catch (err) {
    console.warn('Could not attach realtime counts listener:', err);
    onUpdate(getLocalCounts());
    return () => {};
  }
}

// Global online & focus listeners to auto-sync when network returns or app returns to foreground
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncPendingCounts();
  });
  window.addEventListener('focus', () => {
    if (navigator.onLine) {
      syncPendingCounts();
    }
  });
}
