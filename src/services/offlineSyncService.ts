import { InventoryCount } from '../types/inventory';
import { db } from '../firebase/config';
import { recordCountSubmittedAuditLog } from './auditService';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
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
  const qty = Number(d.countedQuantity) || 0;
  const loc = d.location || '';
  const cond = d.condition === 'Damage' ? 'Damage' : 'Good';
  const rem = d.remarks || '';

  return {
    id,
    username: d.username || 'Associate',
    userId: d.userId || '',
    store: d.store || '',
    storeId: d.storeId || '',
    sku: d.sku || '',
    barcode: d.barcode || '',
    itemDescription: d.itemDescription || '',
    countedQuantity: qty,
    condition: cond,
    remarks: rem,
    location: loc,
    date: d.date || '',
    time: d.time || '',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    syncStatus: 'synced',
    status: d.status === 'voided' ? 'voided' : 'active',
    originalQuantity: typeof d.originalQuantity === 'number' ? d.originalQuantity : qty,
    originalLocation: d.originalLocation !== undefined ? d.originalLocation : loc,
    originalCondition: d.originalCondition === 'Damage' || d.originalCondition === 'Good' ? d.originalCondition : cond,
    originalRemarks: d.originalRemarks !== undefined ? d.originalRemarks : rem,
    version: typeof d.version === 'number' && d.version >= 1 ? d.version : 1,
    lastModifiedAt: d.lastModifiedAt,
    lastModifiedBy: d.lastModifiedBy,
    voidedAt: d.voidedAt,
    voidedBy: d.voidedBy,
    voidReason: d.voidReason,
  };
}

/**
 * Saves a new count record.
 * Writes immediately to local storage, attempts Firestore sync, and logs an immutable audit event.
 */
export async function recordCount(
  countData: Omit<InventoryCount, 'id' | 'createdAt' | 'syncStatus'>
): Promise<InventoryCount> {
  const id = `cnt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const initialQty = Number(countData.countedQuantity) || 0;
  const initialLoc = countData.location || '';
  const initialCond = countData.condition || 'Good';
  const initialRemarks = countData.remarks || '';

  const newCount: InventoryCount = {
    ...countData,
    id,
    createdAt: now,
    syncStatus: 'pending',
    status: 'active',
    version: 1,
    originalQuantity: initialQty,
    originalLocation: initialLoc,
    originalCondition: initialCond,
    originalRemarks: initialRemarks,
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

  const saved = getLocalCounts().find((c) => c.id === id) || newCount;

  // 4. Record immutable COUNT_SUBMITTED audit log entry
  await recordCountSubmittedAuditLog(saved);

  return saved;
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
        status: item.status === 'voided' ? 'voided' : 'active',
        version: item.version || 1,
        originalQuantity:
          typeof item.originalQuantity === 'number'
            ? item.originalQuantity
            : Number(item.countedQuantity) || 0,
        originalLocation:
          item.originalLocation !== undefined ? item.originalLocation : item.location || '',
        originalCondition: item.originalCondition || (item.condition === 'Damage' ? 'Damage' : 'Good'),
        originalRemarks: item.originalRemarks !== undefined ? item.originalRemarks : item.remarks || '',
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

/**
 * Idempotent migration for legacy inventory_counts docs lacking status/version/original* fields.
 */
export async function migrateLegacyCountRecords(): Promise<void> {
  try {
    if (localStorage.getItem('inventory_counts_v2_migrated') === 'true') return;
    const snapshot = await getDocs(collection(db, 'inventory_counts'));
    let migrated = 0;
    for (const docSnap of snapshot.docs) {
      const d = docSnap.data();
      if (d.status === undefined || d.version === undefined || d.originalQuantity === undefined) {
        await updateDoc(doc(db, 'inventory_counts', docSnap.id), {
          status: d.status === 'voided' ? 'voided' : 'active',
          version: typeof d.version === 'number' && d.version >= 1 ? d.version : 1,
          originalQuantity:
            typeof d.originalQuantity === 'number'
              ? d.originalQuantity
              : Number(d.countedQuantity) || 0,
          originalLocation: d.originalLocation !== undefined ? d.originalLocation : d.location || '',
          originalCondition: d.originalCondition || (d.condition === 'Damage' ? 'Damage' : 'Good'),
          originalRemarks: d.originalRemarks !== undefined ? d.originalRemarks : d.remarks || '',
        });
        migrated++;
      }
    }
    localStorage.setItem('inventory_counts_v2_migrated', 'true');
    if (migrated > 0) {
      console.info(`Migrated ${migrated} legacy inventory count records to v2 schema.`);
    }
  } catch (err) {
    console.warn('Legacy count migration skipped or deferred:', err);
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
