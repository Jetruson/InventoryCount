# Inventory Count — Mobile Retail PWA

An Android-first Progressive Web App (PWA) designed for retail inventory counters and store supervisors. Enables high-speed barcode scanning via device camera, manual entry with catalog auto-match, offline-first count queuing, multi-store filtering, supervisor monitoring, and Excel export.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following key decisions were confirmed during Phase 1 clarification:
> - **Catalog Resolution**: Look up items automatically from the store product catalog (matching barcode or SKU), with an inline modal to quickly register new SKUs if an unrecognized barcode is scanned.
> - **Store Assignment**: Select active store upon login with a persistent header switcher to switch retail locations anytime without re-logging.
> - **Offline Resilience**: Offline-first local queue (IndexedDB / LocalStorage) that records count submissions instantly on spotty retail floors and automatically synchronizes to Firestore as soon as connectivity is restored.

---

## 1. Overview & Core Concept

- **What It Does**: Provides retail store associates and supervisors with a fast, touch-friendly barcode scanner and counting workflow on Android Chrome and mobile browsers. Users scan barcodes, confirm SKU and description, input counted quantities with tactile numeric controls, and store timestamped count records to Firebase Firestore.
- **Target Audience / Persona**:
  - *Store Inventory Counters*: Associates walking aisles, scanning stock tags, counting shelf units, and recording remarks quickly with one hand.
  - *Store Supervisors / Managers*: Overseeing team counting progress, filtering submissions by counter or store, reviewing count accuracy, and exporting master audit logs to Excel.
- **Key Value**: Eliminates paper tally sheets and clunky handheld terminals with a zero-friction, installable smartphone PWA that works smoothly online and offline.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Authentication & Store Selection**:
   - Clean login screen with email/password authentication (plus quick demo credential toggle).
   - Prompts counter to select their active retail store branch (e.g., "Store #104 - Downtown", "Store #208 - Metro Mall") before entering the counting floor.

2. **Inventory Count Flow (Primary Screen)**:
   - **Scanner Viewfinder**: Embedded camera view using `html5-qrcode` with target reticle, flashlight toggle (torch API), and audio/haptic beep on detection.
   - **Manual Fallback**: Instant toggle to barcode/SKU manual text input.
   - **Item Card**: Live lookup reveals SKU code, product description, category, and standard retail unit. If unlisted, triggers a 1-tap "Add to Catalog" modal.
   - **Quantity Ergonomics**: Large number display with 48px touch steppers (`-1`, `+1`, `+5`, `+10`, `+50`) and numeric keypad input. Enforces $\ge 0$ validation.
   - **Remarks**: Quick chip presets (e.g., "Damaged Box", "Display Model", "Near Expiry", "Backroom Shelf") or freeform text.
   - **Save & Continue**: Prominent bottom thumb button ("Save & Next Count") saving locally and queueing to Firestore.

3. **History & Audit Log**:
   - List of recent counts with counter name, store, SKU, quantity, date, and time.
   - Date range selector ("Today", "This Week", "Custom") and search filter by SKU or item name.
   - Visual sync badge indicating cloud-synced vs. pending-offline sync.

4. **Supervisor Dashboard**:
   - Multi-store overview with key KPIs: Total Units Counted, Unique SKUs Scanned, Active Counters, and Discrepancy flags.
   - Counter breakdown table: count totals and activity grouped by user.
   - 1-click **"Export to Excel"** generating a formatted `.xlsx` workbook containing all audit fields (Username, Store, SKU, Item Description, Quantity, Remarks, Date, Time).

5. **PWA Install & Offline Experience**:
   - In-app install banner with install prompt on Android/Chrome and step-by-step guidance on iOS Safari.
   - Non-intrusive offline indicator with automatic queue flush counter (e.g., "3 counts synced to cloud").

### Visual Identity & Theme

- **Aesthetic Direction**: Utilitarian, high-contrast industrial mobile UI engineered for warehouse and fluorescent-lit retail environments. High visibility typography and large tap targets.
- **Color Palette**:
  - Canvas: Pure white (`#ffffff`) in light mode; Slate-950 (`#090d16`) in dark mode.
  - Primary / Accent: Industrial Emerald / Deep Navy (`#047857` / `#0f172a`) for high-intent actions and scan confirmations.
  - Success / Alert: Forest green for valid barcode scan; Amber-500 for offline queue; Rose-500 for errors or zero counts.
- **Typography**: `Plus Jakarta Sans` for clean, modern headings and body text; `JetBrains Mono` / `tabular-nums` for SKUs, barcodes, and quantities.
- **Ergonomics & Spatial Math**:
  - Minimum touch target: $48 \times 48\text{px}$ on all buttons and inputs.
  - Thumb-friendly bottom sticky action bar adhering to the 15% mobile sticky cap.

---

## 3. Key Product Decisions & Trade-Offs

- **Barcode Scanning with `html5-qrcode`**:
  - *Chosen*: `html5-qrcode` HTML5 camera barcode library supporting EAN-13, UPC-A, Code-128, QR Code, and Code-39.
  - *Why*: Reliable in-browser camera streaming on Android Chrome without native app compilation. Includes automatic flashlight/torch controls on supported devices.
  - *Fallback*: Clean manual entry input box with Enter key submission.
- **Offline-First Synchronization Architecture**:
  - *Chosen*: LocalStorage / IndexedDB count queue with optimistic UI and online listener (`window.addEventListener('online')`).
  - *Why*: Retail backrooms and stock basements frequently experience cellular dead zones. Counters must never be blocked or lose counts.
- **Excel Export via `xlsx` (SheetJS)**:
  - *Chosen*: Client-side `.xlsx` generation using `xlsx`.
  - *Why*: Generates real, multi-column Excel files with proper data types (numbers as numeric values, dates formatted) ready for store inventory systems (SAP, Oracle, Lightspeed, Shopify).
- **Firebase Authentication & Firestore**:
  - *Chosen*: Firebase Firestore with structured collections and ABAC security rules, plus user email/password login and store profiles.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Inventory Count Mobile PWA                      │
├────────────────────────────────────────────────────────────────────────┤
│  Top Bar: [ Store Switcher ] [ Online/Offline Status ] [ User Avatar ] │
├────────────────────────────────────────────────────────────────────────┤
│  View Tabs:                                                            │
│   ├── [ Scan / Count ] ── Camera Viewfinder (html5-qrcode) + Keypad    │
│   ├── [ My History ]   ── Local & Cloud Count Log with Filters         │
│   ├── [ Supervisor ]   ── Multi-Store Aggregations + Excel Export      │
│   └── [ Catalog ]      ── Product Master (SKU, Name, Barcode, Unit)   │
├────────────────────────────────────────────────────────────────────────┤
│  State & Sync Layer:                                                   │
│   ├── Auth State (Firebase Auth User)                                  │
│   ├── Active Store Context                                             │
│   ├── Offline Count Queue (LocalStorage / IndexedDB)                   │
│   └── Cloud Sync Worker (Auto-syncs pending counts on 'online' event)  │
├────────────────────────────────────────────────────────────────────────┤
│  Backend Persistence:                                                  │
│   ├── Firestore: /inventory_counts/{countId}                           │
│   ├── Firestore: /products/{productId}                                 │
│   ├── Firestore: /stores/{storeId}                                     │
│   └── Firestore: /users/{userId}                                       │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Schema (`firebase-blueprint.json`)

1. **`inventory_counts` Collection**:
   - `id`: string (UUID)
   - `username`: string
   - `userId`: string
   - `store`: string
   - `storeId`: string
   - `sku`: string
   - `barcode`: string
   - `itemDescription`: string
   - `countedQuantity`: number ($\ge 0$)
   - `remarks`: string (optional)
   - `date`: string (`YYYY-MM-DD`)
   - `time`: string (`HH:mm:ss`)
   - `createdAt`: timestamp

2. **`products` Collection** (Catalog):
   - `sku`: string (unique)
   - `barcode`: string (indexed)
   - `description`: string
   - `category`: string
   - `unit`: string (e.g., "pcs", "box", "pack")

3. **`stores` Collection**:
   - `storeId`: string
   - `name`: string
   - `location`: string

---

## 5. Execution Steps Plan (Upon Approval)

1. **Firebase Setup**:
   - Initialize Firebase configuration and blueprint schema.
   - Configure Firestore collections and secure rules with validation helpers.
2. **Package Installation**:
   - Install required packages: `html5-qrcode`, `xlsx`, `vite-plugin-pwa`, `firebase`.
3. **PWA & Manifest Configuration**:
   - Setup `vite.config.ts` with `VitePWA`, icons, standalone display mode, and service worker caching.
   - Implement `usePWAInstall` and in-app install banner with iOS/Android assistance.
4. **Core Application Modules**:
   - **Auth & Store Selection**: Email/password authentication, store switcher, and session management.
   - **Barcode Scanner Component**: Camera feed, torch/lighting toggle, manual fallback, and audio scan confirmation.
   - **Count Form**: Rapid quantity incrementers, validation ($\ge 0$), remarks chips, and instant submission.
   - **Catalog Registry**: Pre-seeded retail inventory + modal to add missing barcodes on the fly.
   - **Offline Queue**: Seamless auto-sync to Firestore when reconnecting.
   - **History & Filtering**: Searchable table/cards with date and SKU filters.
   - **Supervisor Dashboard & Excel Export**: Multi-store aggregation, user breakdown, and Excel (.xlsx) download.
5. **Verification**:
   - Full TypeScript build check and lint audit.
   - Validate camera permissions handling, offline queue recovery, and PWA manifest installability.
