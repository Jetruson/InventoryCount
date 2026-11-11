# Inventory Count — Mobile Progressive Web App (PWA)

A retail stock counting Progressive Web App (PWA) optimized for Android phones and retail counters. Includes camera barcode scanning, manual entry with catalog lookup, offline-first queue syncing to Firestore, store switching, history filtering, supervisor monitoring, and Excel export.

---

## 1. Features

- **PWA & Android Optimized**:
  - Installable directly to home screen via Chrome on Android (`standalone` display mode).
  - Works offline with automatic Firestore queue flush when connection is restored.
  - Large $48\times 48\text{px}$ touch targets and ergonomic bottom thumb navigation.
- **Barcode Scanner**:
  - Embedded camera scanning powered by `html5-qrcode`.
  - Flashlight / torch toggle on supported Android cameras.
  - Crisp audio beep and tactile vibration feedback on successful scans.
  - Quick toggle to manual barcode/SKU entry.
- **Catalog Lookup & Registration**:
  - Instant auto-matching of barcodes to SKU, item description, category, and unit of measure.
  - Inline "Add to Catalog" modal to register missing barcodes on the fly.
- **Item Location Tracking (Sticky Sub-Location)**:
  - Set active aisle, shelf, bin, or bay by scanning a location barcode or manual entry/preset selection.
  - Automatically retains location across multiple consecutive items counted in that location.
  - Live count of items scanned within the active location and 1-tap "Change Location" when moving to the next bay.
- **Quantity & Remarks Input**:
  - Big numeric display with $+1$, $+5$, $+10$, $+50$, and Zero steppers.
  - Validation enforcing quantity $\ge 0$ and non-empty barcode.
  - Quick-pick remark chips (e.g. *Damaged Packaging*, *Display Model*, *Near Expiry*).
- **Audit History**:
  - Filter counts by date (*Today*, *Yesterday*, *Past 7 Days*, *All Time*).
  - Search by SKU, description, barcode, or location.
  - Sync indicator showing cloud-synced vs. pending-offline sync.
- **Supervisor Dashboard**:
  - View all count submissions across stores, locations, and team counters.
  - Aggregated KPIs: Total Units Counted, Unique SKUs, Active Counters.
  - Multi-store search, location breakdown, and counter breakdown.
  - *Data extraction is restricted to Admin users.*
- **Admin Management Portal (Admin Only)**:
  - **Upload Item Masterlist**:
    - Upload product catalog via `.xlsx`, `.xls`, or `.csv` with flexible header mapping.
    - Real-time row parsing, error detection, preview table, and Merge vs. Replace modes.
    - 1-Click sample Excel & CSV template downloads.
  - **Extract Counted Items**:
    - Multi-sheet Excel (`.xlsx`) export: Detailed physical counts, Masterlist reconciliation with variance (+/-), and store/location summaries.
    - Raw CSV export for ERP/WMS systems (SAP, Oracle, NetSuite).
    - Extraction filters: Store, Location, and Date Range.

---

## 2. Authentication & Demo Accounts

The app supports Email/Password and Google authentication with role-based access control (RBAC). Three quick demo accounts are provided for instant testing:

| Role | Username / Email | Password | Assigned Store | Privileges |
| :--- | :--- | :--- | :--- | :--- |
| **Counter Associate** | `counter1@retailstore.com` | `Store123!` | Downtown Flagship (`ST-101`) | Barcode scanning, physical counts, local history |
| **Store Supervisor** | `supervisor@retailstore.com` | `Supervisor123!` | Downtown Flagship (`ST-101`) | Store count oversight, team breakdowns, audit trail |
| **System Administrator** | `admin@retailstore.com` | `Admin123!` | Downtown Flagship (`ST-101`) | Masterlist upload, catalog control, full count data extraction |

*Users can also create new accounts with custom roles and default stores, or sign in with Google (`jetgonzalgo@gmail.com`).*

---

## 3. Database Structure (`Firestore`)

### Collection: `inventory_counts/{countId}`
Each document represents a recorded count:
```json
{
  "id": "cnt-1731289123-abcde",
  "username": "Alex Mercer",
  "userId": "firebase_auth_uid",
  "store": "Downtown Flagship",
  "storeId": "ST-101",
  "location": "Aisle 3 - Shelf B",
  "sku": "APP-TEE-BLK-M",
  "barcode": "012345678905",
  "itemDescription": "Cotton Crewneck T-Shirt - Black / Medium",
  "countedQuantity": 45,
  "remarks": "Display unit on rack 2",
  "date": "2026-11-10",
  "time": "18:35:10",
  "createdAt": 1731289123456
}
```

### Collection: `products/{productId}`
Product master catalog for barcode and SKU lookups:
```json
{
  "sku": "APP-TEE-BLK-M",
  "barcode": "012345678905",
  "description": "Cotton Crewneck T-Shirt - Black / Medium",
  "category": "Apparel",
  "unit": "pcs",
  "createdAt": "2026-11-10T18:30:00.000Z"
}
```

### Collection: `stores/{storeId}`
Retail stores directory:
```json
{
  "storeId": "ST-101",
  "name": "Downtown Flagship",
  "location": "100 Main Street"
}
```

---

## 4. Deployment Instructions

### A. Android Chrome PWA Installation
1. Open the hosted web URL in **Chrome Mobile on Android**.
2. Tap the **"Install App"** button in the top navigation bar, or open Chrome's menu (`⋮`) and select **"Install app"** (or **"Add to Home screen"**).
3. The app is added to the Android app drawer and home screen.
4. Launching the app opens it in native full-screen standalone mode without browser bars.

### B. Building for Production
```bash
# Install dependencies
npm install

# Build production bundle with service worker precaching
npm run build
```

The compiled assets will be placed in `dist/`.

### C. Deploying to Firebase Hosting
```bash
firebase deploy --only hosting
```
