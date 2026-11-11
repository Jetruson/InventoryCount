import { InventoryCount } from '../types/inventory';
import { db, auth, handleFirestoreError, OperationType } from '../firebase/config';
import { collection, doc, setDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';

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

export function subscribeToSyncStatus(cb: SyncCallback): () => void {
  listeners.add(cb);
  cb({
    pendingCount: getPendingQueue().length,
    isSyncing,
  });
  return () => {
    listeners.delete(cb);
  };
}

function notifyListeners(error: string | null = null) {
  const pending = getPendingQueue().length;
  listeners.forEach(cb => cb({
    pendingCount: pending,
    isSyncing,
    lastSyncedAt: Date.now(),
    error,
  }));
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

  // 3. Try flushing immediately if online
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    syncPendingCounts();
  }

  return newCount;
}

/**
 * Synchronizes all pending count records with Firestore
 */
export async function syncPendingCounts(): Promise<{ synced: number; remaining: number }> {
  if (isSyncing) return { synced: 0, remaining: getPendingQueue().length };
  const queue = getPendingQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };

  // Wait until user is authenticated with Firebase before syncing to Firestore
  if (!auth.currentUser) {
    return { synced: 0, remaining: queue.length };
  }

  isSyncing = true;
  notifyListeners();

  const remaining: InventoryCount[] = [];
  let syncedCount = 0;

  for (const item of queue) {
    try {
      const docRef = doc(db, 'inventory_counts', item.id);
      await setDoc(docRef, {
        id: item.id,
        username: item.username,
        userId: item.userId,
        store: item.store,
        storeId: item.storeId,
        sku: item.sku,
        barcode: item.barcode,
        itemDescription: item.itemDescription,
        countedQuantity: Number(item.countedQuantity),
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
    } catch (err) {
      console.warn(`Failed syncing count ${item.id} to Firestore. Kept in queue:`, err);
      remaining.push(item);
    }
  }

  savePendingQueue(remaining);
  isSyncing = false;
  notifyListeners();

  return { synced: syncedCount, remaining: remaining.length };
}

/**
 * Fetches all counts from Firestore (with local merge)
 */
export async function fetchAllCounts(): Promise<InventoryCount[]> {
  if (!auth.currentUser) {
    return getLocalCounts();
  }

  try {
    const q = query(collection(db, 'inventory_counts'), orderBy('createdAt', 'desc'), limit(500));
    const snapshot = await getDocs(q);
    const firestoreItems: InventoryCount[] = [];
    
    snapshot.forEach(docSnap => {
      const d = docSnap.data();
      firestoreItems.push({
        id: docSnap.id,
        username: d.username,
        userId: d.userId,
        store: d.store,
        storeId: d.storeId || '',
        sku: d.sku,
        barcode: d.barcode || '',
        itemDescription: d.itemDescription || '',
        countedQuantity: Number(d.countedQuantity),
        remarks: d.remarks || '',
        location: d.location || '',
        date: d.date,
        time: d.time,
        createdAt: d.createdAt || Date.now(),
        syncStatus: 'synced',
      });
    });

    // Merge with local pending queue so un-synced local counts remain visible
    const pending = getPendingQueue();
    const map = new Map<string, InventoryCount>();
    
    // Add firestore records
    firestoreItems.forEach(item => map.set(item.id, item));
    // Overlay local pending
    pending.forEach(item => map.set(item.id, { ...item, syncStatus: 'pending' }));

    const merged = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
    saveLocalCounts(merged);
    return merged;
  } catch (err) {
    console.warn('Network or permission issue fetching counts. Returning local cached counts:', err);
    return getLocalCounts();
  }
}

// Global online listener to auto-sync when network returns
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('Device returned online. Flushing offline count queue...');
    syncPendingCounts();
  });
}
