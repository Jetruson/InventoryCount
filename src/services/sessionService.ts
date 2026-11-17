import {
  AppUser,
  CountingSession,
  CountingSessionStatus,
  CountType,
  Store,
} from '../types/inventory';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { appendImmutableAuditLog } from './auditService';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';

export const LOCAL_SESSIONS_KEY = 'inventory_counting_sessions_cache';
const SESSION_ACTIVE_STORAGE_KEY = 'inventory_active_counting_session';

export const DEFAULT_ANNUAL_SESSION_ID = 'annual-default';

export const DEFAULT_ANNUAL_SESSION: CountingSession = {
  id: DEFAULT_ANNUAL_SESSION_ID,
  countType: 'annual',
  title: 'Annual Inventory Count (Baseline)',
  cutoffDate: `${new Date().getFullYear()}-12-31`,
  storeId: 'ALL',
  storeName: 'All Retail Stores',
  status: 'active',
  createdById: 'system',
  createdByName: 'System Baseline',
  createdByRole: 'admin',
  createdAt: 1704067200000,
  createdDate: '2026-01-01',
  createdTime: '00:00:00',
  notes: 'Default Annual Inventory Count session holding baseline and pre-session count records.',
  isDefaultBaseline: true,
};

function getSystemDateTime(ts: number = Date.now()) {
  const d = new Date(ts);
  return {
    timestamp: ts,
    date: d.toISOString().split('T')[0],
    time: d.toTimeString().split(' ')[0],
  };
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

export function normalizeCountType(raw?: unknown): CountType {
  return raw === 'cycle' ? 'cycle' : 'annual';
}

export function getCountTypeLabel(countType?: CountType): string {
  return normalizeCountType(countType) === 'cycle' ? 'Cycle Count' : 'Annual Inventory Count';
}

export function getCountTypeShortLabel(countType?: CountType): string {
  return normalizeCountType(countType) === 'cycle' ? 'Cycle' : 'Annual';
}

export function normalizeRecordSessionId(
  sessionId?: string | null,
  countType?: unknown
): string {
  const trimmed = (sessionId || '').trim();
  if (trimmed) return trimmed;
  return countType === 'cycle' ? 'cycle-default' : DEFAULT_ANNUAL_SESSION_ID;
}

export function doesRecordBelongToSession(
  record: {
    id?: string;
    countType?: CountType;
    sessionId?: string;
    storeId?: string;
    store?: string;
  },
  session?: Pick<CountingSession, 'id' | 'countType'> | null
): boolean {
  if (!session) return true;
  const recType = normalizeCountType(record.countType);
  if (recType !== session.countType) return false;

  const recSessId = (record.sessionId || '').trim();
  if (session.id === DEFAULT_ANNUAL_SESSION_ID) {
    return recSessId === '' || recSessId === DEFAULT_ANNUAL_SESSION_ID;
  }
  return recSessId === session.id;
}

export function isSessionVisibleForStore(
  session: CountingSession,
  storeId?: string | null
): boolean {
  if (!storeId || storeId === 'ALL' || storeId === 'all') return true;
  if (!session.storeId || session.storeId === 'ALL') return true;
  return session.storeId.trim().toLowerCase() === storeId.trim().toLowerCase();
}

export function mergeWithDefaultAnnualSession(list: CountingSession[]): CountingSession[] {
  const byId = new Map<string, CountingSession>();
  list.forEach((s) => {
    if (s.id) byId.set(s.id, s);
  });
  if (!byId.has(DEFAULT_ANNUAL_SESSION_ID)) {
    byId.set(DEFAULT_ANNUAL_SESSION_ID, DEFAULT_ANNUAL_SESSION);
  } else {
    const existingDefault = byId.get(DEFAULT_ANNUAL_SESSION_ID)!;
    byId.set(DEFAULT_ANNUAL_SESSION_ID, {
      ...DEFAULT_ANNUAL_SESSION,
      ...existingDefault,
      isDefaultBaseline: true,
    });
  }
  return Array.from(byId.values()).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    if (b.cutoffDate !== a.cutoffDate) return b.cutoffDate.localeCompare(a.cutoffDate);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

export function getLocalCountingSessions(): CountingSession[] {
  try {
    const raw = localStorage.getItem(LOCAL_SESSIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return mergeWithDefaultAnnualSession(parsed);
      }
    }
  } catch (e) {
    console.warn('Error reading local counting sessions:', e);
  }
  return mergeWithDefaultAnnualSession([]);
}

export function saveLocalCountingSessions(list: CountingSession[]): void {
  try {
    localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Error saving local counting sessions:', e);
  }
}

export function getStoredActiveCountingSession(userId?: string): CountingSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_ACTIVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.session && parsed.session.id) {
      if (userId && parsed.userId && parsed.userId !== userId) {
        return null;
      }
      return parsed.session as CountingSession;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function setStoredActiveCountingSession(
  session: CountingSession,
  userId?: string
): void {
  try {
    sessionStorage.setItem(
      SESSION_ACTIVE_STORAGE_KEY,
      JSON.stringify({ userId: userId || '', session })
    );
  } catch {
    // ignore storage errors
  }
}

export function clearStoredActiveCountingSession(): void {
  try {
    sessionStorage.removeItem(SESSION_ACTIVE_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

function parseSessionDoc(id: string, d: Record<string, any>): CountingSession {
  const status: CountingSessionStatus = d.status === 'closed' ? 'closed' : 'active';
  return {
    id,
    countType: normalizeCountType(d.countType),
    title: d.title || (d.countType === 'cycle' ? 'Cycle Count Session' : 'Annual Inventory Count'),
    cutoffDate: d.cutoffDate || '',
    storeId: d.storeId || 'ALL',
    storeName: d.storeName || 'All Retail Stores',
    status,
    createdById: d.createdById || '',
    createdByName: d.createdByName || 'Supervisor',
    createdByRole: d.createdByRole || 'supervisor',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    createdDate: d.createdDate || '',
    createdTime: d.createdTime || '',
    closedAt: typeof d.closedAt === 'number' ? d.closedAt : undefined,
    closedById: d.closedById || undefined,
    closedByName: d.closedByName || undefined,
    closedByRole: d.closedByRole || undefined,
    reopenedAt: typeof d.reopenedAt === 'number' ? d.reopenedAt : undefined,
    reopenedById: d.reopenedById || undefined,
    reopenedByName: d.reopenedByName || undefined,
    reopenedByRole: d.reopenedByRole || undefined,
    notes: d.notes || undefined,
    isDefaultBaseline: id === DEFAULT_ANNUAL_SESSION_ID || d.isDefaultBaseline === true,
  };
}

export function subscribeToCountingSessions(
  onUpdate: (sessions: CountingSession[]) => void
): () => void {
  onUpdate(getLocalCountingSessions());
  try {
    const q = query(
      collection(db, 'counting_sessions'),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const list: CountingSession[] = [];
        snapshot.forEach((docSnap) => {
          list.push(parseSessionDoc(docSnap.id, docSnap.data()));
        });
        const merged = mergeWithDefaultAnnualSession(list);
        saveLocalCountingSessions(merged);
        onUpdate(merged);
      },
      (err) => {
        console.warn('Realtime counting_sessions listener error:', err);
        onUpdate(getLocalCountingSessions());
      }
    );
  } catch (err) {
    console.warn('Could not attach counting_sessions listener:', err);
    onUpdate(getLocalCountingSessions());
    return () => {};
  }
}

export async function createCountingSession(params: {
  countType: CountType;
  title: string;
  cutoffDate: string;
  store: Store | 'ALL';
  actor: AppUser;
  notes?: string;
}): Promise<CountingSession> {
  const { countType, title, cutoffDate, store, actor, notes } = params;

  if (
    actor.role !== 'admin' &&
    actor.role !== 'supervisor' &&
    actor.role !== 'ops_supervisor'
  ) {
    throw new Error('Only Administrators or Supervisors can create counting sessions.');
  }

  const trimmedTitle = title.trim();
  const trimmedCutoff = cutoffDate.trim();
  if (!trimmedTitle) {
    throw new Error('Please enter a session name or label.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedCutoff)) {
    throw new Error('Please provide a valid cut-off date (YYYY-MM-DD).');
  }

  // Store Supervisor is strictly locked to their assigned store
  let resolvedStoreId = store === 'ALL' ? 'ALL' : store.storeId;
  let resolvedStoreName = store === 'ALL' ? 'All Retail Stores' : store.name;
  if (actor.role === 'supervisor' && actor.assignedStoreId && actor.assignedStoreId !== 'ALL') {
    resolvedStoreId = actor.assignedStoreId;
    resolvedStoreName = actor.assignedStoreName || (store !== 'ALL' ? store.name : actor.assignedStoreId);
  }

  const sys = getSystemDateTime();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const id = `SES-${countType === 'cycle' ? 'CYC' : 'ANN'}-${trimmedCutoff}-${rand}`;
  const actorName = actor.displayName || actor.email || 'Supervisor';

  const sessionObj: CountingSession = {
    id,
    countType,
    title: trimmedTitle,
    cutoffDate: trimmedCutoff,
    storeId: resolvedStoreId,
    storeName: resolvedStoreName,
    status: 'active',
    createdById: actor.uid,
    createdByName: actorName,
    createdByRole: actor.role,
    createdAt: sys.timestamp,
    createdDate: sys.date,
    createdTime: sys.time,
    notes: notes?.trim() || undefined,
  };

  const existing = getLocalCountingSessions().filter((s) => s.id !== id);
  const nextList = mergeWithDefaultAnnualSession([sessionObj, ...existing]);
  saveLocalCountingSessions(nextList);

  try {
    await setDoc(doc(db, 'counting_sessions', id), stripUndefined(sessionObj));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.CREATE, `counting_sessions/${id}`);
    }
    throw err instanceof Error ? err : new Error('Failed to create counting session.');
  }

  await appendImmutableAuditLog({
    inventoryCountId: id,
    store: resolvedStoreName,
    storeId: resolvedStoreId,
    sku: 'COUNT-SESSION',
    itemDescription: `${getCountTypeLabel(countType)} Created: ${trimmedTitle}`,
    location: 'All Locations',
    originalValue: 'New Session',
    newValue: `${getCountTypeLabel(countType)} · Cut-Off: ${trimmedCutoff} · ${resolvedStoreName}`,
    action: 'COUNT_SESSION_CREATED',
    approvalStatus: 'Approved',
    reason: notes?.trim() || `Defined ${getCountTypeLabel(countType)} with cut-off date ${trimmedCutoff}`,
    requestedBy: actorName,
    requestedById: actor.uid,
    reviewedBy: actorName,
    reviewedById: actor.uid,
    countType,
    sessionId: id,
    cutoffDate: trimmedCutoff,
  });

  return sessionObj;
}

export async function closeCountingSession(params: {
  session: CountingSession;
  actor: AppUser;
  notes?: string;
}): Promise<CountingSession> {
  const { session, actor, notes } = params;

  if (
    actor.role !== 'admin' &&
    actor.role !== 'supervisor' &&
    actor.role !== 'ops_supervisor'
  ) {
    throw new Error('Only Administrators or Supervisors can close a counting session.');
  }

  const sys = getSystemDateTime();
  const actorName = actor.displayName || actor.email || 'Supervisor';

  const updated: CountingSession = {
    ...session,
    status: 'closed',
    closedAt: sys.timestamp,
    closedById: actor.uid,
    closedByName: actorName,
    closedByRole: actor.role,
    notes: notes?.trim() || session.notes,
  };

  const existing = getLocalCountingSessions().filter((s) => s.id !== updated.id);
  saveLocalCountingSessions(mergeWithDefaultAnnualSession([updated, ...existing]));

  try {
    await setDoc(doc(db, 'counting_sessions', updated.id), stripUndefined(updated));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `counting_sessions/${updated.id}`);
    }
    throw err instanceof Error ? err : new Error('Failed to close counting session.');
  }

  await appendImmutableAuditLog({
    inventoryCountId: updated.id,
    store: updated.storeName,
    storeId: updated.storeId,
    sku: 'COUNT-SESSION',
    itemDescription: `${getCountTypeLabel(updated.countType)} Closed: ${updated.title}`,
    location: 'All Locations',
    originalValue: `Status: Active · Cut-Off: ${updated.cutoffDate}`,
    newValue: `Status: Closed & Finalized (Submissions Locked)`,
    action: 'COUNT_SESSION_CLOSED',
    approvalStatus: 'Approved',
    reason: notes?.trim() || `Closed and finalized ${updated.title} (Cut-Off ${updated.cutoffDate})`,
    requestedBy: actorName,
    requestedById: actor.uid,
    reviewedBy: actorName,
    reviewedById: actor.uid,
    countType: updated.countType,
    sessionId: updated.id,
    cutoffDate: updated.cutoffDate,
  });

  return updated;
}

export async function reopenCountingSession(params: {
  session: CountingSession;
  adminUser: AppUser;
  notes?: string;
}): Promise<CountingSession> {
  const { session, adminUser, notes } = params;

  if (adminUser.role !== 'admin') {
    throw new Error('Only Administrators can re-open a closed counting session.');
  }

  const sys = getSystemDateTime();
  const adminName = adminUser.displayName || adminUser.email || 'Administrator';

  const updated: CountingSession = {
    ...session,
    status: 'active',
    reopenedAt: sys.timestamp,
    reopenedById: adminUser.uid,
    reopenedByName: adminName,
    reopenedByRole: 'admin',
    notes: notes?.trim() || session.notes,
  };

  const existing = getLocalCountingSessions().filter((s) => s.id !== updated.id);
  saveLocalCountingSessions(mergeWithDefaultAnnualSession([updated, ...existing]));

  try {
    await setDoc(doc(db, 'counting_sessions', updated.id), stripUndefined(updated));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `counting_sessions/${updated.id}`);
    }
    throw err instanceof Error ? err : new Error('Failed to re-open counting session.');
  }

  await appendImmutableAuditLog({
    inventoryCountId: updated.id,
    store: updated.storeName,
    storeId: updated.storeId,
    sku: 'COUNT-SESSION',
    itemDescription: `${getCountTypeLabel(updated.countType)} Re-opened: ${updated.title}`,
    location: 'All Locations',
    originalValue: `Status: Closed · Cut-Off: ${updated.cutoffDate}`,
    newValue: `Status: Active (Counting Unlocked by Admin)`,
    action: 'COUNT_SESSION_REOPENED',
    approvalStatus: 'N/A',
    reason: notes?.trim() || `Administrator re-opened ${updated.title} (Cut-Off ${updated.cutoffDate})`,
    requestedBy: adminName,
    requestedById: adminUser.uid,
    reviewedBy: adminName,
    reviewedById: adminUser.uid,
    countType: updated.countType,
    sessionId: updated.id,
    cutoffDate: updated.cutoffDate,
  });

  return updated;
}
