import {
  AppUser,
  CountingSession,
  InventoryCount,
  LocationRecountStatus,
  LocationRecountTask,
  ManagedUser,
  Product,
  VarianceSkuTarget,
} from '../types/inventory';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { appendImmutableAuditLog } from './auditService';
import { DEFAULT_ANNUAL_SESSION_ID, normalizeCountType } from './sessionService';
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';

const LOCAL_RECOUNTS_KEY = 'inventory_location_recounts_cache';

function getSystemDateTime(ts: number = Date.now()) {
  const d = new Date(ts);
  return {
    timestamp: ts,
    date: d.toISOString().split('T')[0],
    time: d.toTimeString().split(' ')[0],
  };
}

function hashLocationString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export function getLocationRecountId(
  storeId: string,
  location: string,
  sessionId?: string
): string {
  const cleanStore = (storeId || 'STORE').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 28);
  const normalizedLoc = (location || 'UNASSIGNED').trim().toLowerCase();
  const cleanSess = (sessionId || '').trim();
  if (!cleanSess || cleanSess === DEFAULT_ANNUAL_SESSION_ID) {
    const cleanLoc = normalizedLoc.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    const hash = hashLocationString(`${storeId.trim().toLowerCase()}::${normalizedLoc}`);
    return `RECNT_${cleanStore}_${cleanLoc}_${hash}`.slice(0, 120);
  }
  const sessPrefix = cleanSess.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 26);
  const cleanLoc = normalizedLoc.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
  const hash = hashLocationString(
    `${cleanSess.toLowerCase()}::${storeId.trim().toLowerCase()}::${normalizedLoc}`
  );
  return `RECNT_${sessPrefix}_${cleanStore}_${cleanLoc}_${hash}`.slice(0, 120);
}

export function getLocalLocationRecounts(): LocationRecountTask[] {
  try {
    const raw = localStorage.getItem(LOCAL_RECOUNTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error reading local location recounts:', e);
  }
  return [];
}

export function saveLocalLocationRecounts(list: LocationRecountTask[]): void {
  try {
    localStorage.setItem(LOCAL_RECOUNTS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Error saving local location recounts:', e);
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

function parseRecountDoc(id: string, d: Record<string, any>): LocationRecountTask {
  const status: LocationRecountStatus =
    d.status === 'pending_review' || d.status === 'verified' ? d.status : 'open';

  return {
    id,
    storeId: d.storeId || '',
    storeName: d.storeName || '',
    location: d.location || '',
    status,
    varianceSkus: Array.isArray(d.varianceSkus) ? d.varianceSkus : [],
    excludedCounterIds: Array.isArray(d.excludedCounterIds) ? d.excludedCounterIds : [],
    excludedCounterNames: Array.isArray(d.excludedCounterNames) ? d.excludedCounterNames : [],
    openedById: d.openedById || '',
    openedByName: d.openedByName || 'Supervisor',
    openedByRole: d.openedByRole || 'supervisor',
    openedAt: typeof d.openedAt === 'number' ? d.openedAt : Date.now(),
    openedDate: d.openedDate || '',
    openedTime: d.openedTime || '',
    assignedCounterId: d.assignedCounterId || undefined,
    assignedCounterName: d.assignedCounterName || undefined,
    assignedCounterRole: d.assignedCounterRole || undefined,
    assignedById: d.assignedById || undefined,
    assignedByName: d.assignedByName || undefined,
    assignedAt: typeof d.assignedAt === 'number' ? d.assignedAt : undefined,
    submittedById: d.submittedById,
    submittedByName: d.submittedByName,
    submittedByRole: d.submittedByRole,
    submittedAt: d.submittedAt,
    submittedDate: d.submittedDate,
    submittedTime: d.submittedTime,
    counterNotes: d.counterNotes || '',
    verifiedById: d.verifiedById,
    verifiedByName: d.verifiedByName,
    verifiedByRole: d.verifiedByRole,
    verifiedAt: d.verifiedAt,
    verifiedDate: d.verifiedDate,
    verifiedTime: d.verifiedTime,
    supervisorNotes: d.supervisorNotes || '',
    countType: normalizeCountType(d.countType),
    sessionId: d.sessionId || DEFAULT_ANNUAL_SESSION_ID,
    cutoffDate: d.cutoffDate || undefined,
  };
}

export function subscribeToLocationRecounts(
  onUpdate: (recounts: LocationRecountTask[]) => void
): () => void {
  try {
    const q = query(
      collection(db, 'location_recounts'),
      orderBy('openedAt', 'desc'),
      limit(500)
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const list: LocationRecountTask[] = [];
        snapshot.forEach((docSnap) => {
          list.push(parseRecountDoc(docSnap.id, docSnap.data()));
        });
        saveLocalLocationRecounts(list);
        onUpdate(list);
      },
      (err) => {
        console.warn('Realtime location_recounts listener error:', err);
        onUpdate(getLocalLocationRecounts());
      }
    );
  } catch (err) {
    console.warn('Could not attach location_recounts listener:', err);
    onUpdate(getLocalLocationRecounts());
    return () => {};
  }
}

/**
 * Collects all associate userIds & displayNames who recorded any active Round 1 count
 * at the given (storeId, location).
 */
export function getRound1CountersForLocation(
  counts: InventoryCount[],
  storeId: string,
  location: string
): { excludedCounterIds: string[]; excludedCounterNames: string[] } {
  const normStore = storeId.trim().toLowerCase();
  const normLoc = location.trim().toLowerCase();
  const ids = new Set<string>();
  const names = new Set<string>();

  counts.forEach((c) => {
    if (c.status === 'voided') return;
    if ((c.countRound ?? 1) !== 1) return;
    const matchesStore =
      c.storeId.trim().toLowerCase() === normStore ||
      c.store.trim().toLowerCase() === normStore;
    const matchesLoc = (c.location || '').trim().toLowerCase() === normLoc;
    if (!matchesStore || !matchesLoc) return;

    if (c.userId) ids.add(c.userId);
    if (c.username) names.add(c.username.trim());
  });

  return {
    excludedCounterIds: Array.from(ids),
    excludedCounterNames: Array.from(names),
  };
}

/**
 * Segregation of duties check: blocks any user who counted a location in Round 1
 * from recounting that same location in Round 2.
 */
export function isUserExcludedFromLocationRecount(params: {
  user: AppUser;
  storeId: string;
  location: string;
  counts: InventoryCount[];
  task?: LocationRecountTask;
}): { excluded: boolean; reason?: string; excludedNames: string[] } {
  const { user, storeId, location, counts, task } = params;
  const live = getRound1CountersForLocation(counts, storeId, location);

  const idSet = new Set<string>([
    ...(task?.excludedCounterIds || []),
    ...live.excludedCounterIds,
  ]);
  const nameList = Array.from(
    new Set<string>([...(task?.excludedCounterNames || []), ...live.excludedCounterNames])
  );
  const normNames = new Set(nameList.map((n) => n.trim().toLowerCase()).filter(Boolean));

  const userDisplay = (user.displayName || '').trim().toLowerCase();
  const userEmailPrefix = (user.email || '').split('@')[0].trim().toLowerCase();

  const matchesById = Boolean(user.uid && idSet.has(user.uid));
  const matchesByName =
    (Boolean(userDisplay) && normNames.has(userDisplay)) ||
    (Boolean(userEmailPrefix) && normNames.has(userEmailPrefix));

  if (matchesById || matchesByName) {
    return {
      excluded: true,
      excludedNames: nameList,
      reason: `You recorded 1st-count items at "${location}". Segregation of duties requires a different associate who did not count this location in Round 1 to perform the Second Count.`,
    };
  }

  return { excluded: false, excludedNames: nameList };
}

function isManagedUserExcluded(
  candidate: ManagedUser,
  excludedIdSet: Set<string>,
  normExcludedNames: Set<string>
): boolean {
  if (candidate.id && excludedIdSet.has(candidate.id)) return true;
  const disp = (candidate.displayName || '').trim().toLowerCase();
  const user = (candidate.username || '').trim().toLowerCase();
  const userPrefix = user.split('@')[0].trim();
  return (
    (Boolean(disp) && normExcludedNames.has(disp)) ||
    (Boolean(user) && normExcludedNames.has(user)) ||
    (Boolean(userPrefix) && normExcludedNames.has(userPrefix))
  );
}

/**
 * Returns active counters (store-scoped `counter` + multi-store `ops_counter`) partitioned into
 * eligible vs Round-1-excluded for a given store & location.
 */
export function getEligibleCountersForLocationRecount(params: {
  storeId: string;
  location: string;
  counts: InventoryCount[];
  managedUsers: ManagedUser[];
  task?: LocationRecountTask;
}): {
  eligibleCounters: ManagedUser[];
  excludedCounters: ManagedUser[];
  excludedIds: string[];
  excludedNames: string[];
} {
  const { storeId, location, counts, managedUsers, task } = params;
  const live = getRound1CountersForLocation(counts, storeId, location);
  const excludedIds = Array.from(
    new Set<string>([...(task?.excludedCounterIds || []), ...live.excludedCounterIds])
  );
  const excludedNames = Array.from(
    new Set<string>([...(task?.excludedCounterNames || []), ...live.excludedCounterNames])
  );
  const excludedIdSet = new Set(excludedIds);
  const normExcludedNames = new Set(
    excludedNames.map((n) => n.trim().toLowerCase()).filter(Boolean)
  );
  const normStoreId = (storeId || '').trim().toLowerCase();

  const candidates = managedUsers.filter((u) => {
    if (u.isActive === false) return false;
    if (u.role !== 'counter' && u.role !== 'ops_counter') return false;
    if (u.role === 'ops_counter') return true;
    const assigned = (u.assignedStoreId || '').trim().toLowerCase();
    return assigned === 'all' || assigned === normStoreId;
  });

  const eligibleCounters: ManagedUser[] = [];
  const excludedCounters: ManagedUser[] = [];

  candidates.forEach((u) => {
    if (isManagedUserExcluded(u, excludedIdSet, normExcludedNames)) {
      excludedCounters.push(u);
    } else {
      eligibleCounters.push(u);
    }
  });

  const sortCounters = (a: ManagedUser, b: ManagedUser) => {
    if (a.role !== b.role) return a.role === 'counter' ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  };

  return {
    eligibleCounters: eligibleCounters.sort(sortCounters),
    excludedCounters: excludedCounters.sort(sortCounters),
    excludedIds,
    excludedNames,
  };
}

export interface RecountAccessResult {
  allowed: boolean;
  lockType?: 'excluded_round1' | 'assigned_other';
  assignedToCurrentUser: boolean;
  reason?: string;
  excludedNames: string[];
}

/**
 * Full per-location Round 2 access check:
 * 1) Segregation of duties: Round 1 counters are never allowed.
 * 2) Supervisor Ops counter assignment: if a specific counter is assigned, only that counter can recount.
 */
export function getRecountAccessForUser(params: {
  user: AppUser;
  storeId: string;
  location: string;
  counts: InventoryCount[];
  task?: LocationRecountTask;
}): RecountAccessResult {
  const { user, storeId, location, counts, task } = params;
  const exclusion = isUserExcludedFromLocationRecount({
    user,
    storeId,
    location,
    counts,
    task,
  });

  if (exclusion.excluded) {
    return {
      allowed: false,
      lockType: 'excluded_round1',
      assignedToCurrentUser: false,
      reason: exclusion.reason,
      excludedNames: exclusion.excludedNames,
    };
  }

  if (task?.assignedCounterId) {
    const userDisplay = (user.displayName || '').trim().toLowerCase();
    const userEmailPrefix = (user.email || '').split('@')[0].trim().toLowerCase();
    const assignedNameLower = (task.assignedCounterName || '').trim().toLowerCase();

    const matchesAssigned =
      user.uid === task.assignedCounterId ||
      (Boolean(assignedNameLower) &&
        (userDisplay === assignedNameLower || userEmailPrefix === assignedNameLower));

    if (!matchesAssigned) {
      return {
        allowed: false,
        lockType: 'assigned_other',
        assignedToCurrentUser: false,
        reason: `Assigned to ${task.assignedCounterName || 'another counter'} by ${
          task.assignedByName || 'Supervisor Ops'
        }. Only the assigned counter can perform the 2nd count for "${location}".`,
        excludedNames: exclusion.excludedNames,
      };
    }

    return {
      allowed: true,
      assignedToCurrentUser: true,
      excludedNames: exclusion.excludedNames,
    };
  }

  return {
    allowed: true,
    assignedToCurrentUser: false,
    excludedNames: exclusion.excludedNames,
  };
}

export interface DetectedVarianceLocation {
  id: string;
  storeId: string;
  storeName: string;
  location: string;
  varianceSkus: VarianceSkuTarget[];
  excludedCounterIds: string[];
  excludedCounterNames: string[];
  totalVarianceUnits: number;
  existingTask?: LocationRecountTask;
}

/**
 * Detects per-location SKU variances by comparing Round 1 active counts against Masterlist systemStock.
 */
export function computeVarianceLocationsForRecount(params: {
  counts: InventoryCount[];
  catalog: Product[];
  recountTasks: LocationRecountTask[];
  storeFilterId?: string;
  sessionId?: string;
}): DetectedVarianceLocation[] {
  const { counts, catalog, recountTasks, storeFilterId, sessionId } = params;

  const catalogBySku = new Map<string, Product>();
  catalog.forEach((p) => {
    catalogBySku.set(p.sku.trim().toLowerCase(), p);
  });

  const activeRound1 = counts.filter(
    (c) => c.status !== 'voided' && (c.countRound ?? 1) === 1
  );

  // 1. Group Round 1 totals by (storeId, sku)
  const storeSkuTotals = new Map<string, number>();
  activeRound1.forEach((c) => {
    if (storeFilterId && storeFilterId !== 'all' && c.storeId !== storeFilterId) return;
    const key = `${c.storeId}::${c.sku.trim().toLowerCase()}`;
    storeSkuTotals.set(key, (storeSkuTotals.get(key) || 0) + (Number(c.countedQuantity) || 0));
  });

  // 2. Map locations where variance SKUs were counted in Round 1
  interface LocAcc {
    id: string;
    storeId: string;
    storeName: string;
    location: string;
    skuMap: Map<string, VarianceSkuTarget>;
    excludedCounterIds: Set<string>;
    excludedCounterNames: Set<string>;
  }

  const locationMap = new Map<string, LocAcc>();

  activeRound1.forEach((c) => {
    if (storeFilterId && storeFilterId !== 'all' && c.storeId !== storeFilterId) return;
    const skuKey = c.sku.trim().toLowerCase();
    const storeSkuKey = `${c.storeId}::${skuKey}`;
    const storeTotal = storeSkuTotals.get(storeSkuKey) || 0;
    const prod = catalogBySku.get(skuKey);
    const systemStock = prod?.systemStock ?? 0;
    const storeVariance = storeTotal - systemStock;

    if (storeVariance === 0) return;

    const loc = (c.location || 'Unassigned Location').trim();
    const taskId = getLocationRecountId(c.storeId, loc, sessionId || c.sessionId);

    const acc = locationMap.get(taskId) || {
      id: taskId,
      storeId: c.storeId,
      storeName: c.store || c.storeId,
      location: loc,
      skuMap: new Map<string, VarianceSkuTarget>(),
      excludedCounterIds: new Set<string>(),
      excludedCounterNames: new Set<string>(),
    };

    const existingTarget = acc.skuMap.get(skuKey) || {
      sku: c.sku,
      barcode: prod?.barcode || c.barcode || c.sku,
      description: prod?.description || c.itemDescription || 'Catalog Item',
      unit: prod?.unit || 'pcs',
      systemStock,
      firstCountQty: 0,
      variance: storeVariance,
    };
    existingTarget.firstCountQty += Number(c.countedQuantity) || 0;
    acc.skuMap.set(skuKey, existingTarget);

    locationMap.set(taskId, acc);
  });

  // Ensure ALL Round 1 counters who touched any item in a flagged location are excluded
  // (even if they scanned non-variance items in that same location)
  activeRound1.forEach((c) => {
    const loc = (c.location || 'Unassigned Location').trim();
    const taskId = getLocationRecountId(c.storeId, loc, sessionId || c.sessionId);
    const acc = locationMap.get(taskId);
    if (!acc) return;
    if (c.userId) acc.excludedCounterIds.add(c.userId);
    if (c.username) acc.excludedCounterNames.add(c.username.trim());
  });

  const taskById = new Map<string, LocationRecountTask>();
  recountTasks.forEach((t) => taskById.set(t.id, t));

  return Array.from(locationMap.values())
    .map((acc) => {
      const varianceSkus = Array.from(acc.skuMap.values()).sort((a, b) =>
        a.sku.localeCompare(b.sku)
      );
      const totalVarianceUnits = varianceSkus.reduce(
        (sum, item) => sum + Math.abs(item.variance),
        0
      );
      return {
        id: acc.id,
        storeId: acc.storeId,
        storeName: acc.storeName,
        location: acc.location,
        varianceSkus,
        excludedCounterIds: Array.from(acc.excludedCounterIds),
        excludedCounterNames: Array.from(acc.excludedCounterNames),
        totalVarianceUnits,
        existingTask: taskById.get(acc.id),
      };
    })
    .sort((a, b) => b.varianceSkus.length - a.varianceSkus.length);
}

/**
 * Resolves effective inventory counts for final reconciliation & Excel reports:
 * Verified Round 2 counts supersede Round 1 counts for the exact (storeId, location, sku) targets
 * covered by verified LocationRecountTasks, preventing double-counting.
 */
export function getEffectiveCountsForReconciliation(
  counts: InventoryCount[],
  recountTasks: LocationRecountTask[]
): {
  effectiveCounts: InventoryCount[];
  reconciledSkuCount: number;
  round1QtyBySku: Map<string, number>;
  round2QtyBySku: Map<string, number>;
} {
  const activeCounts = counts.filter((c) => c.status !== 'voided');
  const verifiedRecountKeys = new Set<string>();
  const verifiedTaskIds = new Set<string>();

  recountTasks.forEach((task) => {
    if (task.status !== 'verified') return;
    verifiedTaskIds.add(task.id);
    const storeKey = task.storeId.trim().toLowerCase();
    const locKey = task.location.trim().toLowerCase();
    task.varianceSkus.forEach((v) => {
      verifiedRecountKeys.add(`${storeKey}::${locKey}::${v.sku.trim().toLowerCase()}`);
    });
  });

  // Also include any SKU actually counted in Round 2 under a verified task
  activeCounts.forEach((c) => {
    if ((c.countRound ?? 1) === 2 && c.recountTaskId && verifiedTaskIds.has(c.recountTaskId)) {
      const key = `${c.storeId.trim().toLowerCase()}::${(c.location || '').trim().toLowerCase()}::${c.sku.trim().toLowerCase()}`;
      verifiedRecountKeys.add(key);
    }
  });

  const round1QtyBySku = new Map<string, number>();
  const round2QtyBySku = new Map<string, number>();
  const effectiveCounts: InventoryCount[] = [];

  activeCounts.forEach((c) => {
    const skuLower = c.sku.trim().toLowerCase();
    const round = c.countRound ?? 1;
    const qty = Number(c.countedQuantity) || 0;
    const compoundKey = `${c.storeId.trim().toLowerCase()}::${(c.location || '').trim().toLowerCase()}::${skuLower}`;

    if (round === 1) {
      round1QtyBySku.set(skuLower, (round1QtyBySku.get(skuLower) || 0) + qty);
      if (!verifiedRecountKeys.has(compoundKey)) {
        effectiveCounts.push(c);
      }
    } else if (round === 2) {
      const belongsToVerifiedTask =
        verifiedRecountKeys.has(compoundKey) ||
        (Boolean(c.recountTaskId) && verifiedTaskIds.has(c.recountTaskId!));
      if (belongsToVerifiedTask) {
        round2QtyBySku.set(skuLower, (round2QtyBySku.get(skuLower) || 0) + qty);
        effectiveCounts.push(c);
      }
    }
  });

  return {
    effectiveCounts,
    reconciledSkuCount: verifiedRecountKeys.size,
    round1QtyBySku,
    round2QtyBySku,
  };
}

export async function openLocationRecountTask(params: {
  storeId: string;
  storeName: string;
  location: string;
  varianceSkus: VarianceSkuTarget[];
  counts: InventoryCount[];
  openedBy: AppUser;
  supervisorNotes?: string;
  assignedCounter?: ManagedUser | null;
  session?: Pick<CountingSession, 'id' | 'countType' | 'cutoffDate'>;
}): Promise<LocationRecountTask> {
  const {
    storeId,
    storeName,
    location,
    varianceSkus,
    counts,
    openedBy,
    supervisorNotes,
    assignedCounter,
    session,
  } = params;

  if (
    openedBy.role !== 'supervisor' &&
    openedBy.role !== 'ops_supervisor' &&
    openedBy.role !== 'admin'
  ) {
    throw new Error('Only Supervisors or Administrators can open Second Count tasks.');
  }

  if (varianceSkus.length === 0) {
    throw new Error('No variance SKUs were found for this location.');
  }

  const trimmedLoc = location.trim();
  const resolvedSessionId = session?.id || DEFAULT_ANNUAL_SESSION_ID;
  const resolvedCountType = normalizeCountType(session?.countType);
  const id = getLocationRecountId(storeId, trimmedLoc, resolvedSessionId);
  const { excludedCounterIds, excludedCounterNames } = getRound1CountersForLocation(
    counts,
    storeId,
    trimmedLoc
  );

  if (assignedCounter) {
    const excludedIdSet = new Set(excludedCounterIds);
    const normExcludedNames = new Set(
      excludedCounterNames.map((n) => n.trim().toLowerCase()).filter(Boolean)
    );
    if (isManagedUserExcluded(assignedCounter, excludedIdSet, normExcludedNames)) {
      throw new Error(
        `${assignedCounter.displayName} counted "${trimmedLoc}" in Round 1 and cannot be assigned to its 2nd count.`
      );
    }
  }

  const sys = getSystemDateTime();

  const task: LocationRecountTask = {
    id,
    storeId,
    storeName,
    location: trimmedLoc,
    status: 'open',
    varianceSkus,
    excludedCounterIds,
    excludedCounterNames,
    openedById: openedBy.uid,
    openedByName: openedBy.displayName || openedBy.email || 'Supervisor',
    openedByRole: openedBy.role,
    openedAt: sys.timestamp,
    openedDate: sys.date,
    openedTime: sys.time,
    assignedCounterId: assignedCounter?.id,
    assignedCounterName: assignedCounter?.displayName,
    assignedCounterRole: assignedCounter?.role,
    assignedById: assignedCounter ? openedBy.uid : undefined,
    assignedByName: assignedCounter ? openedBy.displayName || openedBy.email || 'Supervisor' : undefined,
    assignedAt: assignedCounter ? sys.timestamp : undefined,
    supervisorNotes: (supervisorNotes || '').trim(),
    countType: resolvedCountType,
    sessionId: resolvedSessionId,
    cutoffDate: session?.cutoffDate,
  };

  const existing = getLocalLocationRecounts().filter((t) => t.id !== id);
  saveLocalLocationRecounts([task, ...existing]);

  try {
    await setDoc(doc(db, 'location_recounts', id), stripUndefined(task));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `location_recounts/${id}`);
    }
    console.warn('Location recount task saved locally (offline/retry):', err);
  }

  await appendImmutableAuditLog({
    inventoryCountId: id,
    store: storeName,
    storeId,
    sku: 'SECOND-COUNT',
    itemDescription: `2nd Count Opened: ${trimmedLoc} (${varianceSkus.length} variance SKUs)`,
    location: trimmedLoc,
    originalValue: `1st Count excluded: ${excludedCounterNames.join(', ') || 'None'}`,
    newValue: `${
      assignedCounter ? `Assigned to ${assignedCounter.displayName}` : 'Open to any eligible counter'
    } (${varianceSkus.map((v) => v.sku).slice(0, 5).join(', ')})`,
    action: 'RECOUNT_TASK_OPENED',
    approvalStatus: 'Pending',
    reason:
      (supervisorNotes || '').trim() ||
      `Opened per-location 2nd count for ${varianceSkus.length} SKU(s) with variances`,
    requestedBy: task.openedByName,
    requestedById: openedBy.uid,
    countType: resolvedCountType,
    sessionId: resolvedSessionId,
    cutoffDate: session?.cutoffDate,
  });

  return task;
}

export async function assignLocationRecountCounter(params: {
  task: LocationRecountTask;
  assignedCounter: ManagedUser | null;
  supervisor: AppUser;
}): Promise<LocationRecountTask> {
  const { task, assignedCounter, supervisor } = params;

  if (
    supervisor.role !== 'ops_supervisor' &&
    supervisor.role !== 'supervisor' &&
    supervisor.role !== 'admin'
  ) {
    throw new Error('Only Supervisor Ops, Store Supervisors, or Admins can assign 2nd-count counters.');
  }

  if (task.status !== 'open') {
    throw new Error('Counter assignment can only be changed while a 2nd-count location is open.');
  }

  if (assignedCounter) {
    const excludedIdSet = new Set(task.excludedCounterIds || []);
    const normExcludedNames = new Set(
      (task.excludedCounterNames || []).map((n) => n.trim().toLowerCase()).filter(Boolean)
    );
    if (isManagedUserExcluded(assignedCounter, excludedIdSet, normExcludedNames)) {
      throw new Error(
        `${assignedCounter.displayName} counted "${task.location}" in Round 1 and cannot be assigned to recount it.`
      );
    }
  }

  const sys = getSystemDateTime();
  const supervisorName = supervisor.displayName || supervisor.email || 'Supervisor Ops';
  const prevAssignment = task.assignedCounterName || 'Unassigned (Any Eligible Counter)';
  const nextAssignment = assignedCounter
    ? `${assignedCounter.displayName} (${assignedCounter.role === 'ops_counter' ? 'Ops Counter' : 'Store Counter'})`
    : 'Unassigned (Any Eligible Counter)';

  const updatedTask: LocationRecountTask = {
    ...task,
    assignedCounterId: assignedCounter?.id,
    assignedCounterName: assignedCounter?.displayName,
    assignedCounterRole: assignedCounter?.role,
    assignedById: assignedCounter ? supervisor.uid : undefined,
    assignedByName: assignedCounter ? supervisorName : undefined,
    assignedAt: assignedCounter ? sys.timestamp : undefined,
  };

  const existing = getLocalLocationRecounts().filter((t) => t.id !== task.id);
  saveLocalLocationRecounts([updatedTask, ...existing]);

  try {
    await setDoc(doc(db, 'location_recounts', task.id), stripUndefined(updatedTask));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `location_recounts/${task.id}`);
    }
    console.warn('Location recount assignment saved locally (offline/retry):', err);
  }

  await appendImmutableAuditLog({
    inventoryCountId: task.id,
    store: task.storeName,
    storeId: task.storeId,
    sku: 'SECOND-COUNT',
    itemDescription: `2nd Count Counter Assigned: ${task.location}`,
    location: task.location,
    originalValue: prevAssignment,
    newValue: nextAssignment,
    action: 'RECOUNT_COUNTER_ASSIGNED',
    approvalStatus: 'N/A',
    reason: assignedCounter
      ? `Supervisor Ops assigned ${assignedCounter.displayName} to recount ${task.location}`
      : `Supervisor Ops cleared specific assignment — opened ${task.location} to any eligible counter`,
    requestedBy: supervisorName,
    requestedById: supervisor.uid,
    countType: normalizeCountType(task.countType),
    sessionId: task.sessionId || DEFAULT_ANNUAL_SESSION_ID,
    cutoffDate: task.cutoffDate,
  });

  return updatedTask;
}

export async function submitLocationRecountForReview(params: {
  task: LocationRecountTask;
  round2CountsForLocation: InventoryCount[];
  allCounts: InventoryCount[];
  user: AppUser;
  counterNotes?: string;
}): Promise<LocationRecountTask> {
  const { task, round2CountsForLocation, allCounts, user, counterNotes } = params;

  const access = getRecountAccessForUser({
    user,
    storeId: task.storeId,
    location: task.location,
    counts: allCounts,
    task,
  });

  if (!access.allowed) {
    throw new Error(access.reason || 'You do not have access to submit this 2nd count.');
  }

  const activeRound2 = round2CountsForLocation.filter(
    (c) => c.status !== 'voided' && (c.countRound ?? 1) === 2
  );
  if (activeRound2.length === 0) {
    throw new Error('Please record at least one 2nd-count item before submitting for review.');
  }

  const sys = getSystemDateTime();
  const updatedTask: LocationRecountTask = {
    ...task,
    status: 'pending_review',
    submittedById: user.uid,
    submittedByName: user.displayName || user.email || 'Counter',
    submittedByRole: user.role,
    submittedAt: sys.timestamp,
    submittedDate: sys.date,
    submittedTime: sys.time,
    counterNotes: (counterNotes || '').trim(),
  };

  const existing = getLocalLocationRecounts().filter((t) => t.id !== task.id);
  saveLocalLocationRecounts([updatedTask, ...existing]);

  try {
    await setDoc(doc(db, 'location_recounts', task.id), stripUndefined(updatedTask));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `location_recounts/${task.id}`);
    }
    console.warn('Location recount submission saved locally (offline/retry):', err);
  }

  const totalRound2Units = activeRound2.reduce(
    (sum, c) => sum + (Number(c.countedQuantity) || 0),
    0
  );

  await appendImmutableAuditLog({
    inventoryCountId: task.id,
    store: task.storeName,
    storeId: task.storeId,
    sku: 'SECOND-COUNT',
    itemDescription: `2nd Count Submitted: ${task.location}`,
    location: task.location,
    originalValue: `${task.varianceSkus.length} variance SKU(s) open`,
    newValue: `Pending Review (${activeRound2.length} entries, ${totalRound2Units} units)`,
    action: 'SECOND_COUNT_SUBMITTED',
    approvalStatus: 'Pending',
    reason:
      (counterNotes || '').trim() ||
      `Associate ${updatedTask.submittedByName} completed blind 2nd count at ${task.location}`,
    requestedBy: updatedTask.submittedByName || 'Counter',
    requestedById: user.uid,
    countType: normalizeCountType(task.countType),
    sessionId: task.sessionId || DEFAULT_ANNUAL_SESSION_ID,
    cutoffDate: task.cutoffDate,
  });

  return updatedTask;
}

export async function reviewLocationRecountTask(params: {
  task: LocationRecountTask;
  decision: 'verified' | 'open';
  supervisor: AppUser;
  supervisorNotes?: string;
}): Promise<LocationRecountTask> {
  const { task, decision, supervisor, supervisorNotes } = params;

  if (
    supervisor.role !== 'supervisor' &&
    supervisor.role !== 'ops_supervisor' &&
    supervisor.role !== 'admin'
  ) {
    throw new Error('Only Supervisors or Administrators can verify or reopen Second Counts.');
  }

  if (decision === 'verified' && task.submittedById && task.submittedById === supervisor.uid) {
    throw new Error('You cannot verify your own submitted Second Count.');
  }

  const trimmedNotes = (supervisorNotes || '').trim();
  if (decision === 'open' && !trimmedNotes) {
    throw new Error('Please enter a note explaining why this location needs another recount.');
  }

  const sys = getSystemDateTime();
  const updatedTask: LocationRecountTask = {
    ...task,
    status: decision,
    verifiedById: supervisor.uid,
    verifiedByName: supervisor.displayName || supervisor.email || 'Supervisor',
    verifiedByRole: supervisor.role,
    verifiedAt: sys.timestamp,
    verifiedDate: sys.date,
    verifiedTime: sys.time,
    supervisorNotes: trimmedNotes,
  };

  const existing = getLocalLocationRecounts().filter((t) => t.id !== task.id);
  saveLocalLocationRecounts([updatedTask, ...existing]);

  try {
    await setDoc(doc(db, 'location_recounts', task.id), stripUndefined(updatedTask));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `location_recounts/${task.id}`);
    }
    console.warn('Location recount review saved locally (offline/retry):', err);
  }

  await appendImmutableAuditLog({
    inventoryCountId: task.id,
    store: task.storeName,
    storeId: task.storeId,
    sku: 'SECOND-COUNT',
    itemDescription: `2nd Count ${decision === 'verified' ? 'Verified' : 'Re-opened'}: ${task.location}`,
    location: task.location,
    originalValue: `Status: ${task.status}`,
    newValue:
      decision === 'verified'
        ? `Verified & Reconciled (2nd count replaces 1st count for variance SKUs)`
        : `Re-opened for 2nd Count`,
    action: decision === 'verified' ? 'SECOND_COUNT_VERIFIED' : 'SECOND_COUNT_REOPENED',
    approvalStatus: decision === 'verified' ? 'Approved' : 'Rejected',
    reason:
      trimmedNotes ||
      (decision === 'verified'
        ? `Verified 2nd count results at ${task.location}`
        : `Re-opened 2nd count at ${task.location}`),
    requestedBy: task.submittedByName || task.openedByName,
    requestedById: task.submittedById || task.openedById,
    reviewedBy: updatedTask.verifiedByName,
    reviewedById: supervisor.uid,
    countType: normalizeCountType(task.countType),
    sessionId: task.sessionId || DEFAULT_ANNUAL_SESSION_ID,
    cutoffDate: task.cutoffDate,
  });

  return updatedTask;
}
