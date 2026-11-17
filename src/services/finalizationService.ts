import {
  AppUser,
  CorrectionRequest,
  CountingSession,
  InventoryCount,
  LocationRecountTask,
  LocationVerification,
  Product,
  Store,
  StoreCountFinalization,
  StoreCountFinalizationStatus,
} from '../types/inventory';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { appendImmutableAuditLog } from './auditService';
import { getLocationVerificationId } from './locationVerificationService';
import { computeVarianceLocationsForRecount } from './recountService';
import {
  DEFAULT_ANNUAL_SESSION_ID,
  doesRecordBelongToSession,
  normalizeCountType,
} from './sessionService';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';

export const LOCAL_FINALIZATIONS_KEY = 'inventory_count_finalizations_cache';

function getSystemDateTime(ts: number = Date.now()) {
  const d = new Date(ts);
  return {
    timestamp: ts,
    date: d.toISOString().split('T')[0],
    time: d.toTimeString().split(' ')[0],
  };
}

export function getCountFinalizationId(storeId: string, sessionId?: string): string {
  const cleanStore = (storeId || 'STORE').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 44);
  const cleanSess = (sessionId || '').trim();
  if (!cleanSess || cleanSess === DEFAULT_ANNUAL_SESSION_ID) {
    return `FIN_${cleanStore}`.slice(0, 120);
  }
  const sessPrefix = cleanSess.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return `FIN_${sessPrefix}_${cleanStore}`.slice(0, 120);
}

export function getLocalCountFinalizations(): StoreCountFinalization[] {
  try {
    const raw = localStorage.getItem(LOCAL_FINALIZATIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error reading local count finalizations:', e);
  }
  return [];
}

export function saveLocalCountFinalizations(list: StoreCountFinalization[]): void {
  try {
    localStorage.setItem(LOCAL_FINALIZATIONS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Error saving local count finalizations:', e);
  }
}

function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function parseFinalizationDoc(id: string, d: Record<string, any>): StoreCountFinalization {
  const status: StoreCountFinalizationStatus =
    d.status === 'finalized' ? 'finalized' : 'counting';
  return {
    id,
    storeId: d.storeId || '',
    storeName: d.storeName || '',
    status,
    finalizedById: d.finalizedById || undefined,
    finalizedByName: d.finalizedByName || undefined,
    finalizedByRole: d.finalizedByRole || undefined,
    finalizedAt: typeof d.finalizedAt === 'number' ? d.finalizedAt : undefined,
    finalizedDate: d.finalizedDate || undefined,
    finalizedTime: d.finalizedTime || undefined,
    reopenedById: d.reopenedById || undefined,
    reopenedByName: d.reopenedByName || undefined,
    reopenedByRole: d.reopenedByRole || undefined,
    reopenedAt: typeof d.reopenedAt === 'number' ? d.reopenedAt : undefined,
    notes: d.notes || undefined,
    countType: normalizeCountType(d.countType),
    sessionId: d.sessionId || DEFAULT_ANNUAL_SESSION_ID,
    cutoffDate: d.cutoffDate || undefined,
  };
}

export function subscribeToCountFinalizations(
  onUpdate: (finalizations: StoreCountFinalization[]) => void
): () => void {
  onUpdate(getLocalCountFinalizations());
  try {
    const q = query(
      collection(db, 'count_finalizations'),
      orderBy('storeId', 'asc'),
      limit(200)
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const list: StoreCountFinalization[] = [];
        snapshot.forEach((docSnap) => {
          list.push(parseFinalizationDoc(docSnap.id, docSnap.data()));
        });
        saveLocalCountFinalizations(list);
        onUpdate(list);
      },
      (error) => {
        console.warn('Realtime count_finalizations listener error:', error);
        onUpdate(getLocalCountFinalizations());
      }
    );
  } catch (err) {
    console.warn('Could not attach count_finalizations listener:', err);
    onUpdate(getLocalCountFinalizations());
    return () => {};
  }
}

export interface StoreFinalizationReadiness {
  storeId: string;
  storeName: string;
  activeCountRecords: number;
  totalLocationsCounted: number;
  verifiedLocationsCount: number;
  pendingLocationsCount: number;
  recountNeededLocationsCount: number;
  inProgressLocationsCount: number;
  detectedVarianceLocationsCount: number;
  unopenedVarianceCount: number;
  openRecountCount: number;
  pendingReviewRecountCount: number;
  verifiedRecountCount: number;
  pendingCorrectionCount: number;
  canFinalize: boolean;
  isFinalized: boolean;
  finalization?: StoreCountFinalization;
  blockingReasons: string[];
}

export function evaluateStoreFinalizationReadiness(params: {
  store: Store;
  counts: InventoryCount[];
  catalog: Product[];
  locationVerifications: LocationVerification[];
  locationRecounts: LocationRecountTask[];
  correctionRequests?: CorrectionRequest[];
  countFinalizations: StoreCountFinalization[];
  session?: CountingSession;
}): StoreFinalizationReadiness {
  const {
    store,
    counts,
    catalog,
    locationVerifications,
    locationRecounts,
    correctionRequests = [],
    countFinalizations,
    session,
  } = params;

  const storeIdLower = store.storeId.trim().toLowerCase();
  const storeNameLower = store.name.trim().toLowerCase();

  const matchesStore = (sId?: string, sName?: string) => {
    const a = (sId || '').trim().toLowerCase();
    const b = (sName || '').trim().toLowerCase();
    return a === storeIdLower || b === storeNameLower;
  };

  const activeCounts = counts.filter(
    (c) =>
      c.status !== 'voided' &&
      matchesStore(c.storeId, c.store) &&
      doesRecordBelongToSession(c, session)
  );

  // Build verification status map for all counted locations + submitted verifications
  const verifById = new Map<string, LocationVerification>();
  locationVerifications.forEach((v) => {
    if (matchesStore(v.storeId, v.storeName) && doesRecordBelongToSession(v, session)) {
      verifById.set(v.id, v);
    }
  });

  const countedLocKeys = new Set<string>();
  activeCounts.forEach((c) => {
    const loc = (c.location || 'Unassigned Location').trim();
    countedLocKeys.add(getLocationVerificationId(store.storeId, loc, session?.id));
  });
  verifById.forEach((_, key) => countedLocKeys.add(key));

  let verifiedLocationsCount = 0;
  let pendingLocationsCount = 0;
  let recountNeededLocationsCount = 0;
  let inProgressLocationsCount = 0;

  countedLocKeys.forEach((key) => {
    const v = verifById.get(key);
    if (!v) {
      inProgressLocationsCount += 1;
    } else if (v.status === 'verified' || v.doneCounting) {
      verifiedLocationsCount += 1;
    } else if (v.status === 'pending_verification') {
      pendingLocationsCount += 1;
    } else if (v.status === 'recount_needed') {
      recountNeededLocationsCount += 1;
    } else {
      inProgressLocationsCount += 1;
    }
  });

  const storeRecounts = locationRecounts.filter(
    (t) => matchesStore(t.storeId, t.storeName) && doesRecordBelongToSession(t, session)
  );
  const detectedVariances = computeVarianceLocationsForRecount({
    counts: activeCounts,
    catalog,
    recountTasks: storeRecounts,
    storeFilterId: store.storeId,
    sessionId: session?.id,
  });

  const unopenedVarianceCount = detectedVariances.filter((d) => !d.existingTask).length;
  const openRecountCount = storeRecounts.filter((t) => t.status === 'open').length;
  const pendingReviewRecountCount = storeRecounts.filter(
    (t) => t.status === 'pending_review'
  ).length;
  const verifiedRecountCount = storeRecounts.filter(
    (t) => t.status === 'verified'
  ).length;

  const pendingCorrectionCount = correctionRequests.filter(
    (r) =>
      r.status === 'pending' &&
      matchesStore(r.storeId, r.store) &&
      doesRecordBelongToSession(r, session)
  ).length;

  const expectedFinId = getCountFinalizationId(store.storeId, session?.id);
  const finalization = countFinalizations.find(
    (f) =>
      f.id === expectedFinId ||
      (matchesStore(f.storeId, f.storeName) && doesRecordBelongToSession(f, session))
  );
  const isFinalized = finalization?.status === 'finalized' || session?.status === 'closed';

  const blockingReasons: string[] = [];
  if (activeCounts.length === 0) {
    blockingReasons.push('No inventory counts have been recorded yet.');
  }
  if (inProgressLocationsCount > 0) {
    blockingReasons.push(
      `${inProgressLocationsCount} location(s) still counting in Round 1 (not yet marked Done Location).`
    );
  }
  if (pendingLocationsCount > 0) {
    blockingReasons.push(
      `${pendingLocationsCount} location(s) awaiting Supervisor Round 1 verification.`
    );
  }
  if (recountNeededLocationsCount > 0) {
    blockingReasons.push(
      `${recountNeededLocationsCount} location(s) flagged for Round 1 recount.`
    );
  }
  if (unopenedVarianceCount > 0) {
    blockingReasons.push(
      `${unopenedVarianceCount} variance location(s) not yet opened for 2nd count.`
    );
  }
  if (openRecountCount > 0) {
    blockingReasons.push(
      `${openRecountCount} 2nd-count location(s) still open for counters.`
    );
  }
  if (pendingReviewRecountCount > 0) {
    blockingReasons.push(
      `${pendingReviewRecountCount} completed 2nd-count location(s) awaiting supervisor verification.`
    );
  }
  if (pendingCorrectionCount > 0) {
    blockingReasons.push(
      `${pendingCorrectionCount} pending correction/void request(s) must be resolved.`
    );
  }

  return {
    storeId: store.storeId,
    storeName: store.name,
    activeCountRecords: activeCounts.length,
    totalLocationsCounted: countedLocKeys.size,
    verifiedLocationsCount,
    pendingLocationsCount,
    recountNeededLocationsCount,
    inProgressLocationsCount,
    detectedVarianceLocationsCount: detectedVariances.length,
    unopenedVarianceCount,
    openRecountCount,
    pendingReviewRecountCount,
    verifiedRecountCount,
    pendingCorrectionCount,
    canFinalize: blockingReasons.length === 0,
    isFinalized,
    finalization,
    blockingReasons,
  };
}

export async function finalizeStoreCounting(params: {
  store: Store;
  actor: AppUser;
  readiness: StoreFinalizationReadiness;
  notes?: string;
  session?: Pick<CountingSession, 'id' | 'countType' | 'cutoffDate'>;
}): Promise<StoreCountFinalization> {
  const { store, actor, readiness, notes, session } = params;

  if (
    actor.role !== 'supervisor' &&
    actor.role !== 'ops_supervisor' &&
    actor.role !== 'admin'
  ) {
    throw new Error('Only Supervisors or Administrators can finalize store counting.');
  }

  if (!readiness.canFinalize) {
    throw new Error(
      readiness.blockingReasons[0] ||
        'Counting cannot be finalized until Round 1 verification and all 2nd counts are done.'
    );
  }

  const resolvedSessionId = session?.id || DEFAULT_ANNUAL_SESSION_ID;
  const resolvedCountType = normalizeCountType(session?.countType);
  const id = getCountFinalizationId(store.storeId, resolvedSessionId);
  const sys = getSystemDateTime();
  const actorName = actor.displayName || actor.email || 'Supervisor';

  const record: StoreCountFinalization = {
    id,
    storeId: store.storeId,
    storeName: store.name,
    status: 'finalized',
    finalizedById: actor.uid,
    finalizedByName: actorName,
    finalizedByRole: actor.role,
    finalizedAt: sys.timestamp,
    finalizedDate: sys.date,
    finalizedTime: sys.time,
    notes: notes?.trim() || undefined,
    countType: resolvedCountType,
    sessionId: resolvedSessionId,
    cutoffDate: session?.cutoffDate,
  };

  const existing = getLocalCountFinalizations().filter((f) => f.id !== id);
  saveLocalCountFinalizations([record, ...existing]);

  try {
    await setDoc(doc(db, 'count_finalizations', id), stripUndefined(record));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `count_finalizations/${id}`);
    }
    throw err instanceof Error ? err : new Error('Failed to finalize store counting.');
  }

  await appendImmutableAuditLog({
    inventoryCountId: id,
    store: store.name,
    storeId: store.storeId,
    sku: 'COUNT-FINALIZE',
    itemDescription: `Store Counting Finalized: ${store.name} (${store.storeId})`,
    location: 'All Locations',
    originalValue: `1st Count Verified: ${readiness.verifiedLocationsCount}, 2nd Counts Done: ${readiness.verifiedRecountCount}`,
    newValue: 'Finalized — System Balance Unlocked for Supervisors',
    action: 'COUNT_FINALIZED',
    approvalStatus: 'Approved',
    reason:
      notes?.trim() ||
      `Finalized after all Round 1 verifications (${readiness.verifiedLocationsCount}) and 2nd counts (${readiness.verifiedRecountCount}) were verified.`,
    requestedBy: actorName,
    requestedById: actor.uid,
    reviewedBy: actorName,
    reviewedById: actor.uid,
    countType: resolvedCountType,
    sessionId: resolvedSessionId,
    cutoffDate: session?.cutoffDate,
  });

  return record;
}

export async function reopenStoreCounting(params: {
  store: Store;
  adminUser: AppUser;
  existingFinalization?: StoreCountFinalization;
  notes?: string;
  session?: Pick<CountingSession, 'id' | 'countType' | 'cutoffDate'>;
}): Promise<StoreCountFinalization> {
  const { store, adminUser, existingFinalization, notes, session } = params;

  if (adminUser.role !== 'admin') {
    throw new Error('Only Administrators can re-open finalized store counting.');
  }

  const resolvedSessionId =
    existingFinalization?.sessionId || session?.id || DEFAULT_ANNUAL_SESSION_ID;
  const resolvedCountType = normalizeCountType(
    existingFinalization?.countType || session?.countType
  );
  const resolvedCutoff = existingFinalization?.cutoffDate || session?.cutoffDate;
  const id =
    existingFinalization?.id ||
    getCountFinalizationId(store.storeId, resolvedSessionId);
  const sys = getSystemDateTime();
  const adminName = adminUser.displayName || adminUser.email || 'Administrator';

  const record: StoreCountFinalization = {
    ...(existingFinalization || {
      id,
      storeId: store.storeId,
      storeName: store.name,
    }),
    id,
    storeId: store.storeId,
    storeName: store.name,
    status: 'counting',
    reopenedById: adminUser.uid,
    reopenedByName: adminName,
    reopenedByRole: 'admin',
    reopenedAt: sys.timestamp,
    notes: notes?.trim() || undefined,
    countType: resolvedCountType,
    sessionId: resolvedSessionId,
    cutoffDate: resolvedCutoff,
  };

  const existing = getLocalCountFinalizations().filter((f) => f.id !== id);
  saveLocalCountFinalizations([record, ...existing]);

  try {
    await setDoc(doc(db, 'count_finalizations', id), stripUndefined(record));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `count_finalizations/${id}`);
    }
    throw err instanceof Error ? err : new Error('Failed to re-open store counting.');
  }

  await appendImmutableAuditLog({
    inventoryCountId: id,
    store: store.name,
    storeId: store.storeId,
    sku: 'COUNT-REOPEN',
    itemDescription: `Store Counting Re-opened: ${store.name} (${store.storeId})`,
    location: 'All Locations',
    originalValue: 'Status: Finalized',
    newValue: 'Status: Counting in Progress (System Balance Locked for Supervisors)',
    action: 'COUNT_REOPENED',
    approvalStatus: 'N/A',
    reason:
      notes?.trim() ||
      `Administrator re-opened counting for ${store.name}; supervisor system balance view locked.`,
    requestedBy: adminName,
    requestedById: adminUser.uid,
    reviewedBy: adminName,
    reviewedById: adminUser.uid,
    countType: resolvedCountType,
    sessionId: resolvedSessionId,
    cutoffDate: resolvedCutoff,
  });

  return record;
}
