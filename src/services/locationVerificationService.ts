import {
  AppUser,
  InventoryCount,
  LocationVerification,
  LocationVerificationStatus,
  Store,
} from '../types/inventory';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { appendImmutableAuditLog } from './auditService';
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';

const LOCAL_VERIFICATIONS_KEY = 'inventory_location_verifications_cache';

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

export function getLocationVerificationId(storeId: string, location: string): string {
  const cleanStore = (storeId || 'STORE').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const normalizedLoc = (location || 'UNASSIGNED').trim().toLowerCase();
  const cleanLoc = normalizedLoc.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  const hash = hashLocationString(`${storeId.trim().toLowerCase()}::${normalizedLoc}`);
  return `LOCVER_${cleanStore}_${cleanLoc}_${hash}`.slice(0, 120);
}

export function getLocalLocationVerifications(): LocationVerification[] {
  try {
    const raw = localStorage.getItem(LOCAL_VERIFICATIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error reading local location verifications:', e);
  }
  return [];
}

export function saveLocalLocationVerifications(list: LocationVerification[]): void {
  try {
    localStorage.setItem(LOCAL_VERIFICATIONS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Error saving local location verifications:', e);
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

function parseVerificationDoc(id: string, d: Record<string, any>): LocationVerification {
  const status: LocationVerificationStatus =
    d.status === 'verified' || d.status === 'recount_needed'
      ? d.status
      : 'pending_verification';

  return {
    id,
    storeId: d.storeId || '',
    storeName: d.storeName || '',
    location: d.location || '',
    status,
    submittedById: d.submittedById || '',
    submittedByName: d.submittedByName || 'Counter',
    submittedByRole: d.submittedByRole || 'counter',
    submittedAt: typeof d.submittedAt === 'number' ? d.submittedAt : Date.now(),
    submittedDate: d.submittedDate || '',
    submittedTime: d.submittedTime || '',
    counterNotes: d.counterNotes || '',
    itemCountSnapshot: typeof d.itemCountSnapshot === 'number' ? d.itemCountSnapshot : 0,
    totalUnitsSnapshot: typeof d.totalUnitsSnapshot === 'number' ? d.totalUnitsSnapshot : 0,
    verifiedById: d.verifiedById,
    verifiedByName: d.verifiedByName,
    verifiedByRole: d.verifiedByRole,
    verifiedAt: d.verifiedAt,
    verifiedDate: d.verifiedDate,
    verifiedTime: d.verifiedTime,
    supervisorNotes: d.supervisorNotes,
    doneCounting: d.status === 'verified' || d.doneCounting === true,
  };
}

export function subscribeToLocationVerifications(
  onUpdate: (verifications: LocationVerification[]) => void
): () => void {
  try {
    const q = query(
      collection(db, 'location_verifications'),
      orderBy('submittedAt', 'desc'),
      limit(500)
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const list: LocationVerification[] = [];
        snapshot.forEach((docSnap) => {
          list.push(parseVerificationDoc(docSnap.id, docSnap.data()));
        });
        saveLocalLocationVerifications(list);
        onUpdate(list);
      },
      (err) => {
        console.warn('Realtime location_verifications listener error:', err);
        onUpdate(getLocalLocationVerifications());
      }
    );
  } catch (err) {
    console.warn('Could not attach location_verifications listener:', err);
    onUpdate(getLocalLocationVerifications());
    return () => {};
  }
}

export async function submitLocationForVerification(params: {
  store: Store;
  location: string;
  countsForLocation: InventoryCount[];
  user: AppUser;
  counterNotes?: string;
}): Promise<LocationVerification> {
  const { store, location, countsForLocation, user, counterNotes } = params;
  const trimmedLoc = location.trim();
  if (!trimmedLoc) {
    throw new Error('Location cannot be empty.');
  }

  const activeCounts = countsForLocation.filter((c) => c.status !== 'voided');
  if (activeCounts.length === 0) {
    throw new Error(`No active counts have been recorded at "${trimmedLoc}" yet.`);
  }

  const totalUnits = activeCounts.reduce((sum, c) => sum + (Number(c.countedQuantity) || 0), 0);
  const sys = getSystemDateTime();
  const id = getLocationVerificationId(store.storeId, trimmedLoc);

  const verification: LocationVerification = {
    id,
    storeId: store.storeId,
    storeName: store.name,
    location: trimmedLoc,
    status: 'pending_verification',
    submittedById: user.uid,
    submittedByName: user.displayName || user.email || 'Counter',
    submittedByRole: user.role,
    submittedAt: sys.timestamp,
    submittedDate: sys.date,
    submittedTime: sys.time,
    counterNotes: (counterNotes || '').trim(),
    itemCountSnapshot: activeCounts.length,
    totalUnitsSnapshot: totalUnits,
    doneCounting: false,
  };

  const existing = getLocalLocationVerifications().filter((v) => v.id !== id);
  saveLocalLocationVerifications([verification, ...existing]);

  try {
    await setDoc(doc(db, 'location_verifications', id), stripUndefined(verification));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `location_verifications/${id}`);
    }
    console.warn('Location verification saved locally (offline/retry):', err);
  }

  await appendImmutableAuditLog({
    inventoryCountId: id,
    store: store.name,
    storeId: store.storeId,
    sku: 'LOCATION-CHECK',
    itemDescription: `Location Count Completed: ${trimmedLoc}`,
    location: trimmedLoc,
    originalValue: 'Counting in progress',
    newValue: `Pending Supervisor Verification (${activeCounts.length} items, ${totalUnits} units)`,
    action: 'LOCATION_DONE_SUBMITTED',
    approvalStatus: 'Pending',
    reason:
      (counterNotes || '').trim() ||
      `Counter finished counting ${trimmedLoc} and submitted for supervisor check`,
    requestedBy: user.displayName || user.email,
    requestedById: user.uid,
  });

  return verification;
}

export async function reviewLocationVerification(params: {
  storeId: string;
  storeName: string;
  location: string;
  decision: 'verified' | 'recount_needed';
  supervisor: AppUser;
  supervisorNotes?: string;
  countsForLocation: InventoryCount[];
  existingVerification?: LocationVerification;
}): Promise<LocationVerification> {
  const {
    storeId,
    storeName,
    location,
    decision,
    supervisor,
    supervisorNotes,
    countsForLocation,
    existingVerification,
  } = params;

  if (supervisor.role !== 'supervisor' && supervisor.role !== 'ops_supervisor') {
    throw new Error('Only Supervisors can verify or flag location counts.');
  }

  if (
    supervisor.role === 'supervisor' &&
    supervisor.assignedStoreId &&
    supervisor.assignedStoreId !== 'ALL' &&
    supervisor.assignedStoreId !== storeId
  ) {
    throw new Error('Store Supervisors can only verify locations in their assigned store.');
  }

  if (existingVerification && existingVerification.submittedById === supervisor.uid) {
    throw new Error('You cannot verify your own submitted location check.');
  }

  const trimmedNotes = (supervisorNotes || '').trim();
  if (decision === 'recount_needed' && !trimmedNotes) {
    throw new Error('Please enter notes explaining what needs to be recounted or corrected.');
  }

  const trimmedLoc = location.trim();
  const activeCounts = countsForLocation.filter((c) => c.status !== 'voided');
  const totalUnits = activeCounts.reduce((sum, c) => sum + (Number(c.countedQuantity) || 0), 0);
  const sys = getSystemDateTime();
  const id = existingVerification?.id || getLocationVerificationId(storeId, trimmedLoc);

  const verification: LocationVerification = {
    id,
    storeId,
    storeName,
    location: trimmedLoc,
    status: decision,
    submittedById: existingVerification?.submittedById || 'location-counters',
    submittedByName: existingVerification?.submittedByName || 'Location Counter(s)',
    submittedByRole: existingVerification?.submittedByRole || 'counter',
    submittedAt: existingVerification?.submittedAt || sys.timestamp,
    submittedDate: existingVerification?.submittedDate || sys.date,
    submittedTime: existingVerification?.submittedTime || sys.time,
    counterNotes: existingVerification?.counterNotes || '',
    itemCountSnapshot: activeCounts.length,
    totalUnitsSnapshot: totalUnits,
    verifiedById: supervisor.uid,
    verifiedByName: supervisor.displayName || supervisor.email || 'Supervisor',
    verifiedByRole: supervisor.role,
    verifiedAt: sys.timestamp,
    verifiedDate: sys.date,
    verifiedTime: sys.time,
    supervisorNotes: trimmedNotes,
    doneCounting: decision === 'verified',
  };

  const existing = getLocalLocationVerifications().filter((v) => v.id !== id);
  saveLocalLocationVerifications([verification, ...existing]);

  try {
    await setDoc(doc(db, 'location_verifications', id), stripUndefined(verification));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `location_verifications/${id}`);
    }
    console.warn('Location verification review saved locally (offline/retry):', err);
  }

  await appendImmutableAuditLog({
    inventoryCountId: id,
    store: storeName,
    storeId,
    sku: 'LOCATION-CHECK',
    itemDescription: `Location Verification: ${trimmedLoc}`,
    location: trimmedLoc,
    originalValue: `${existingVerification?.status || 'in_progress'} (${activeCounts.length} items, ${totalUnits} units)`,
    newValue:
      decision === 'verified'
        ? `Verified & Tagged Done Counting by ${supervisor.displayName || supervisor.email}`
        : `Recount Flagged by ${supervisor.displayName || supervisor.email}`,
    action: decision === 'verified' ? 'LOCATION_VERIFIED' : 'LOCATION_RECOUNT_FLAGGED',
    approvalStatus: decision === 'verified' ? 'Approved' : 'Rejected',
    reason:
      trimmedNotes ||
      (decision === 'verified'
        ? `Supervisor checked and verified all counts at ${trimmedLoc}`
        : `Recount required at ${trimmedLoc}`),
    requestedBy: verification.submittedByName,
    requestedById: verification.submittedById,
    reviewedBy: supervisor.displayName || supervisor.email,
    reviewedById: supervisor.uid,
  });

  return verification;
}
