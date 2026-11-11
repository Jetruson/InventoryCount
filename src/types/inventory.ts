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

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'counter' | 'supervisor' | 'admin';
  activeStoreId?: string;
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
