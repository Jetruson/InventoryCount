import { Product, MasterlistItem } from '../types/inventory';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';

export const SEED_PRODUCTS: Product[] = [
  {
    id: 'prod-001',
    sku: 'APP-TEE-BLK-M',
    barcode: '012345678905',
    description: 'Cotton Crewneck T-Shirt - Black / Medium',
    category: 'Apparel',
    unit: 'pcs',
    systemStock: 45,
  },
  {
    id: 'prod-002',
    sku: 'APP-TEE-WHT-L',
    barcode: '012345678912',
    description: 'Cotton Crewneck T-Shirt - White / Large',
    category: 'Apparel',
    unit: 'pcs',
    systemStock: 30,
  },
  {
    id: 'prod-003',
    sku: 'APP-HDY-GRY-L',
    barcode: '012345678929',
    description: 'Heavyweight Fleece Hoodie - Heather Grey / L',
    category: 'Apparel',
    unit: 'pcs',
    systemStock: 18,
  },
  {
    id: 'prod-004',
    sku: 'ELC-CHG-USBC',
    barcode: '840056123456',
    description: '65W GaN Dual USB-C Fast Wall Charger',
    category: 'Electronics',
    unit: 'pcs',
    systemStock: 60,
  },
  {
    id: 'prod-005',
    sku: 'ELC-CBL-6FT',
    barcode: '840056789012',
    description: 'Braided USB-C to USB-C Cable (6ft / 100W)',
    category: 'Electronics',
    unit: 'pcs',
    systemStock: 110,
  },
  {
    id: 'prod-006',
    sku: 'ELC-EAR-PRO',
    barcode: '840056345678',
    description: 'Wireless ANC Earbuds with MagSafe Case',
    category: 'Electronics',
    unit: 'pcs',
    systemStock: 25,
  },
  {
    id: 'prod-007',
    sku: 'BEV-COF-DRK',
    barcode: '712345000018',
    description: 'Artisan Roast Dark Whole Bean Coffee (12oz)',
    category: 'Grocery',
    unit: 'bag',
    systemStock: 80,
  },
  {
    id: 'prod-008',
    sku: 'BEV-TEA-MAT',
    barcode: '712345000025',
    description: 'Ceremonial Organic Matcha Green Tea (50g)',
    category: 'Grocery',
    unit: 'tin',
    systemStock: 42,
  },
  {
    id: 'prod-009',
    sku: 'HME-BTL-32OZ',
    barcode: '654321987654',
    description: 'Insulated Stainless Steel Water Bottle 32oz',
    category: 'Home & Living',
    unit: 'pcs',
    systemStock: 35,
  },
  {
    id: 'prod-010',
    sku: 'HME-CND-LAV',
    barcode: '654321123456',
    description: 'Soy Wax Aromatherapy Candle - Lavender Woods',
    category: 'Home & Living',
    unit: 'pcs',
    systemStock: 50,
  },
];

const LOCAL_CATALOG_KEY = 'inventory_count_local_catalog';

export function getLocalCatalog(): Product[] {
  try {
    const raw = localStorage.getItem(LOCAL_CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Could not read local catalog:', e);
  }
  // Initialize with seed
  saveLocalCatalog(SEED_PRODUCTS);
  return SEED_PRODUCTS;
}

export function saveLocalCatalog(products: Product[]): void {
  try {
    localStorage.setItem(LOCAL_CATALOG_KEY, JSON.stringify(products));
  } catch (e) {
    console.warn('Could not save local catalog:', e);
  }
}

export async function fetchCatalog(): Promise<Product[]> {
  try {
    const snapshot = await getDocs(collection(db, 'products'));
    if (!snapshot.empty) {
      const firestoreProducts: Product[] = [];
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        firestoreProducts.push({
          id: docSnap.id,
          sku: d.sku,
          barcode: d.barcode,
          description: d.description,
          category: d.category || 'General',
          unit: d.unit || 'pcs',
          systemStock: d.systemStock ?? 0,
        });
      });
      // Merge with seed and update local cache
      const mergedMap = new Map<string, Product>();
      SEED_PRODUCTS.forEach(p => mergedMap.set(p.sku, p));
      firestoreProducts.forEach(p => mergedMap.set(p.sku, p));
      const combined = Array.from(mergedMap.values());
      saveLocalCatalog(combined);
      return combined;
    }
  } catch (e) {
    console.warn('Network offline or error fetching products from Firestore. Using cached catalog:', e);
  }
  return getLocalCatalog();
}

export async function addProductToCatalog(product: Omit<Product, 'id'>): Promise<Product> {
  const newId = `prod-${Date.now()}`;
  const newProduct: Product = {
    ...product,
    id: newId,
  };

  // 1. Immediately persist to local cache so barcode lookup succeeds instantly
  const current = getLocalCatalog();
  const updated = [newProduct, ...current.filter(p => p.sku !== product.sku && p.barcode !== product.barcode)];
  saveLocalCatalog(updated);

  // 2. Persist to Firestore if online
  try {
    await setDoc(doc(db, 'products', newId), {
      sku: product.sku,
      barcode: product.barcode,
      description: product.description,
      category: product.category || 'General',
      unit: product.unit || 'pcs',
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Offline: Product saved to local catalog and will be available locally.', e);
  }

  return newProduct;
}

export function findProductByCode(code: string, catalog: Product[]): Product | null {
  if (!code) return null;
  const cleanCode = code.trim().toLowerCase();
  
  // Exact match on barcode
  const byBarcode = catalog.find(p => p.barcode.toLowerCase() === cleanCode);
  if (byBarcode) return byBarcode;

  // Exact match on SKU
  const bySku = catalog.find(p => p.sku.toLowerCase() === cleanCode);
  if (bySku) return bySku;

  // Partial match fallback
  const partial = catalog.find(p => 
    p.barcode.toLowerCase().includes(cleanCode) || 
    p.sku.toLowerCase().includes(cleanCode)
  );
  return partial || null;
}

/**
 * Bulk imports an item masterlist into local cache and Firestore.
 * Supports 'merge' (upserts products) or 'replace' (replaces entire catalog).
 */
export async function bulkImportMasterlist(
  items: MasterlistItem[],
  mode: 'merge' | 'replace' = 'merge'
): Promise<{ successCount: number; errorCount: number }> {
  if (!items || items.length === 0) {
    return { successCount: 0, errorCount: 0 };
  }

  const existing = mode === 'replace' ? [] : getLocalCatalog();
  const productMap = new Map<string, Product>();

  // If merging, seed the map with existing items
  if (mode === 'merge') {
    existing.forEach((p) => productMap.set(p.sku.toLowerCase(), p));
  }

  let successCount = 0;
  let errorCount = 0;

  const newProductsList: Product[] = [];

  for (const item of items) {
    const sku = (item.sku || '').trim();
    const barcode = (item.barcode || '').trim();
    const description = (item.description || '').trim();

    if (!sku || !barcode || !description) {
      errorCount++;
      continue;
    }

    const docId = `prod-${sku.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}`;
    const product: Product = {
      id: docId,
      sku,
      barcode,
      description,
      category: (item.category || 'General').trim(),
      unit: (item.unit || 'pcs').trim(),
      systemStock: typeof item.systemStock === 'number' && !isNaN(item.systemStock) ? item.systemStock : 0,
    };

    productMap.set(sku.toLowerCase(), product);
    newProductsList.push(product);
    successCount++;
  }

  const finalCatalog = Array.from(productMap.values());
  saveLocalCatalog(finalCatalog);

  // Sync to Firestore in background
  try {
    for (const prod of newProductsList) {
      setDoc(doc(db, 'products', prod.id), {
        sku: prod.sku,
        barcode: prod.barcode,
        description: prod.description,
        category: prod.category,
        unit: prod.unit,
        systemStock: prod.systemStock,
        updatedAt: new Date().toISOString(),
      }).catch((err) => {
        console.warn(`Firestore sync note for product ${prod.sku}:`, err.message);
      });
    }
  } catch (err) {
    console.warn('Firestore bulk sync queued in local cache:', err);
  }

  return { successCount, errorCount };
}

/**
 * Deletes a single product from the local cache and Firestore.
 */
export async function deleteProductFromCatalog(productId: string): Promise<void> {
  const current = getLocalCatalog();
  const filtered = current.filter((p) => p.id !== productId);
  saveLocalCatalog(filtered);

  try {
    await deleteDoc(doc(db, 'products', productId));
  } catch (e) {
    console.warn('Failed to delete product from Firestore:', e);
  }
}

/**
 * Clears the catalog from local cache and resets with seed or empty
 */
export async function clearAllProducts(): Promise<void> {
  saveLocalCatalog([]);
}
