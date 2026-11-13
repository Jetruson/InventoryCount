import {
  InventoryCount,
  CorrectionRequest,
  CorrectionRequestType,
  CorrectionSnapshot,
  AuditLogEntry,
  AuditActionType,
  AppUser,
} from '../types/inventory';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  where,
  runTransaction,
} from 'firebase/firestore';

const LOCAL_REQUESTS_KEY = 'inventory_correction_requests_cache';
const LOCAL_AUDIT_LOGS_KEY = 'inventory_audit_logs_cache';

function getSystemDateTime(ts: number = Date.now()): { timestamp: number; date: string; time: string } {
  const d = new Date(ts);
  return {
    timestamp: ts,
    date: d.toISOString().split('T')[0],
    time: d.toTimeString().split(' ')[0],
  };
}

export function formatSnapshotSummary(s: Partial<CorrectionSnapshot>): string {
  const parts: string[] = [];
  if (s.countedQuantity !== undefined) parts.push(`Qty: ${s.countedQuantity}`);
  if (s.location !== undefined) parts.push(`Loc: ${s.location || '—'}`);
  if (s.condition !== undefined) parts.push(`Cond: ${s.condition}`);
  if (s.sku !== undefined) parts.push(`Item: ${s.sku}`);
  if (s.itemDescription) parts.push(`Desc: ${s.itemDescription}`);
  if (s.remarks) parts.push(`Remarks: ${s.remarks}`);
  return parts.join(' | ');
}

export function getLocalCorrectionRequests(): CorrectionRequest[] {
  try {
    const raw = localStorage.getItem(LOCAL_REQUESTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error reading local correction requests:', e);
  }
  return [];
}

export function saveLocalCorrectionRequests(requests: CorrectionRequest[]): void {
  try {
    localStorage.setItem(LOCAL_REQUESTS_KEY, JSON.stringify(requests));
  } catch (e) {
    console.warn('Error saving local correction requests:', e);
  }
}

export function getLocalAuditLogs(): AuditLogEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_AUDIT_LOGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Error reading local audit logs:', e);
  }
  return [];
}

export function saveLocalAuditLogs(logs: AuditLogEntry[]): void {
  try {
    localStorage.setItem(LOCAL_AUDIT_LOGS_KEY, JSON.stringify(logs));
  } catch (e) {
    console.warn('Error saving local audit logs:', e);
  }
}

function parseCorrectionRequestDoc(id: string, d: Record<string, any>): CorrectionRequest {
  return {
    id,
    requestType: d.requestType === 'void' ? 'void' : 'correction',
    inventoryCountId: d.inventoryCountId || '',
    targetVersion: typeof d.targetVersion === 'number' ? d.targetVersion : 1,
    store: d.store || '',
    storeId: d.storeId || '',
    sku: d.sku || '',
    barcode: d.barcode || '',
    itemDescription: d.itemDescription || '',
    originalValues: d.originalValues || {
      countedQuantity: 0,
      location: '',
      itemDescription: d.itemDescription || '',
      sku: d.sku || '',
      barcode: d.barcode || '',
      condition: 'Good',
      remarks: '',
    },
    proposedValues: d.proposedValues || {
      countedQuantity: 0,
      location: '',
      itemDescription: d.itemDescription || '',
      sku: d.sku || '',
      barcode: d.barcode || '',
      condition: 'Good',
      remarks: '',
    },
    changedFields: Array.isArray(d.changedFields) ? d.changedFields : [],
    reason: d.reason || '',
    attachmentName: d.attachmentName,
    attachmentDataUrl: d.attachmentDataUrl,
    status: d.status === 'approved' || d.status === 'rejected' ? d.status : 'pending',
    requestedById: d.requestedById || '',
    requestedByUsername: d.requestedByUsername || '',
    requestedByRole: d.requestedByRole || 'counter',
    requestedAt: typeof d.requestedAt === 'number' ? d.requestedAt : Date.now(),
    requestedDate: d.requestedDate || '',
    requestedTime: d.requestedTime || '',
    reviewedById: d.reviewedById,
    reviewedByUsername: d.reviewedByUsername,
    reviewedByRole: d.reviewedByRole,
    reviewedAt: d.reviewedAt,
    reviewedDate: d.reviewedDate,
    reviewedTime: d.reviewedTime,
    rejectionReason: d.rejectionReason,
    syncStatus: 'synced',
  };
}

function parseAuditLogDoc(id: string, d: Record<string, any>): AuditLogEntry {
  return {
    id,
    inventoryCountId: d.inventoryCountId || '',
    correctionRequestId: d.correctionRequestId,
    store: d.store || '',
    storeId: d.storeId || '',
    sku: d.sku || '',
    barcode: d.barcode || '',
    itemDescription: d.itemDescription || '',
    location: d.location || '',
    originalValue: d.originalValue || '',
    newValue: d.newValue || '',
    action: (d.action as AuditActionType) || 'COUNT_SUBMITTED',
    approvalStatus: d.approvalStatus || 'N/A',
    reason: d.reason || '',
    requestedBy: d.requestedBy || '',
    requestedById: d.requestedById || '',
    reviewedBy: d.reviewedBy,
    reviewedById: d.reviewedById,
    timestamp: typeof d.timestamp === 'number' ? d.timestamp : Date.now(),
    date: d.date || '',
    time: d.time || '',
  };
}

export function subscribeToCorrectionRequests(
  onUpdate: (requests: CorrectionRequest[]) => void
): () => void {
  try {
    const q = query(collection(db, 'correction_requests'), orderBy('requestedAt', 'desc'), limit(1000));
    return onSnapshot(
      q,
      (snapshot) => {
        const list: CorrectionRequest[] = [];
        snapshot.forEach((docSnap) => {
          list.push(parseCorrectionRequestDoc(docSnap.id, docSnap.data()));
        });
        saveLocalCorrectionRequests(list);
        onUpdate(list);
      },
      (err) => {
        console.warn('Realtime correction_requests listener error:', err);
        onUpdate(getLocalCorrectionRequests());
      }
    );
  } catch (err) {
    console.warn('Could not attach correction_requests listener:', err);
    onUpdate(getLocalCorrectionRequests());
    return () => {};
  }
}

export function subscribeToAuditLogs(onUpdate: (logs: AuditLogEntry[]) => void): () => void {
  try {
    const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(2000));
    return onSnapshot(
      q,
      (snapshot) => {
        const list: AuditLogEntry[] = [];
        snapshot.forEach((docSnap) => {
          list.push(parseAuditLogDoc(docSnap.id, docSnap.data()));
        });
        saveLocalAuditLogs(list);
        onUpdate(list);
      },
      (err) => {
        console.warn('Realtime audit_logs listener error:', err);
        onUpdate(getLocalAuditLogs());
      }
    );
  } catch (err) {
    console.warn('Could not attach audit_logs listener:', err);
    onUpdate(getLocalAuditLogs());
    return () => {};
  }
}

function buildAuditLogPayload(
  params: Omit<AuditLogEntry, 'id' | 'timestamp' | 'date' | 'time'> & { timestampOffsetMs?: number }
): AuditLogEntry {
  const { timestampOffsetMs = 0, ...rest } = params;
  const sys = getSystemDateTime(Date.now() + timestampOffsetMs);
  const id = `AUD-${sys.timestamp}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const clean: AuditLogEntry = {
    ...rest,
    sku: (rest.sku || 'UNKNOWN').slice(0, 100),
    itemDescription: (rest.itemDescription || '').slice(0, 500),
    originalValue: (rest.originalValue || '').slice(0, 1000),
    newValue: (rest.newValue || '').slice(0, 1000),
    reason: (rest.reason || '').slice(0, 1000),
    requestedBy: (rest.requestedBy || 'Associate').slice(0, 150),
    id,
    timestamp: sys.timestamp,
    date: sys.date,
    time: sys.time,
  };
  return clean;
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

export async function appendImmutableAuditLog(
  entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'date' | 'time'>
): Promise<AuditLogEntry> {
  const log = buildAuditLogPayload(entry);
  const existing = getLocalAuditLogs();
  saveLocalAuditLogs([log, ...existing]);

  try {
    await setDoc(doc(db, 'audit_logs', log.id), stripUndefined(log));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.CREATE, `audit_logs/${log.id}`);
    }
    console.warn('Audit log cached locally (offline/retry):', err);
  }
  return log;
}

export async function recordCountSubmittedAuditLog(count: InventoryCount): Promise<void> {
  const snapshot: CorrectionSnapshot = {
    countedQuantity: count.countedQuantity,
    location: count.location || '',
    itemDescription: count.itemDescription,
    sku: count.sku,
    barcode: count.barcode,
    condition: count.condition || 'Good',
    remarks: count.remarks || '',
  };

  await appendImmutableAuditLog({
    inventoryCountId: count.id,
    store: count.store,
    storeId: count.storeId,
    sku: count.sku,
    barcode: count.barcode,
    itemDescription: count.itemDescription,
    location: count.location || '—',
    originalValue: 'New Submission (None)',
    newValue: formatSnapshotSummary(snapshot),
    action: 'COUNT_SUBMITTED',
    approvalStatus: 'N/A',
    reason: 'Initial physical inventory count submission',
    requestedBy: count.username,
    requestedById: count.userId,
  });
}

export interface SubmitCorrectionParams {
  count: InventoryCount;
  requestType: CorrectionRequestType;
  proposedValues: CorrectionSnapshot;
  reason: string;
  currentUser: AppUser;
  attachmentName?: string;
  attachmentDataUrl?: string;
}

export async function submitCorrectionOrVoidRequest(
  params: SubmitCorrectionParams
): Promise<CorrectionRequest> {
  const { count, requestType, proposedValues, reason, currentUser, attachmentName, attachmentDataUrl } = params;

  if (currentUser.role === 'audit' || currentUser.role === 'admin') {
    throw new Error('Your role is not permitted to submit operational correction or void requests.');
  }
  if (count.status === 'voided') {
    throw new Error('This count record has already been voided and cannot be modified.');
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new Error('A mandatory reason is required to submit this request.');
  }

  if (attachmentDataUrl && attachmentDataUrl.length > 280000) {
    throw new Error('Attachment file is too large. Please keep attachments under 200 KB.');
  }

  // Concurrency check: disallow duplicate pending request on the same inventory count
  const localPending = getLocalCorrectionRequests().some(
    (r) => r.inventoryCountId === count.id && r.status === 'pending'
  );
  if (localPending) {
    throw new Error('A pending correction or void request already exists for this record. Wait for supervisor review.');
  }

  try {
    const existingPendingSnap = await getDocs(
      query(
        collection(db, 'correction_requests'),
        where('inventoryCountId', '==', count.id),
        where('status', '==', 'pending')
      )
    );
    if (!existingPendingSnap.empty) {
      throw new Error('A pending correction or void request already exists for this record. Wait for supervisor review.');
    }
  } catch (err: any) {
    if (err?.message?.includes('pending correction or void request')) {
      throw err;
    }
  }

  const originalValues: CorrectionSnapshot = {
    countedQuantity: Number(count.countedQuantity) || 0,
    location: count.location || '',
    itemDescription: count.itemDescription || '',
    sku: count.sku || '',
    barcode: count.barcode || '',
    condition: count.condition || 'Good',
    remarks: count.remarks || '',
  };

  const changedFields: string[] = [];
  if (requestType === 'void') {
    changedFields.push('void');
  } else {
    if (Number(proposedValues.countedQuantity) < 0 || isNaN(Number(proposedValues.countedQuantity))) {
      throw new Error('Proposed quantity must be zero or greater.');
    }
    if (Number(proposedValues.countedQuantity) !== originalValues.countedQuantity) {
      changedFields.push('countedQuantity');
    }
    if (proposedValues.location.trim() !== originalValues.location.trim()) {
      changedFields.push('location');
    }
    if (
      proposedValues.sku.trim() !== originalValues.sku.trim() ||
      proposedValues.barcode.trim() !== originalValues.barcode.trim() ||
      proposedValues.itemDescription.trim() !== originalValues.itemDescription.trim()
    ) {
      changedFields.push('itemDetails');
    }
    if (proposedValues.condition !== originalValues.condition) {
      changedFields.push('condition');
    }
    if (proposedValues.remarks.trim() !== originalValues.remarks.trim()) {
      changedFields.push('remarks');
    }
    if (changedFields.length === 0) {
      throw new Error('Please modify at least one field before submitting a correction request.');
    }
  }

  const sys = getSystemDateTime();
  const reqId = `REQ-${sys.timestamp}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  const requestObj: CorrectionRequest = {
    id: reqId,
    requestType,
    inventoryCountId: count.id,
    targetVersion: count.version || 1,
    store: count.store,
    storeId: count.storeId,
    sku: count.sku,
    barcode: count.barcode,
    itemDescription: count.itemDescription,
    originalValues,
    proposedValues:
      requestType === 'void'
        ? originalValues
        : {
            ...proposedValues,
            countedQuantity: Number(proposedValues.countedQuantity),
            location: proposedValues.location.trim(),
            sku: proposedValues.sku.trim(),
            barcode: proposedValues.barcode.trim(),
            itemDescription: proposedValues.itemDescription.trim(),
            remarks: proposedValues.remarks.trim(),
          },
    changedFields,
    reason: trimmedReason,
    attachmentName,
    attachmentDataUrl,
    status: 'pending',
    requestedById: currentUser.uid,
    requestedByUsername: currentUser.displayName || currentUser.email,
    requestedByRole: currentUser.role,
    requestedAt: sys.timestamp,
    requestedDate: sys.date,
    requestedTime: sys.time,
    syncStatus: 'synced',
  };

  try {
    await setDoc(doc(db, 'correction_requests', reqId), stripUndefined(requestObj));
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.CREATE, `correction_requests/${reqId}`);
    }
    throw new Error('Failed to submit request to server. Check your connection and try again.');
  }

  const cachedReqs = getLocalCorrectionRequests();
  saveLocalCorrectionRequests([requestObj, ...cachedReqs]);

  await appendImmutableAuditLog({
    inventoryCountId: count.id,
    correctionRequestId: reqId,
    store: count.store,
    storeId: count.storeId,
    sku: count.sku,
    barcode: count.barcode,
    itemDescription: count.itemDescription,
    location: count.location || '—',
    originalValue: formatSnapshotSummary(originalValues),
    newValue:
      requestType === 'void'
        ? 'VOID REQUESTED (Pending Approval)'
        : formatSnapshotSummary(requestObj.proposedValues),
    action: requestType === 'void' ? 'VOID_REQUESTED' : 'CORRECTION_REQUESTED',
    approvalStatus: 'Pending',
    reason: trimmedReason,
    requestedBy: requestObj.requestedByUsername,
    requestedById: requestObj.requestedById,
  });

  return requestObj;
}

function assertReviewerAuthorized(
  requestedByRole: string | undefined,
  reviewer: AppUser,
  requestStoreId?: string
): void {
  const isSupervisorRequest =
    requestedByRole === 'supervisor' || requestedByRole === 'ops_supervisor';

  if (isSupervisorRequest) {
    if (reviewer.role !== 'audit') {
      throw new Error(
        'Correction and void requests submitted by supervisors must be approved or rejected by an Audit user.'
      );
    }
    const auditStoreId =
      reviewer.assignedStoreId && reviewer.assignedStoreId !== 'ALL'
        ? reviewer.assignedStoreId
        : undefined;
    if (auditStoreId && requestStoreId && auditStoreId !== requestStoreId) {
      throw new Error(
        'Store-scoped Audit users can only review requests for their assigned store.'
      );
    }
    return;
  }

  if (requestedByRole === 'ops_counter') {
    if (reviewer.role !== 'ops_supervisor') {
      throw new Error(
        'Requests from multi-store Counters (Operations Counter) can only be approved or rejected by the Counter Supervisor (Ops).'
      );
    }
    return;
  }

  // Default / 'counter': Store-specific Counter -> Store Supervisor of the SAME store only
  if (reviewer.role !== 'supervisor') {
    throw new Error(
      'Requests from store-assigned Counters can only be approved or rejected by the Store Supervisor of that same store.'
    );
  }

  const reviewerStoreId =
    reviewer.assignedStoreId && reviewer.assignedStoreId !== 'ALL'
      ? reviewer.assignedStoreId
      : reviewer.activeStoreId;

  if (!reviewerStoreId || (requestStoreId && reviewerStoreId !== requestStoreId)) {
    throw new Error(
      'Store Supervisors can only approve or reject requests from counters of the same assigned store.'
    );
  }
}

export async function approveCorrectionOrVoidRequest(
  request: CorrectionRequest,
  reviewer: AppUser
): Promise<void> {
  assertReviewerAuthorized(request.requestedByRole, reviewer, request.storeId);

  const reviewerName = reviewer.displayName || reviewer.email || 'Reviewer';
  if (
    reviewer.uid === request.requestedById ||
    reviewerName.toLowerCase() === request.requestedByUsername.toLowerCase()
  ) {
    throw new Error('Self-approval is strictly prohibited. Another authorized reviewer must approve this request.');
  }

  const sys = getSystemDateTime();
  const reqRef = doc(db, 'correction_requests', request.id);
  const countRef = doc(db, 'inventory_counts', request.inventoryCountId);

  const generatedAuditLogs: AuditLogEntry[] = [];

  try {
    await runTransaction(db, async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists()) {
        throw new Error('Correction request record no longer exists.');
      }
      const reqData = reqSnap.data();
      assertReviewerAuthorized(reqData.requestedByRole, reviewer, reqData.storeId || request.storeId);
      if (reqData.status !== 'pending') {
        throw new Error(`This request was already ${reqData.status} by ${reqData.reviewedByUsername || 'another reviewer'}.`);
      }

      const countSnap = await tx.get(countRef);
      if (!countSnap.exists()) {
        throw new Error('Target inventory count record was not found in database.');
      }
      const countData = countSnap.data();
      if (countData.status === 'voided') {
        throw new Error('Target inventory count record has already been voided.');
      }

      const currentVersion = typeof countData.version === 'number' ? countData.version : 1;
      if (currentVersion !== request.targetVersion) {
        throw new Error(
          'Concurrency conflict: this inventory record was modified after the request was created. Reject this request and submit a new one.'
        );
      }

      // 1. Update Correction Request status
      tx.update(reqRef, {
        status: 'approved',
        reviewedById: reviewer.uid,
        reviewedByUsername: reviewerName,
        reviewedByRole: reviewer.role,
        reviewedAt: sys.timestamp,
        reviewedDate: sys.date,
        reviewedTime: sys.time,
      });

      // 2. Apply approved change to active InventoryCount while preserving original entry fields
      const preservedOriginals = {
        originalQuantity:
          typeof countData.originalQuantity === 'number'
            ? countData.originalQuantity
            : Number(countData.countedQuantity) || 0,
        originalLocation:
          countData.originalLocation !== undefined
            ? countData.originalLocation
            : countData.location || '',
        originalCondition: countData.originalCondition || countData.condition || 'Good',
        originalRemarks:
          countData.originalRemarks !== undefined ? countData.originalRemarks : countData.remarks || '',
      };

      if (request.requestType === 'void') {
        tx.update(countRef, {
          ...preservedOriginals,
          status: 'voided',
          version: currentVersion + 1,
          voidedAt: sys.timestamp,
          voidedBy: reviewerName,
          voidReason: request.reason,
          lastModifiedAt: sys.timestamp,
          lastModifiedBy: reviewerName,
        });

        const voidAudit = buildAuditLogPayload({
          inventoryCountId: request.inventoryCountId,
          correctionRequestId: request.id,
          store: request.store,
          storeId: request.storeId,
          sku: request.sku,
          barcode: request.barcode,
          itemDescription: request.itemDescription,
          location: request.originalValues.location || '—',
          originalValue: formatSnapshotSummary(request.originalValues),
          newValue: `VOIDED (${request.reason})`,
          action: 'RECORD_VOIDED',
          approvalStatus: 'Approved',
          reason: request.reason,
          requestedBy: request.requestedByUsername,
          requestedById: request.requestedById,
          reviewedBy: reviewerName,
          reviewedById: reviewer.uid,
        });
        tx.set(doc(db, 'audit_logs', voidAudit.id), stripUndefined(voidAudit));
        generatedAuditLogs.push(voidAudit);
      } else {
        const p = request.proposedValues;
        tx.update(countRef, {
          ...preservedOriginals,
          status: 'active',
          version: currentVersion + 1,
          countedQuantity: Number(p.countedQuantity),
          location: p.location,
          sku: p.sku,
          barcode: p.barcode,
          itemDescription: p.itemDescription,
          condition: p.condition,
          remarks: p.remarks,
          lastModifiedAt: sys.timestamp,
          lastModifiedBy: reviewerName,
        });

        const approvalAudit = buildAuditLogPayload({
          inventoryCountId: request.inventoryCountId,
          correctionRequestId: request.id,
          store: request.store,
          storeId: request.storeId,
          sku: p.sku,
          barcode: p.barcode,
          itemDescription: p.itemDescription,
          location: p.location || '—',
          originalValue: formatSnapshotSummary(request.originalValues),
          newValue: formatSnapshotSummary(p),
          action: 'CORRECTION_APPROVED',
          approvalStatus: 'Approved',
          reason: request.reason,
          requestedBy: request.requestedByUsername,
          requestedById: request.requestedById,
          reviewedBy: reviewerName,
          reviewedById: reviewer.uid,
        });
        tx.set(doc(db, 'audit_logs', approvalAudit.id), stripUndefined(approvalAudit));
        generatedAuditLogs.push(approvalAudit);

        // Record granular change events for quantity, location, and item details
        let offset = 1;
        if (request.changedFields.includes('countedQuantity')) {
          const qtyAudit = buildAuditLogPayload({
            timestampOffsetMs: offset++,
            inventoryCountId: request.inventoryCountId,
            correctionRequestId: request.id,
            store: request.store,
            storeId: request.storeId,
            sku: p.sku,
            barcode: p.barcode,
            itemDescription: p.itemDescription,
            location: p.location || '—',
            originalValue: `Qty: ${request.originalValues.countedQuantity}`,
            newValue: `Qty: ${p.countedQuantity}`,
            action: 'QUANTITY_CHANGED',
            approvalStatus: 'Approved',
            reason: request.reason,
            requestedBy: request.requestedByUsername,
            requestedById: request.requestedById,
            reviewedBy: reviewerName,
            reviewedById: reviewer.uid,
          });
          tx.set(doc(db, 'audit_logs', qtyAudit.id), stripUndefined(qtyAudit));
          generatedAuditLogs.push(qtyAudit);
        }

        if (request.changedFields.includes('location')) {
          const locAudit = buildAuditLogPayload({
            timestampOffsetMs: offset++,
            inventoryCountId: request.inventoryCountId,
            correctionRequestId: request.id,
            store: request.store,
            storeId: request.storeId,
            sku: p.sku,
            barcode: p.barcode,
            itemDescription: p.itemDescription,
            location: p.location || '—',
            originalValue: `Loc: ${request.originalValues.location || '—'}`,
            newValue: `Loc: ${p.location || '—'}`,
            action: 'LOCATION_CHANGED',
            approvalStatus: 'Approved',
            reason: request.reason,
            requestedBy: request.requestedByUsername,
            requestedById: request.requestedById,
            reviewedBy: reviewerName,
            reviewedById: reviewer.uid,
          });
          tx.set(doc(db, 'audit_logs', locAudit.id), stripUndefined(locAudit));
          generatedAuditLogs.push(locAudit);
        }

        if (
          request.changedFields.includes('itemDetails') ||
          request.changedFields.includes('condition') ||
          request.changedFields.includes('remarks')
        ) {
          const itemAudit = buildAuditLogPayload({
            timestampOffsetMs: offset++,
            inventoryCountId: request.inventoryCountId,
            correctionRequestId: request.id,
            store: request.store,
            storeId: request.storeId,
            sku: p.sku,
            barcode: p.barcode,
            itemDescription: p.itemDescription,
            location: p.location || '—',
            originalValue: `${request.originalValues.sku} | ${request.originalValues.itemDescription} | Cond: ${request.originalValues.condition}`,
            newValue: `${p.sku} | ${p.itemDescription} | Cond: ${p.condition}`,
            action: 'ITEM_DETAILS_CHANGED',
            approvalStatus: 'Approved',
            reason: request.reason,
            requestedBy: request.requestedByUsername,
            requestedById: request.requestedById,
            reviewedBy: reviewerName,
            reviewedById: reviewer.uid,
          });
          tx.set(doc(db, 'audit_logs', itemAudit.id), stripUndefined(itemAudit));
          generatedAuditLogs.push(itemAudit);
        }
      }
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `correction_requests/${request.id}`);
    }
    throw err instanceof Error ? err : new Error('Failed to approve request.');
  }

  // Update local caches
  const updatedReqs = getLocalCorrectionRequests().map((r) =>
    r.id === request.id
      ? {
          ...r,
          status: 'approved' as const,
          reviewedById: reviewer.uid,
          reviewedByUsername: reviewerName,
          reviewedByRole: reviewer.role,
          reviewedAt: sys.timestamp,
          reviewedDate: sys.date,
          reviewedTime: sys.time,
        }
      : r
  );
  saveLocalCorrectionRequests(updatedReqs);

  if (generatedAuditLogs.length > 0) {
    saveLocalAuditLogs([...generatedAuditLogs.reverse(), ...getLocalAuditLogs()]);
  }
}

export async function rejectCorrectionOrVoidRequest(
  request: CorrectionRequest,
  reviewer: AppUser,
  rejectionReason: string
): Promise<void> {
  assertReviewerAuthorized(request.requestedByRole, reviewer, request.storeId);

  const trimmedRejection = rejectionReason.trim();
  if (!trimmedRejection) {
    throw new Error('A mandatory rejection reason is required.');
  }

  const reviewerName = reviewer.displayName || reviewer.email || 'Reviewer';
  if (
    reviewer.uid === request.requestedById ||
    reviewerName.toLowerCase() === request.requestedByUsername.toLowerCase()
  ) {
    throw new Error('Users cannot review their own correction or void requests.');
  }

  const sys = getSystemDateTime();
  const reqRef = doc(db, 'correction_requests', request.id);
  let rejectAudit: AuditLogEntry | null = null;

  try {
    await runTransaction(db, async (tx) => {
      const reqSnap = await tx.get(reqRef);
      if (!reqSnap.exists()) {
        throw new Error('Correction request record no longer exists.');
      }
      const reqData = reqSnap.data();
      assertReviewerAuthorized(reqData.requestedByRole, reviewer, reqData.storeId || request.storeId);
      if (reqData.status !== 'pending') {
        throw new Error(`This request was already ${reqData.status} by ${reqData.reviewedByUsername || 'another reviewer'}.`);
      }

      tx.update(reqRef, {
        status: 'rejected',
        rejectionReason: trimmedRejection,
        reviewedById: reviewer.uid,
        reviewedByUsername: reviewerName,
        reviewedByRole: reviewer.role,
        reviewedAt: sys.timestamp,
        reviewedDate: sys.date,
        reviewedTime: sys.time,
      });

      rejectAudit = buildAuditLogPayload({
        inventoryCountId: request.inventoryCountId,
        correctionRequestId: request.id,
        store: request.store,
        storeId: request.storeId,
        sku: request.sku,
        barcode: request.barcode,
        itemDescription: request.itemDescription,
        location: request.originalValues.location || '—',
        originalValue: formatSnapshotSummary(request.originalValues),
        newValue:
          request.requestType === 'void'
            ? 'VOID REJECTED (Remains Active)'
            : `REJECTED: ${formatSnapshotSummary(request.proposedValues)}`,
        action: request.requestType === 'void' ? 'VOID_REJECTED' : 'CORRECTION_REJECTED',
        approvalStatus: 'Rejected',
        reason: `Request reason: ${request.reason} | Rejection reason: ${trimmedRejection}`,
        requestedBy: request.requestedByUsername,
        requestedById: request.requestedById,
        reviewedBy: reviewerName,
        reviewedById: reviewer.uid,
      });
      tx.set(doc(db, 'audit_logs', rejectAudit.id), stripUndefined(rejectAudit));
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      handleFirestoreError(err, OperationType.WRITE, `correction_requests/${request.id}`);
    }
    throw err instanceof Error ? err : new Error('Failed to reject request.');
  }

  const updatedReqs = getLocalCorrectionRequests().map((r) =>
    r.id === request.id
      ? {
          ...r,
          status: 'rejected' as const,
          rejectionReason: trimmedRejection,
          reviewedById: reviewer.uid,
          reviewedByUsername: reviewerName,
          reviewedByRole: reviewer.role,
          reviewedAt: sys.timestamp,
          reviewedDate: sys.date,
          reviewedTime: sys.time,
        }
      : r
  );
  saveLocalCorrectionRequests(updatedReqs);

  if (rejectAudit) {
    saveLocalAuditLogs([rejectAudit, ...getLocalAuditLogs()]);
  }
}
