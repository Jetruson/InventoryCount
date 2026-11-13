export type ItemCondition = 'Good' | 'Damage';
export type CountRecordStatus = 'active' | 'voided';

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
  | 'VOID_REJECTED';

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
