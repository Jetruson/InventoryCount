import { Product, MasterlistItem } from '../types/inventory';
import { db } from '../firebase/config';
import {
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';

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
const LOCAL_CATALOG_CUSTOMIZED_KEY = 'inventory_count_catalog_customized';

function parseProductDoc(id: string, d: Record<string, any>): Product {
  return {
    id,
    sku: String(d.sku || id),
    barcode: String(d.barcode || d.sku || id),
    description: String(d.description || 'Product Item'),
    category: String(d.category || 'General'),
    unit: String(d.unit || 'pcs'),
    systemStock: typeof d.systemStock === 'number' ? d.systemStock : Number(d.systemStock) || 0,
  };
}

function makeProductDocId(sku: string): string {
  const sanitized = sku.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().slice(0, 110);
  return `prod-${sanitized || Date.now()}`;
}

export function getLocalCatalog(): Product[] {
  try {
    const raw = localStorage.getItem(LOCAL_CATALOG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Respect explicitly empty customized catalog
        if (parsed.length > 0 || localStorage.getItem(LOCAL_CATALOG_CUSTOMIZED_KEY) === 'true') {
          return parsed;
        }
      }
    }
  } catch (e) {
    console.warn('Could not read local catalog:', e);
  }
  saveLocalCatalog(SEED_PRODUCTS);
  return SEED_PRODUCTS;
}

export function saveLocalCatalog(products: Product[], markCustomized = false): void {
  try {
    localStorage.setItem(LOCAL_CATALOG_KEY, JSON.stringify(products));
    if (markCustomized) {
      localStorage.setItem(LOCAL_CATALOG_CUSTOMIZED_KEY, 'true');
    }
  } catch (e) {
    console.warn('Could not save local catalog:', e);
  }
}

export async function seedCatalogIfEmpty(): Promise<void> {
  try {
    if (localStorage.getItem(LOCAL_CATALOG_CUSTOMIZED_KEY) === 'true') return;
    const snapshot = await getDocs(collection(db, 'products'));
    if (snapshot.empty) {
      const batch = writeBatch(db);
      for (const p of SEED_PRODUCTS) {
        batch.set(doc(db, 'products', p.id), {
          sku: p.sku,
          barcode: p.barcode,
          description: p.description,
          category: p.category,
          unit: p.unit,
          systemStock: p.systemStock ?? 0,
          updatedAt: new Date().toISOString(),
        });
      }
      await batch.commit();
    }
  } catch (e) {
    console.warn('Catalog seeding skipped or offline:', e);
  }
}

export async function fetchCatalog(): Promise<Product[]> {
  try {
    const snapshot = await getDocs(collection(db, 'products'));
    if (!snapshot.empty) {
      const firestoreProducts: Product[] = [];
      snapshot.forEach(docSnap => {
        firestoreProducts.push(parseProductDoc(docSnap.id, docSnap.data()));
      });
      // Firestore is the authoritative shared source across devices
      firestoreProducts.sort((a, b) => a.sku.localeCompare(b.sku));
      saveLocalCatalog(firestoreProducts, true);
      return firestoreProducts;
    }
  } catch (e) {
    console.warn('Network offline or error fetching products from Firestore. Using cached catalog:', e);
  }
  return getLocalCatalog();
}

/**
 * Subscribes to live Firestore product catalog updates across all devices.
 */
export function subscribeToCatalog(onUpdate: (products: Product[]) => void): () => void {
  try {
    return onSnapshot(
      collection(db, 'products'),
      (snapshot) => {
        if (!snapshot.empty) {
          const firestoreProducts: Product[] = [];
          snapshot.forEach(docSnap => {
            firestoreProducts.push(parseProductDoc(docSnap.id, docSnap.data()));
          });
          firestoreProducts.sort((a, b) => a.sku.localeCompare(b.sku));
          saveLocalCatalog(firestoreProducts, true);
          onUpdate(firestoreProducts);
        } else {
          // If Firestore is empty and user previously cleared, return [] or seed fallback
          onUpdate(getLocalCatalog());
        }
      },
      (err) => {
        console.warn('Realtime catalog listener error:', err);
        onUpdate(getLocalCatalog());
      }
    );
  } catch (err) {
    console.warn('Could not attach realtime catalog listener:', err);
    onUpdate(getLocalCatalog());
    return () => {};
  }
}

export async function addProductToCatalog(product: Omit<Product, 'id'>): Promise<Product> {
  const newId = makeProductDocId(product.sku || `${Date.now()}`);
  const newProduct: Product = {
    ...product,
    id: newId,
  };

  // 1. Immediately persist to local cache
  const current = getLocalCatalog();
  const updated = [newProduct, ...current.filter(p => p.sku !== product.sku && p.barcode !== product.barcode)];
  saveLocalCatalog(updated, true);

  // 2. Persist to Firestore
  try {
    await setDoc(doc(db, 'products', newId), {
      sku: product.sku,
      barcode: product.barcode,
      description: product.description,
      category: product.category || 'General',
      unit: product.unit || 'pcs',
      systemStock: product.systemStock ?? 0,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Offline: Product saved to local catalog.', e);
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
 * Bulk imports an item masterlist into local cache and Firestore using awaited chunked writeBatch.
 * Supports 'merge' (upserts products) or 'replace' (deletes old products in Firestore and writes new ones).
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

  if (mode === 'merge') {
    existing.forEach((p) => productMap.set(p.sku.toLowerCase(), p));
  }

  let successCount = 0;
  let errorCount = 0;

  const newProductsMap = new Map<string, Product>();

  for (const item of items) {
    const sku = (item.sku || '').trim();
    const barcode = (item.barcode || item.sku || '').trim();
    const description = (item.description || '').trim();

    if (!sku || !barcode || !description) {
      errorCount++;
      continue;
    }

    const docId = makeProductDocId(sku);
    const product: Product = {
      id: docId,
      sku,
      barcode,
      description: description.slice(0, 290),
      category: (item.category || 'General').trim(),
      unit: (item.unit || 'pcs').trim(),
      systemStock: typeof item.systemStock === 'number' && !isNaN(item.systemStock) ? item.systemStock : 0,
    };

    productMap.set(sku.toLowerCase(), product);
    newProductsMap.set(docId, product);
    successCount++;
  }

  const newProductsList = Array.from(newProductsMap.values());
  const finalCatalog = Array.from(productMap.values());
  saveLocalCatalog(finalCatalog, true);

  // Sync to Firestore using awaited chunked writeBatch (max 400 ops per batch)
  const ops: Array<{ type: 'set' | 'delete'; id: string; data?: Product }> = [];

  if (mode === 'replace') {
    const existingSnap = await getDocs(collection(db, 'products'));
    const newIds = new Set(newProductsList.map((p) => p.id));
    existingSnap.forEach((docSnap) => {
      if (!newIds.has(docSnap.id)) {
        ops.push({ type: 'delete', id: docSnap.id });
      }
    });
  }

  for (const prod of newProductsList) {
    ops.push({ type: 'set', id: prod.id, data: prod });
  }

  const CHUNK_SIZE = 400;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      const ref = doc(db, 'products', op.id);
      if (op.type === 'delete') {
        batch.delete(ref);
      } else if (op.data) {
        batch.set(ref, {
          sku: op.data.sku,
          barcode: op.data.barcode,
          description: op.data.description,
          category: op.data.category,
          unit: op.data.unit,
          systemStock: op.data.systemStock ?? 0,
          updatedAt: nowIso,
        });
      }
    }
    await batch.commit();
  }

  return { successCount, errorCount };
}

/**
 * Deletes a single product from the local cache and Firestore.
 */
export async function deleteProductFromCatalog(productId: string): Promise<void> {
  const current = getLocalCatalog();
  const filtered = current.filter((p) => p.id !== productId);
  saveLocalCatalog(filtered, true);

  try {
    await deleteDoc(doc(db, 'products', productId));
  } catch (e) {
    console.warn('Failed to delete product from Firestore:', e);
  }
}

/**
 * Clears the catalog from local cache and Firestore.
 */
export async function clearAllProducts(): Promise<void> {
  saveLocalCatalog([], true);
  try {
    const snapshot = await getDocs(collection(db, 'products'));
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn('Failed clearing products in Firestore:', e);
  }
}
