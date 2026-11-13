export type ItemCondition = 'Good' | 'Damage';

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
