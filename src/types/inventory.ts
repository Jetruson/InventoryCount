export type ItemCondition = 'Good' | 'Damage';
export type CountRecordStatus = 'active' | 'voided';
export type CountType = 'cycle' | 'annual';
export type CountingSessionStatus = 'active' | 'closed';

export interface CountingSession {
  id: string;
  countType: CountType;
  title: string;
  cutoffDate: string; // YYYY-MM-DD
  storeId: string; // Specific storeId or 'ALL'
  storeName: string;
  status: CountingSessionStatus;
  createdById: string;
  createdByName: string;
  createdByRole: UserRole;
  createdAt: number;
  createdDate: string;
  createdTime: string;
  closedAt?: number;
  closedById?: string;
  closedByName?: string;
  closedByRole?: UserRole;
  reopenedAt?: number;
  reopenedById?: string;
  reopenedByName?: string;
  reopenedByRole?: UserRole;
  notes?: string;
  isDefaultBaseline?: boolean;
}

export interface InventoryCount {
  id: string;
  username: string;
  userId: string;
  store: string;
  storeId: string;
  sku: string;
  barcode: string;
  itemDescription: string;
  countedQuantity: number;
  condition?: ItemCondition;
  remarks: string;
  location?: string; // Shelf, Aisle, Bin, or Bay barcode/code
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  createdAt: number; // millisecond timestamp
  syncStatus?: 'synced' | 'pending';
  status?: CountRecordStatus; // Soft-delete status ('active' | 'voided')
  originalQuantity?: number;
  originalLocation?: string;
  originalCondition?: ItemCondition;
  originalRemarks?: string;
  version?: number;
  lastModifiedAt?: number;
  lastModifiedBy?: string;
  voidedAt?: number;
  voidedBy?: string;
  voidReason?: string;
  countRound?: 1 | 2;
  recountTaskId?: string;
  countType?: CountType;
  sessionId?: string;
  cutoffDate?: string;
}

export type CorrectionRequestType = 'correction' | 'void';
export type CorrectionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface CorrectionSnapshot {
  countedQuantity: number;
  location: string;
  itemDescription: string;
  sku: string;
  barcode: string;
  condition: ItemCondition;
  remarks: string;
}

export interface CorrectionRequest {
  id: string;
  requestType: CorrectionRequestType;
  inventoryCountId: string;
  targetVersion: number;
  store: string;
  storeId: string;
  sku: string;
  barcode: string;
  itemDescription: string;
  originalValues: CorrectionSnapshot;
  proposedValues: CorrectionSnapshot;
  changedFields: string[];
  reason: string;
  attachmentName?: string;
  attachmentDataUrl?: string;
  status: CorrectionRequestStatus;
  requestedById: string;
  requestedByUsername: string;
  requestedByRole: UserRole;
  requestedAt: number;
  requestedDate: string;
  requestedTime: string;
  reviewedById?: string;
  reviewedByUsername?: string;
  reviewedByRole?: UserRole;
  reviewedAt?: number;
  reviewedDate?: string;
  reviewedTime?: string;
  rejectionReason?: string;
  syncStatus?: 'synced' | 'pending';
  countType?: CountType;
  sessionId?: string;
  cutoffDate?: string;
}

export type AuditActionType =
  | 'COUNT_SUBMITTED'
  | 'CORRECTION_REQUESTED'
  | 'VOID_REQUESTED'
  | 'CORRECTION_APPROVED'
  | 'CORRECTION_REJECTED'
  | 'QUANTITY_CHANGED'
  | 'LOCATION_CHANGED'
  | 'ITEM_DETAILS_CHANGED'
  | 'RECORD_VOIDED'
  | 'VOID_REJECTED'
  | 'COUNTS_PURGED'
  | 'LOCATION_DONE_SUBMITTED'
  | 'LOCATION_VERIFIED'
  | 'LOCATION_RECOUNT_FLAGGED'
  | 'RECOUNT_TASK_OPENED'
  | 'RECOUNT_COUNTER_ASSIGNED'
  | 'SECOND_COUNT_SUBMITTED'
  | 'SECOND_COUNT_VERIFIED'
  | 'SECOND_COUNT_REOPENED'
  | 'LOCATION_TAG_CREATED'
  | 'LOCATION_TAG_REQUESTED'
  | 'LOCATION_TAG_APPROVED'
  | 'LOCATION_TAG_REJECTED'
  | 'COUNT_FINALIZED'
  | 'COUNT_REOPENED'
  | 'COUNT_SESSION_CREATED'
  | 'COUNT_SESSION_CLOSED'
  | 'COUNT_SESSION_REOPENED';

export interface AuditLogEntry {
  id: string;
  inventoryCountId: string;
  correctionRequestId?: string;
  store: string;
  storeId: string;
  sku: string;
  barcode?: string;
  itemDescription: string;
  location: string;
  originalValue: string;
  newValue: string;
  action: AuditActionType;
  approvalStatus: 'N/A' | 'Pending' | 'Approved' | 'Rejected';
  reason: string;
  requestedBy: string;
  requestedById: string;
  reviewedBy?: string;
  reviewedById?: string;
  timestamp: number;
  date: string;
  time: string;
  countType?: CountType;
  sessionId?: string;
  cutoffDate?: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  description: string;
  category: string;
  unit: string;
  systemStock?: number;
}

export interface Store {
  storeId: string;
  name: string;
  location: string;
}

export type UserRole = 'counter' | 'ops_counter' | 'supervisor' | 'ops_supervisor' | 'audit' | 'admin';

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  activeStoreId?: string;
  assignedStoreId?: string; // For store supervisors and store counters (strictly locked to this store)
  assignedStoreName?: string;
}

export interface ManagedUser {
  id: string; // unique ID
  username: string; // username or login email
  displayName: string;
  password?: string; // access code or password
  role: UserRole;
  assignedStoreId: string;
  assignedStoreName: string;
  createdAt: string;
  createdBy?: string;
  isActive: boolean;
}

export interface MasterlistItem {
  sku: string;
  barcode: string;
  description: string;
  category?: string;
  unit?: string;
  systemStock?: number;
}

export interface CountVarianceItem {
  sku: string;
  barcode: string;
  description: string;
  category: string;
  systemStock: number;
  countedQuantity: number;
  variance: number; // countedQuantity - systemStock
  status: 'matched' | 'over' | 'under' | 'uncounted';
  storesFound: string[];
  locationsFound: string[];
}

export type LocationVerificationStatus = 'pending_verification' | 'verified' | 'recount_needed';

export interface LocationVerification {
  id: string;
  storeId: string;
  storeName: string;
  location: string;
  status: LocationVerificationStatus;
  submittedById: string;
  submittedByName: string;
  submittedByRole: UserRole;
  submittedAt: number;
  submittedDate: string;
  submittedTime: string;
  counterNotes?: string;
  itemCountSnapshot: number;
  totalUnitsSnapshot: number;
  verifiedById?: string;
  verifiedByName?: string;
  verifiedByRole?: UserRole;
  verifiedAt?: number;
  verifiedDate?: string;
  verifiedTime?: string;
  supervisorNotes?: string;
  doneCounting?: boolean;
  countType?: CountType;
  sessionId?: string;
  cutoffDate?: string;
}

export type LocationRecountStatus = 'open' | 'pending_review' | 'verified';

export interface VarianceSkuTarget {
  sku: string;
  barcode: string;
  description: string;
  unit: string;
  systemStock: number;
  firstCountQty: number;
  variance: number;
}

export interface LocationRecountTask {
  id: string;
  storeId: string;
  storeName: string;
  location: string;
  status: LocationRecountStatus;
  varianceSkus: VarianceSkuTarget[];
  excludedCounterIds: string[];
  excludedCounterNames: string[];
  openedById: string;
  openedByName: string;
  openedByRole: UserRole;
  openedAt: number;
  openedDate: string;
  openedTime: string;
  assignedCounterId?: string;
  assignedCounterName?: string;
  assignedCounterRole?: UserRole;
  assignedById?: string;
  assignedByName?: string;
  assignedAt?: number;
  submittedById?: string;
  submittedByName?: string;
  submittedByRole?: UserRole;
  submittedAt?: number;
  submittedDate?: string;
  submittedTime?: string;
  counterNotes?: string;
  verifiedById?: string;
  verifiedByName?: string;
  verifiedByRole?: UserRole;
  verifiedAt?: number;
  verifiedDate?: string;
  verifiedTime?: string;
  supervisorNotes?: string;
  countType?: CountType;
  sessionId?: string;
  cutoffDate?: string;
}

export type LocationTagStatus = 'approved' | 'pending_approval' | 'rejected';

export interface LocationTag {
  id: string;
  storeId: string;
  storeName: string;
  name: string;
  zone?: string;
  code?: string;
  status: LocationTagStatus;
  createdById: string;
  createdByName: string;
  createdByRole: UserRole;
  createdAt: number;
  createdDate: string;
  createdTime: string;
  approvedById?: string;
  approvedByName?: string;
  approvedByRole?: UserRole;
  approvedAt?: number;
  approvedDate?: string;
  approvedTime?: string;
  rejectionReason?: string;
  notes?: string;
}

export type StoreCountFinalizationStatus = 'counting' | 'finalized';

export interface StoreCountFinalization {
  id: string;
  storeId: string;
  storeName: string;
  status: StoreCountFinalizationStatus;
  finalizedById?: string;
  finalizedByName?: string;
  finalizedByRole?: UserRole;
  finalizedAt?: number;
  finalizedDate?: string;
  finalizedTime?: string;
  reopenedById?: string;
  reopenedByName?: string;
  reopenedByRole?: UserRole;
  reopenedAt?: number;
  notes?: string;
  countType?: CountType;
  sessionId?: string;
  cutoffDate?: string;
}
