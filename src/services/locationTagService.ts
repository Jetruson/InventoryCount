import {
  AppUser,
  LocationTag,
  LocationTagStatus,
  Store,
} from '../types/inventory';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { appendImmutableAuditLog } from './auditService';
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

const LOCAL_LOCATION_TAGS_KEY = 'inventory_location_tags_cache';

function getSystemDateTime(ts: number = Date.now()) {
  const d = new Date(ts);
  return {
    timestamp: ts,
    date: d.toISOString().split('T')[0],
    time: d.toTimeString().split(' ')[0],
  };
}

function hashTagString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export function getLocationTagId(storeId: string, name: string): string {
  const cleanStore = (storeId || 'STORE').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const normalizedName = name.trim().toLowerCase();
  const cleanName = normalizedName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'LOC';
  const hash = hashTagString(`${storeId.trim().toLowerCase()}::${normalizedName}`);
  return `LOCTAG_${cleanStore}_${cleanName}_${hash}`.slice(0, 120);
}

export function getLocalLocationTags(): LocationTag[] {
  try {
    const raw = localStorage.getItem(LOCAL_LOCATION_TAGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error reading local location tags:', e);
  }
  return [];
}

export function saveLocalLocationTags(tags: LocationTag[]): void {
  try {
    localStorage.setItem(LOCAL_LOCATION_TAGS_KEY, JSON.stringify(tags));
  } catch (e) {
    console.warn('Error saving local location tags:', e);
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

function parseLocationTagDoc(id: string, d: Record<string, any>): LocationTag {
  const status: LocationTagStatus =
    d.status === 'pending_approval' || d.status === 'rejected'
      ? d.status
      : 'approved';

  return {
    id,
    storeId: d.storeId || '',
    storeName: d.storeName || '',
    name: d.name || '',
    zone: d.zone || undefined,
    code: d.code || undefined,
    status,
    createdById: d.createdById || '',
    createdByName: d.createdByName || 'Administrator',
    createdByRole: d.createdByRole || 'admin',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    createdDate: d.createdDate || '',
    createdTime: d.createdTime || '',
    approvedById: d.approvedById,
    approvedByName: d.approvedByName,
    approvedByRole: d.approvedByRole,
    approvedAt: d.approvedAt,
    approvedDate: d.approvedDate,
    approvedTime: d.approvedTime,
    rejectionReason: d.rejectionReason,
    notes: d.notes,
  };
}

export function subscribeToLocationTags(
  onUpdate: (tags: LocationTag[]) => void
): () => void {
  onUpdate(getLocalLocationTags());
  try {
    const q = query(
      collection(db, 'location_tags'),
      orderBy('createdAt', 'desc'),
      limit(500)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) =>
          parseLocationTagDoc(docSnap.id, docSnap.data() as Record<string, any>)
        );
        saveLocalLocationTags(list);
        onUpdate(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'location_tags');
      }
    );
    return unsub;
  } catch (err) {
    console.warn('Location tags subscription fallback to local cache:', err);
    return () => {};
  }
}

function upsertLocalLocationTag(tag: LocationTag): LocationTag[] {
  const existing = getLocalLocationTags();
  const next = [tag, ...existing.filter((t) => t.id !== tag.id)];
  saveLocalLocationTags(next);
  return next;
}

/**
 * Admin creates an immediately approved Location Tag for a store.
 */
export async function createAdminLocationTag(params: {
  store: Store;
  name: string;
  zone?: string;
  code?: string;
  adminUser: AppUser;
  existingTags?: LocationTag[];
}): Promise<LocationTag> {
  const { store, name, zone, code, adminUser, existingTags } = params;
  if (adminUser.role !== 'admin') {
    throw new Error('Only Administrators can create pre-approved location tags.');
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Location tag name is required.');
  }

  const tagId = getLocationTagId(store.storeId, trimmedName);
  const currentList = existingTags || getLocalLocationTags();
  const duplicate = currentList.find(
    (t) =>
      (t.id === tagId ||
        (t.storeId === store.storeId &&
          t.name.trim().toLowerCase() === trimmedName.toLowerCase())) &&
      t.status === 'approved'
  );
  if (duplicate) {
    throw new Error(
      `Location tag "${trimmedName}" already exists for ${store.name}.`
    );
  }

  const sys = getSystemDateTime();
  const tag: LocationTag = {
    id: tagId,
    storeId: store.storeId,
    storeName: store.name,
    name: trimmedName,
    zone: zone?.trim() || undefined,
    code: code?.trim() || trimmedName,
    status: 'approved',
    createdById: adminUser.uid,
    createdByName: adminUser.displayName || 'Administrator',
    createdByRole: 'admin',
    createdAt: sys.timestamp,
    createdDate: sys.date,
    createdTime: sys.time,
    approvedById: adminUser.uid,
    approvedByName: adminUser.displayName || 'Administrator',
    approvedByRole: 'admin',
    approvedAt: sys.timestamp,
    approvedDate: sys.date,
    approvedTime: sys.time,
  };

  try {
    await setDoc(doc(db, 'location_tags', tagId), stripUndefined(tag));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `location_tags/${tagId}`);
    }
    throw err instanceof Error ? err : new Error('Failed to save location tag.');
  }

  upsertLocalLocationTag(tag);

  await appendImmutableAuditLog({
    inventoryCountId: tagId,
    store: store.name,
    storeId: store.storeId,
    sku: 'LOCATION-TAG',
    itemDescription: `Location Tag: ${trimmedName}`,
    location: trimmedName,
    originalValue: 'None',
    newValue: `Approved (${trimmedName}${tag.zone ? ` · Zone: ${tag.zone}` : ''})`,
    action: 'LOCATION_TAG_CREATED',
    approvalStatus: 'Approved',
    reason: `Admin created clickable location tag for ${store.name}`,
    requestedBy: adminUser.displayName || 'Administrator',
    requestedById: adminUser.uid,
    reviewedBy: adminUser.displayName || 'Administrator',
    reviewedById: adminUser.uid,
  });

  return tag;
}

export interface BulkLocationTagInput {
  name: string;
  zone?: string;
  code?: string;
  storeId?: string;
}

/**
 * Admin fast batch-imports Location Tags from an uploaded list/file or pasted lines.
 * Uses Firestore writeBatch for speed and logs one consolidated immutable audit entry.
 */
export async function bulkImportAdminLocationTags(params: {
  defaultStore: Store | 'ALL';
  stores: Store[];
  items: BulkLocationTagInput[];
  adminUser: AppUser;
  existingTags: LocationTag[];
  sourceLabel?: string;
}): Promise<{ created: LocationTag[]; skipped: string[]; errors: string[] }> {
  const { defaultStore, stores, items, adminUser, existingTags, sourceLabel } = params;

  if (adminUser.role !== 'admin') {
    throw new Error('Only Administrators can upload pre-approved location tags.');
  }

  if (items.length === 0) {
    throw new Error('No location entries were found to upload.');
  }

  const storeByKey = new Map<string, Store>();
  stores.forEach((s) => {
    storeByKey.set(s.storeId.trim().toLowerCase(), s);
    storeByKey.set(s.name.trim().toLowerCase(), s);
  });

  const existingApprovedKeys = new Set<string>();
  const existingApprovedIds = new Set<string>();
  existingTags.forEach((t) => {
    if (t.status === 'approved') {
      existingApprovedIds.add(t.id);
      existingApprovedKeys.add(`${t.storeId.trim().toLowerCase()}::${t.name.trim().toLowerCase()}`);
    }
  });

  const sys = getSystemDateTime();
  const created: LocationTag[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  for (let idx = 0; idx < items.length; idx++) {
    const rawItem = items[idx];
    const cleanName = (rawItem.name || '').trim().slice(0, 150);
    if (!cleanName) continue;

    let targetStores: Store[] = [];
    const rowStoreRaw = (rawItem.storeId || '').trim();
    if (rowStoreRaw) {
      if (rowStoreRaw.toLowerCase() === 'all') {
        targetStores = stores;
      } else {
        const matched = storeByKey.get(rowStoreRaw.toLowerCase());
        if (!matched) {
          errors.push(`Row ${idx + 1}: Store "${rowStoreRaw}" not found (${cleanName}).`);
          continue;
        }
        targetStores = [matched];
      }
    } else if (defaultStore === 'ALL') {
      targetStores = stores;
    } else {
      targetStores = [defaultStore];
    }

    for (const targetStore of targetStores) {
      const storeId = targetStore.storeId.trim().slice(0, 64);
      const storeName = targetStore.name.trim().slice(0, 150);
      const compoundKey = `${storeId.toLowerCase()}::${cleanName.toLowerCase()}`;
      const tagId = getLocationTagId(storeId, cleanName);

      if (
        seenKeys.has(compoundKey) ||
        existingApprovedKeys.has(compoundKey) ||
        existingApprovedIds.has(tagId)
      ) {
        skipped.push(
          targetStores.length > 1 || defaultStore === 'ALL'
            ? `${cleanName} (${storeId})`
            : cleanName
        );
        continue;
      }

      seenKeys.add(compoundKey);

      const tag: LocationTag = {
        id: tagId,
        storeId,
        storeName,
        name: cleanName,
        zone: rawItem.zone?.trim().slice(0, 100) || undefined,
        code: (rawItem.code?.trim() || cleanName).slice(0, 100),
        status: 'approved',
        createdById: adminUser.uid,
        createdByName: adminUser.displayName || 'Administrator',
        createdByRole: 'admin',
        createdAt: sys.timestamp,
        createdDate: sys.date,
        createdTime: sys.time,
        approvedById: adminUser.uid,
        approvedByName: adminUser.displayName || 'Administrator',
        approvedByRole: 'admin',
        approvedAt: sys.timestamp,
        approvedDate: sys.date,
        approvedTime: sys.time,
      };
      created.push(tag);
    }
  }

  if (created.length === 0) {
    return { created, skipped, errors };
  }

  // Commit in Firestore writeBatch chunks of 400 documents
  const BATCH_SIZE = 400;
  try {
    for (let i = 0; i < created.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = created.slice(i, i + BATCH_SIZE);
      chunk.forEach((tag) => {
        batch.set(doc(db, 'location_tags', tag.id), stripUndefined(tag));
      });
      await batch.commit();
    }
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, 'location_tags/bulk');
    }
    throw err instanceof Error ? err : new Error('Failed to upload location tags.');
  }

  const createdIds = new Set(created.map((t) => t.id));
  const nextLocal = [...created, ...getLocalLocationTags().filter((t) => !createdIds.has(t.id))];
  saveLocalLocationTags(nextLocal);

  const uniqueStoresAffected = Array.from(new Set(created.map((t) => t.storeName)));
  const storeSummary =
    uniqueStoresAffected.length === 1
      ? uniqueStoresAffected[0]
      : `${uniqueStoresAffected.length} stores`;
  const storeIdSummary =
    uniqueStoresAffected.length === 1 ? created[0].storeId : 'ALL';
  const previewNames = created
    .slice(0, 8)
    .map((t) => t.name)
    .join(', ');

  await appendImmutableAuditLog({
    inventoryCountId: created[0].id,
    store: storeSummary.slice(0, 120),
    storeId: storeIdSummary.slice(0, 64),
    sku: 'LOCATION-TAG-BULK',
    itemDescription: `Bulk Uploaded ${created.length} Location Tag(s)`.slice(0, 500),
    location: previewNames.slice(0, 150),
    originalValue: `${skipped.length} duplicate(s) skipped`,
    newValue: `Approved ${created.length} tag(s): ${previewNames}${
      created.length > 8 ? ` (+${created.length - 8} more)` : ''
    }`.slice(0, 950),
    action: 'LOCATION_TAG_CREATED',
    approvalStatus: 'Approved',
    reason: (
      sourceLabel || `Admin bulk uploaded ${created.length} clickable location tag(s)`
    ).slice(0, 950),
    requestedBy: adminUser.displayName || 'Administrator',
    requestedById: adminUser.uid,
    reviewedBy: adminUser.displayName || 'Administrator',
    reviewedById: adminUser.uid,
  });

  return { created, skipped, errors };
}

/**
 * Admin batch creates multiple location tags (e.g. comma/newline separated).
 */
export async function bulkCreateAdminLocationTags(params: {
  store: Store | 'ALL';
  stores?: Store[];
  rawNames: string;
  zone?: string;
  adminUser: AppUser;
  existingTags: LocationTag[];
}): Promise<{ created: LocationTag[]; skipped: string[] }> {
  const { store, stores, rawNames, zone, adminUser, existingTags } = params;
  const parts = rawNames
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error('Enter at least one location tag name.');
  }

  const resolvedStores = stores && stores.length > 0 ? stores : store === 'ALL' ? [] : [store];
  const { created, skipped } = await bulkImportAdminLocationTags({
    defaultStore: store,
    stores: resolvedStores,
    items: parts.map((name) => ({ name, zone })),
    adminUser,
    existingTags,
    sourceLabel: `Admin batch created ${parts.length} location tag(s)`,
  });

  return { created, skipped };
}

/**
 * Admin deletes a location tag.
 */
export async function deleteAdminLocationTag(
  tag: LocationTag,
  adminUser: AppUser
): Promise<void> {
  if (adminUser.role !== 'admin') {
    throw new Error('Only Administrators can delete location tags.');
  }

  try {
    await deleteDoc(doc(db, 'location_tags', tag.id));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.DELETE, `location_tags/${tag.id}`);
    }
    throw err instanceof Error ? err : new Error('Failed to delete location tag.');
  }

  const next = getLocalLocationTags().filter((t) => t.id !== tag.id);
  saveLocalLocationTags(next);
}

/**
 * Supervisor submits a request for a new location tag (requires Admin approval before counters can use it).
 */
export async function requestLocationTag(params: {
  store: Store;
  name: string;
  zone?: string;
  code?: string;
  notes?: string;
  requester: AppUser;
  existingTags?: LocationTag[];
}): Promise<LocationTag> {
  const { store, name, zone, code, notes, requester, existingTags } = params;
  if (requester.role !== 'supervisor' && requester.role !== 'ops_supervisor') {
    throw new Error('Only Supervisors can request new location tags.');
  }

  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Location tag name is required.');
  }

  const tagId = getLocationTagId(store.storeId, trimmedName);
  const currentList = existingTags || getLocalLocationTags();
  const existing = currentList.find(
    (t) =>
      t.id === tagId ||
      (t.storeId === store.storeId &&
        t.name.trim().toLowerCase() === trimmedName.toLowerCase())
  );

  if (existing) {
    if (existing.status === 'approved') {
      throw new Error(
        `Location "${trimmedName}" is already approved for ${store.name}.`
      );
    }
    if (existing.status === 'pending_approval') {
      throw new Error(
        `Location "${trimmedName}" is already pending Admin approval.`
      );
    }
  }

  const sys = getSystemDateTime();
  const tag: LocationTag = {
    id: tagId,
    storeId: store.storeId,
    storeName: store.name,
    name: trimmedName,
    zone: zone?.trim() || undefined,
    code: code?.trim() || trimmedName,
    status: 'pending_approval',
    createdById: requester.uid,
    createdByName: requester.displayName || 'Supervisor',
    createdByRole: requester.role,
    createdAt: sys.timestamp,
    createdDate: sys.date,
    createdTime: sys.time,
    notes: notes?.trim() || undefined,
  };

  try {
    await setDoc(doc(db, 'location_tags', tagId), stripUndefined(tag));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `location_tags/${tagId}`);
    }
    throw err instanceof Error
      ? err
      : new Error('Failed to submit location tag request.');
  }

  upsertLocalLocationTag(tag);

  await appendImmutableAuditLog({
    inventoryCountId: tagId,
    store: store.name,
    storeId: store.storeId,
    sku: 'LOCATION-TAG',
    itemDescription: `Location Tag Request: ${trimmedName}`,
    location: trimmedName,
    originalValue: existing?.status === 'rejected' ? 'Rejected' : 'None',
    newValue: `Pending Admin Approval (${trimmedName}${tag.zone ? ` · Zone: ${tag.zone}` : ''})`,
    action: 'LOCATION_TAG_REQUESTED',
    approvalStatus: 'Pending',
    reason:
      notes?.trim() ||
      `Supervisor requested new location tag "${trimmedName}" for ${store.name}`,
    requestedBy: requester.displayName || 'Supervisor',
    requestedById: requester.uid,
  });

  return tag;
}

/**
 * Admin approves or rejects a pending supervisor location tag request.
 */
export async function reviewLocationTagRequest(params: {
  tag: LocationTag;
  decision: 'approved' | 'rejected';
  adminUser: AppUser;
  rejectionReason?: string;
}): Promise<LocationTag> {
  const { tag, decision, adminUser, rejectionReason } = params;
  if (adminUser.role !== 'admin') {
    throw new Error('Only Administrators can approve or reject location tag requests.');
  }

  if (tag.status !== 'pending_approval') {
    throw new Error('This location tag request has already been reviewed.');
  }

  const trimmedReason = (rejectionReason || '').trim();
  if (decision === 'rejected' && !trimmedReason) {
    throw new Error('Please enter a reason when rejecting a location tag request.');
  }

  const sys = getSystemDateTime();
  const updatedTag: LocationTag = {
    ...tag,
    status: decision,
    approvedById: adminUser.uid,
    approvedByName: adminUser.displayName || 'Administrator',
    approvedByRole: 'admin',
    approvedAt: sys.timestamp,
    approvedDate: sys.date,
    approvedTime: sys.time,
    rejectionReason: decision === 'rejected' ? trimmedReason : undefined,
  };

  try {
    await setDoc(doc(db, 'location_tags', tag.id), stripUndefined(updatedTag));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.UPDATE, `location_tags/${tag.id}`);
    }
    throw err instanceof Error
      ? err
      : new Error('Failed to update location tag approval.');
  }

  upsertLocalLocationTag(updatedTag);

  await appendImmutableAuditLog({
    inventoryCountId: tag.id,
    store: tag.storeName,
    storeId: tag.storeId,
    sku: 'LOCATION-TAG',
    itemDescription: `Location Tag: ${tag.name}`,
    location: tag.name,
    originalValue: 'Pending Admin Approval',
    newValue:
      decision === 'approved'
        ? `Approved (${tag.name})`
        : `Rejected (${trimmedReason})`,
    action:
      decision === 'approved'
        ? 'LOCATION_TAG_APPROVED'
        : 'LOCATION_TAG_REJECTED',
    approvalStatus: decision === 'approved' ? 'Approved' : 'Rejected',
    reason:
      decision === 'approved'
        ? `Admin approved supervisor location tag "${tag.name}"`
        : trimmedReason,
    requestedBy: tag.createdByName,
    requestedById: tag.createdById,
    reviewedBy: adminUser.displayName || 'Administrator',
    reviewedById: adminUser.uid,
  });

  return updatedTag;
}
