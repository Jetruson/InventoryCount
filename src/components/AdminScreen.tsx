import React, { useState, useMemo, useRef } from 'react';
import { InventoryCount, Store, Product, MasterlistItem, CountVarianceItem, AppUser } from '../types/inventory';
import { bulkImportMasterlist, getLocalCatalog, deleteProductFromCatalog, clearAllProducts } from '../services/catalogService';
import * as XLSX from 'xlsx';
import {
  ShieldAlert,
  Upload,
  Download,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Trash2,
  Package,
  Layers,
  Building2,
  Calendar,
  MapPin,
  Check,
  X,
  Database,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  FileCheck,
} from 'lucide-react';

interface AdminScreenProps {
  currentUser: AppUser;
  counts: InventoryCount[];
  stores: Store[];
  catalog: Product[];
  onCatalogUpdated: () => void;
}

export const AdminScreen: React.FC<AdminScreenProps> = ({
  currentUser,
  counts,
  stores,
  catalog,
  onCatalogUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'upload_masterlist' | 'extract_counts'>('upload_masterlist');

  // Masterlist upload state
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [parsedItems, setParsedItems] = useState<MasterlistItem[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Masterlist search & explore state
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [selectedCatalogCategory, setSelectedCatalogCategory] = useState<string>('all');

  // Extract counts state
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedDateRange, setSelectedDateRange] = useState<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Access Control Guard
  if (currentUser.role !== 'admin') {
    return (
      <div className="w-full max-w-2xl mx-auto py-12 px-4 text-center">
        <div className="rounded-3xl bg-slate-900 border border-rose-500/30 p-8 shadow-2xl space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
            <ShieldAlert className="w-9 h-9" />
          </div>
          <h2 className="text-xl font-black text-white">Administrator Access Required</h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Uploading the item masterlist and extracting counted inventory data are restricted to System Administrators. Your current role is <strong className="text-white capitalize">{currentUser.role}</strong>.
          </p>
          <div className="text-[11px] text-slate-500">
            Please log in with an administrator account to access this management console.
          </div>
        </div>
      </div>
    );
  }

  // --- MASTERLIST UPLOAD HANDLERS ---
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processSelectedFile(e.target.files[0]);
    }
  };

  const processSelectedFile = async (file: File) => {
    setFileName(file.name);
    setParseErrors([]);
    setImportSuccessMessage(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to JSON array with header detection
        const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (rawRows.length === 0) {
          setParseErrors(['The uploaded file appears to be empty. Please include rows with SKU, Barcode, and Description.']);
          setParsedItems([]);
          return;
        }

        const items: MasterlistItem[] = [];
        const errors: string[] = [];

        rawRows.forEach((row, idx) => {
          // Normalize row keys to lowercase
          const normalized: Record<string, any> = {};
          Object.keys(row).forEach((k) => {
            normalized[k.trim().toLowerCase().replace(/[\s_-]+/g, '')] = row[k];
          });

          // Match flexible column aliases
          const sku = String(
            normalized['sku'] ||
            normalized['itemcode'] ||
            normalized['productcode'] ||
            normalized['itemnumber'] ||
            normalized['itemno'] ||
            normalized['id'] ||
            ''
          ).trim();

          const barcode = String(
            normalized['barcode'] ||
            normalized['upc'] ||
            normalized['ean'] ||
            normalized['barcodeno'] ||
            normalized['code'] ||
            ''
          ).trim();

          const description = String(
            normalized['description'] ||
            normalized['itemdescription'] ||
            normalized['itemname'] ||
            normalized['name'] ||
            normalized['title'] ||
            ''
          ).trim();

          const category = String(
            normalized['category'] ||
            normalized['department'] ||
            normalized['dept'] ||
            normalized['group'] ||
            'General'
          ).trim();

          const unit = String(
            normalized['unit'] ||
            normalized['uom'] ||
            normalized['unitofmeasure'] ||
            'pcs'
          ).trim();

          const stockRaw = normalized['systemstock'] ?? normalized['stock'] ?? normalized['qty'] ?? normalized['quantity'] ?? 0;
          const parsedStock = Number(stockRaw);
          const systemStock = !isNaN(parsedStock) ? parsedStock : 0;

          if (!sku && !barcode) {
            errors.push(`Row ${idx + 2}: Missing SKU and Barcode.`);
            return;
          }

          if (!sku) {
            errors.push(`Row ${idx + 2}: Missing SKU code.`);
            return;
          }

          if (!barcode) {
            errors.push(`Row ${idx + 2}: Missing Barcode for SKU "${sku}".`);
            return;
          }

          items.push({
            sku,
            barcode,
            description: description || `Item ${sku}`,
            category: category || 'General',
            unit: unit || 'pcs',
            systemStock,
          });
        });

        if (items.length === 0) {
          setParseErrors(['No valid items could be parsed from the file. Please check column headers (SKU, Barcode, Description).']);
        } else {
          setParsedItems(items);
          if (errors.length > 0) {
            setParseErrors(errors.slice(0, 5));
          }
        }
      } catch (err: any) {
        console.error('Masterlist parse error:', err);
        setParseErrors([`Failed to read file: ${err.message || 'Unknown format error.'}`]);
        setParsedItems([]);
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleConfirmImport = async () => {
    if (parsedItems.length === 0) return;

    setIsImporting(true);
    setImportSuccessMessage(null);

    try {
      const result = await bulkImportMasterlist(parsedItems, importMode);
      onCatalogUpdated();
      setImportSuccessMessage(
        `Successfully imported ${result.successCount} masterlist items (${importMode === 'replace' ? 'Masterlist replaced' : 'Catalog merged'}).`
      );
      setParsedItems([]);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      console.error('Import error:', err);
      setParseErrors([`Error saving masterlist: ${err.message || 'Check connection.'}`]);
    } finally {
      setIsImporting(false);
    }
  };

  // Download Sample Masterlist Template
  const handleDownloadTemplate = (format: 'xlsx' | 'csv') => {
    const templateData = [
      {
        SKU: 'APP-TEE-BLK-M',
        Barcode: '012345678905',
        Description: 'Cotton Crewneck T-Shirt - Black / Medium',
        Category: 'Apparel',
        Unit: 'pcs',
        'System Stock': 50,
      },
      {
        SKU: 'APP-HDY-GRY-L',
        Barcode: '012345678929',
        Description: 'Heavyweight Fleece Hoodie - Grey / L',
        Category: 'Apparel',
        Unit: 'pcs',
        'System Stock': 25,
      },
      {
        SKU: 'ELC-CHG-USBC',
        Barcode: '840056123456',
        Description: '65W GaN Dual USB-C Fast Charger',
        Category: 'Electronics',
        Unit: 'pcs',
        'System Stock': 60,
      },
      {
        SKU: 'BEV-COF-DRK',
        Barcode: '712345000018',
        Description: 'Artisan Dark Roast Whole Bean Coffee',
        Category: 'Grocery',
        Unit: 'bag',
        'System Stock': 80,
      },
      {
        SKU: 'HME-BTL-32OZ',
        Barcode: '654321987654',
        Description: 'Insulated Stainless Steel Bottle 32oz',
        Category: 'Home & Living',
        Unit: 'pcs',
        'System Stock': 40,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    ws['!cols'] = [
      { wch: 18 },
      { wch: 18 },
      { wch: 40 },
      { wch: 16 },
      { wch: 10 },
      { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Masterlist_Template');

    if (format === 'xlsx') {
      XLSX.writeFile(wb, 'Item_Masterlist_Template.xlsx');
    } else {
      XLSX.writeFile(wb, 'Item_Masterlist_Template.csv', { bookType: 'csv' });
    }
  };

  // --- COUNT DATA EXTRACTION HANDLERS ---
  const filteredCountsForExtraction = useMemo(() => {
    return counts.filter((c) => {
      // Store filter
      if (selectedStore !== 'all') {
        const matchesStore = c.storeId === selectedStore || c.store.toLowerCase().includes(selectedStore.toLowerCase());
        if (!matchesStore) return false;
      }

      // Location filter
      if (selectedLocation !== 'all') {
        if (!c.location || !c.location.toLowerCase().includes(selectedLocation.toLowerCase())) {
          return false;
        }
      }

      // Date range filter
      if (selectedDateRange !== 'all') {
        const todayStr = new Date().toISOString().split('T')[0];
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

        if (selectedDateRange === 'today' && c.date !== todayStr) return false;
        if (selectedDateRange === 'yesterday' && c.date !== yesterdayStr) return false;

        if (selectedDateRange === '7days') {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const limitStr = sevenDaysAgo.toISOString().split('T')[0];
          if (c.date < limitStr) return false;
        }

        if (selectedDateRange === '30days') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const limitStr = thirtyDaysAgo.toISOString().split('T')[0];
          if (c.date < limitStr) return false;
        }
      }

      return true;
    });
  }, [counts, selectedStore, selectedLocation, selectedDateRange]);

  // Reconciliation Variance Analysis between Masterlist and Counted Items
  const reconciliationData: CountVarianceItem[] = useMemo(() => {
    // 1. Group counts by SKU
    const countMap = new Map<string, { qty: number; stores: Set<string>; locations: Set<string> }>();
    filteredCountsForExtraction.forEach((c) => {
      const key = c.sku.toLowerCase();
      const existing = countMap.get(key) || { qty: 0, stores: new Set(), locations: new Set() };
      existing.qty += c.countedQuantity;
      if (c.store) existing.stores.add(c.store);
      if (c.location) existing.locations.add(c.location);
      countMap.set(key, existing);
    });

    // 2. Iterate through catalog items
    const varianceItems: CountVarianceItem[] = [];
    const visitedSkus = new Set<string>();

    catalog.forEach((prod) => {
      const key = prod.sku.toLowerCase();
      visitedSkus.add(key);
      const countInfo = countMap.get(key);
      const countedQuantity = countInfo ? countInfo.qty : 0;
      const systemStock = prod.systemStock ?? 0;
      const variance = countedQuantity - systemStock;

      let status: 'matched' | 'over' | 'under' | 'uncounted' = 'matched';
      if (!countInfo || countedQuantity === 0) {
        status = 'uncounted';
      } else if (variance > 0) {
        status = 'over';
      } else if (variance < 0) {
        status = 'under';
      }

      varianceItems.push({
        sku: prod.sku,
        barcode: prod.barcode,
        description: prod.description,
        category: prod.category || 'General',
        systemStock,
        countedQuantity,
        variance,
        status,
        storesFound: countInfo ? Array.from(countInfo.stores) : [],
        locationsFound: countInfo ? Array.from(countInfo.locations) : [],
      });
    });

    // 3. Include any items counted that were not in the official catalog
    countMap.forEach((info, key) => {
      if (!visitedSkus.has(key)) {
        const sampleCount = filteredCountsForExtraction.find((c) => c.sku.toLowerCase() === key);
        varianceItems.push({
          sku: sampleCount?.sku || key.toUpperCase(),
          barcode: sampleCount?.barcode || '',
          description: sampleCount?.itemDescription || 'Uncataloged Item',
          category: 'Uncataloged',
          systemStock: 0,
          countedQuantity: info.qty,
          variance: info.qty,
          status: 'over',
          storesFound: Array.from(info.stores),
          locationsFound: Array.from(info.locations),
        });
      }
    });

    return varianceItems;
  }, [catalog, filteredCountsForExtraction]);

  // Export to Excel (.xlsx)
  const handleExtractToExcel = () => {
    if (filteredCountsForExtraction.length === 0) {
      alert('No counted records found matching the selected extraction criteria.');
      return;
    }

    setIsExporting(true);
    setExportNotice(null);

    try {
      const wb = XLSX.utils.book_new();

      // 1. Sheet 1: Detailed Physical Counts Audit
      const detailedData = filteredCountsForExtraction.map((c, idx) => ({
        '#': idx + 1,
        'Count ID': c.id,
        Date: c.date,
        Time: c.time,
        Store: c.store,
        'Store ID': c.storeId,
        'Shelf/Bin Location': c.location || 'Not Specified',
        SKU: c.sku,
        Barcode: c.barcode,
        'Item Description': c.itemDescription,
        'Counted Quantity': c.countedQuantity,
        Remarks: c.remarks || '',
        'Counter Username': c.username,
        'User ID': c.userId,
      }));

      const wsDetailed = XLSX.utils.json_to_sheet(detailedData);
      wsDetailed['!cols'] = [
        { wch: 6 },
        { wch: 22 },
        { wch: 12 },
        { wch: 10 },
        { wch: 22 },
        { wch: 12 },
        { wch: 20 },
        { wch: 18 },
        { wch: 16 },
        { wch: 38 },
        { wch: 16 },
        { wch: 26 },
        { wch: 18 },
        { wch: 28 },
      ];
      XLSX.utils.book_append_sheet(wb, wsDetailed, 'Detailed Counts');

      // 2. Sheet 2: Masterlist Reconciliation & Variance
      const varianceExportData = reconciliationData.map((v, idx) => ({
        '#': idx + 1,
        SKU: v.sku,
        Barcode: v.barcode,
        Description: v.description,
        Category: v.category,
        'System Stock': v.systemStock,
        'Physical Counted': v.countedQuantity,
        'Variance (+/-)': v.variance,
        'Variance Status': v.status.toUpperCase(),
        'Locations Found': v.locationsFound.join(', ') || 'N/A',
        'Stores Found': v.storesFound.join(', ') || 'N/A',
      }));

      const wsVariance = XLSX.utils.json_to_sheet(varianceExportData);
      wsVariance['!cols'] = [
        { wch: 6 },
        { wch: 18 },
        { wch: 16 },
        { wch: 36 },
        { wch: 16 },
        { wch: 14 },
        { wch: 16 },
        { wch: 14 },
        { wch: 16 },
        { wch: 26 },
        { wch: 26 },
      ];
      XLSX.utils.book_append_sheet(wb, wsVariance, 'Masterlist Reconciliation');

      // 3. Sheet 3: Store & Location Summary
      const locSummaryMap = new Map<string, { totalUnits: number; countRecords: number }>();
      filteredCountsForExtraction.forEach((c) => {
        const locKey = `${c.store} — ${c.location || 'General Floor'}`;
        const prev = locSummaryMap.get(locKey) || { totalUnits: 0, countRecords: 0 };
        prev.totalUnits += c.countedQuantity;
        prev.countRecords += 1;
        locSummaryMap.set(locKey, prev);
      });

      const locSummaryData = Array.from(locSummaryMap.entries()).map(([key, data]) => ({
        'Store & Location': key,
        'Total Physical Units': data.totalUnits,
        'Number of Counts': data.countRecords,
      }));

      const wsLocSummary = XLSX.utils.json_to_sheet(locSummaryData);
      wsLocSummary['!cols'] = [{ wch: 36 }, { wch: 20 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsLocSummary, 'Location Summary');

      // 4. Download file
      const dateTag = new Date().toISOString().split('T')[0];
      const filename = `Inventory_Count_Extraction_${dateTag}.xlsx`;
      XLSX.writeFile(wb, filename);

      setExportNotice(`Extracted ${filteredCountsForExtraction.length} records into ${filename}`);
    } catch (err: any) {
      console.error('Extraction error:', err);
      alert('Could not export file. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // Export to CSV
  const handleExtractToCSV = () => {
    if (filteredCountsForExtraction.length === 0) {
      alert('No counted records found matching the selected extraction criteria.');
      return;
    }

    try {
      const csvData = filteredCountsForExtraction.map((c) => ({
        Date: c.date,
        Time: c.time,
        Store: c.store,
        StoreID: c.storeId,
        Location: c.location || '',
        SKU: c.sku,
        Barcode: c.barcode,
        Description: c.itemDescription,
        CountedQuantity: c.countedQuantity,
        Remarks: c.remarks || '',
        Username: c.username,
        UserID: c.userId,
      }));

      const ws = XLSX.utils.json_to_sheet(csvData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Counts');

      const dateTag = new Date().toISOString().split('T')[0];
      const filename = `Inventory_Counts_${dateTag}.csv`;
      XLSX.writeFile(wb, filename, { bookType: 'csv' });
      setExportNotice(`Extracted CSV feed into ${filename}`);
    } catch (err: any) {
      console.error('CSV export error:', err);
      alert('Failed to generate CSV file.');
    }
  };

  // Filtered Catalog List for Explorer view
  const filteredCatalog = useMemo(() => {
    return catalog.filter((p) => {
      if (selectedCatalogCategory !== 'all' && p.category !== selectedCatalogCategory) {
        return false;
      }
      if (catalogSearch.trim()) {
        const q = catalogSearch.toLowerCase();
        return (
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [catalog, catalogSearch, selectedCatalogCategory]);

  const uniqueCategories = useMemo(() => {
    const set = new Set<string>();
    catalog.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [catalog]);

  // Unique locations from counts
  const uniqueCountLocations = useMemo(() => {
    const set = new Set<string>();
    counts.forEach((c) => {
      if (c.location) set.add(c.location);
    });
    return Array.from(set);
  }, [counts]);

  return (
    <div className="w-full max-w-4xl mx-auto pb-24 pt-2 px-3.5 space-y-4">
      {/* Top Admin Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-purple-950/40 to-slate-900 border border-purple-500/30 p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/40 shadow-inner">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-purple-500/20 text-purple-300 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                Admin Console
              </span>
              <span className="text-[11px] text-slate-400">Restricted Privileges</span>
            </div>
            <h2 className="text-lg font-black text-white mt-0.5">
              Masterlist Upload & Count Extraction
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-1.5 text-center flex-1 sm:flex-none">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Masterlist</span>
            <span className="text-sm font-black text-purple-400 font-mono">{catalog.length} SKUs</span>
          </div>
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-1.5 text-center flex-1 sm:flex-none">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Recorded Counts</span>
            <span className="text-sm font-black text-emerald-400 font-mono">{counts.length}</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Navigation Switcher */}
      <div className="grid grid-cols-2 p-1.5 rounded-2xl bg-slate-900 border border-slate-800 text-xs font-bold">
        <button
          onClick={() => setActiveTab('upload_masterlist')}
          className={`py-2.5 rounded-xl transition flex items-center justify-center gap-2 ${
            activeTab === 'upload_masterlist'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-950'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>Upload Item Masterlist</span>
        </button>

        <button
          onClick={() => setActiveTab('extract_counts')}
          className={`py-2.5 rounded-xl transition flex items-center justify-center gap-2 ${
            activeTab === 'extract_counts'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Download className="w-4 h-4" />
          <span>Extract Counted Items</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: UPLOAD ITEM MASTERLIST */}
      {/* ========================================================================= */}
      {activeTab === 'upload_masterlist' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Instructions and Download Template Bar */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-purple-400" />
                <span>Upload New Master Product List</span>
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                Upload an Excel (<code className="text-purple-300">.xlsx, .xls</code>) or <code className="text-purple-300">.csv</code> file.
                The system automatically registers barcodes, SKU codes, item descriptions, and system stock for real-time scanner lookup and variance reconciliation.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={() => handleDownloadTemplate('xlsx')}
                className="flex-1 md:flex-none h-10 px-3 rounded-xl bg-slate-950 border border-slate-700/80 hover:border-purple-400 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95"
                title="Download formatted sample Excel template"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span>Excel Template</span>
              </button>

              <button
                onClick={() => handleDownloadTemplate('csv')}
                className="flex-1 md:flex-none h-10 px-3 rounded-xl bg-slate-950 border border-slate-700/80 hover:border-purple-400 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95"
                title="Download formatted sample CSV template"
              >
                <FileText className="w-4 h-4 text-amber-400" />
                <span>CSV Template</span>
              </button>
            </div>
          </div>

          {/* Success Banner */}
          {importSuccessMessage && (
            <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/30 p-4 text-xs font-semibold text-emerald-300 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{importSuccessMessage}</span>
            </div>
          )}

          {/* File Upload Drop Zone */}
          <div
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={handleFileDrop}
            className={`rounded-2xl border-2 border-dashed p-6 text-center transition flex flex-col items-center justify-center gap-3 cursor-pointer ${
              dragActive
                ? 'border-purple-400 bg-purple-500/10'
                : 'border-slate-700/80 bg-slate-900/60 hover:border-slate-600 hover:bg-slate-900'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30">
              <Upload className="w-7 h-7" />
            </div>

            <div>
              <div className="text-sm font-bold text-white">
                {fileName ? fileName : 'Choose or drag & drop item masterlist file'}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Supports columns: <strong className="text-slate-300">SKU, Barcode, Description, Category, Unit, System Stock</strong>
              </p>
            </div>

            <button
              type="button"
              className="mt-1 h-9 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white shadow-md active:scale-95 transition"
            >
              Browse Files (.xlsx / .csv)
            </button>
          </div>

          {/* Parse Errors List */}
          {parseErrors.length > 0 && (
            <div className="rounded-2xl bg-rose-500/15 border border-rose-500/30 p-4 space-y-1 text-xs text-rose-300">
              <div className="font-bold flex items-center gap-1.5 text-rose-400">
                <AlertTriangle className="w-4 h-4" />
                <span>Notice while reading masterlist:</span>
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-rose-200">
                {parseErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Parsed Items Preview & Import Confirmation */}
          {parsedItems.length > 0 && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-xl space-y-4 animate-in fade-in duration-100">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Parsed {parsedItems.length} Products Successfully</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Review preview below before applying to inventory catalog
                  </p>
                </div>

                {/* Import Mode Options */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setImportMode('merge')}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        importMode === 'merge' ? 'bg-purple-600 text-white font-bold' : 'text-slate-400'
                      }`}
                    >
                      Merge & Upsert
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportMode('replace')}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        importMode === 'replace' ? 'bg-rose-600 text-white font-bold' : 'text-slate-400'
                      }`}
                      title="Deletes existing non-matching products and replaces with uploaded masterlist"
                    >
                      Replace Masterlist
                    </button>
                  </div>

                  <button
                    onClick={handleConfirmImport}
                    disabled={isImporting}
                    className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white shadow-lg active:scale-95 transition flex items-center gap-2 disabled:opacity-50"
                  >
                    <span>{isImporting ? 'Importing Products...' : `Confirm & Import (${parsedItems.length})`}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Preview Table of First 10 Items */}
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Barcode</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2 text-right">System Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/60 font-mono text-[11px]">
                    {parsedItems.slice(0, 10).map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-2 font-bold text-purple-300">{item.sku}</td>
                        <td className="px-3 py-2 text-slate-200">{item.barcode}</td>
                        <td className="px-3 py-2 font-sans text-white truncate max-w-[200px]">{item.description}</td>
                        <td className="px-3 py-2 font-sans text-slate-400">{item.category}</td>
                        <td className="px-3 py-2 font-sans text-slate-400">{item.unit}</td>
                        <td className="px-3 py-2 text-right text-emerald-400 font-bold">{item.systemStock ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedItems.length > 10 && (
                <div className="text-center text-[11px] text-slate-500">
                  Showing first 10 of {parsedItems.length} items. All items will be imported upon confirmation.
                </div>
              )}
            </div>
          )}

          {/* Active Masterlist Catalog Explorer */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Database className="w-4 h-4 text-purple-400" />
                  <span>Current Active Masterlist ({catalog.length} SKUs)</span>
                </h4>
                <p className="text-xs text-slate-400">
                  Available for in-store barcode scanning and physical inventory counts
                </p>
              </div>

              {/* Search & Category Filter */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-48">
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Search SKU or tag..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 pl-8 text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                  />
                  <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
                </div>

                <select
                  value={selectedCatalogCategory}
                  onChange={(e) => setSelectedCatalogCategory(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-purple-400 focus:outline-none"
                >
                  <option value="all">All Categories</option>
                  {uniqueCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Catalog Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="sticky top-0 bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">System Stock</th>
                    <th className="px-3 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 font-mono text-[11px]">
                  {filteredCatalog.map((prod) => (
                    <tr key={prod.id} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-bold text-white">{prod.sku}</td>
                      <td className="px-3 py-2 text-slate-300">{prod.barcode}</td>
                      <td className="px-3 py-2 font-sans text-slate-200 truncate max-w-[220px]">{prod.description}</td>
                      <td className="px-3 py-2 font-sans text-slate-400">{prod.category || 'General'}</td>
                      <td className="px-3 py-2 text-right text-emerald-400 font-bold">{prod.systemStock ?? 0}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={async () => {
                            if (confirm(`Remove product ${prod.sku} from catalog?`)) {
                              await deleteProductFromCatalog(prod.id);
                              onCatalogUpdated();
                            }
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400 transition"
                          title="Delete product"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredCatalog.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                        No catalog items match your search filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: EXTRACT COUNTED ITEMS (RESTRICTED TO ADMIN) */}
      {/* ========================================================================= */}
      {activeTab === 'extract_counts' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Extraction Control Header */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-emerald-500/20 text-emerald-300 px-2 py-0.5 text-[10px] font-black uppercase">
                  Extraction Engine
                </span>
                <h3 className="text-sm font-bold text-white">Extract Counted Stock Records</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                Extract physical stock counts recorded by store associates. Export includes detailed count entries,
                reconciliation variance against uploaded masterlist, and store/location summaries.
              </p>
            </div>

            {/* Direct Export Triggers */}
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={handleExtractToExcel}
                disabled={isExporting || filteredCountsForExtraction.length === 0}
                className="flex-1 md:flex-none h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white shadow-xl shadow-emerald-950 active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>{isExporting ? 'Generating Excel...' : 'Extract to Excel (.xlsx)'}</span>
              </button>

              <button
                onClick={handleExtractToCSV}
                disabled={filteredCountsForExtraction.length === 0}
                className="flex-1 md:flex-none h-11 px-4 rounded-xl bg-slate-950 border border-slate-700 hover:border-emerald-400 text-slate-200 font-bold text-xs shadow-md active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50"
                title="Extract clean comma-separated values feed"
              >
                <FileText className="w-4 h-4 text-emerald-400" />
                <span>Extract CSV</span>
              </button>
            </div>
          </div>

          {/* Export Notice Message */}
          {exportNotice && (
            <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/30 p-3 text-xs font-semibold text-emerald-300 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{exportNotice}</span>
            </div>
          )}

          {/* Extraction Filter Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Store Filter */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Filter Store</span>
              </label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="all">All Retail Stores</option>
                {stores.map((s) => (
                  <option key={s.storeId} value={s.storeId}>
                    {s.name} ({s.storeId})
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range Filter */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                <span>Date Range</span>
              </label>
              <select
                value={selectedDateRange}
                onChange={(e) => setSelectedDateRange(e.target.value as any)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="all">All Dates</option>
                <option value="today">Today Only</option>
                <option value="yesterday">Yesterday</option>
                <option value="7days">Past 7 Days</option>
                <option value="30days">Past 30 Days</option>
              </select>
            </div>

            {/* Location Filter */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                <span>Shelf / Location</span>
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="all">All Locations</option>
                {uniqueCountLocations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
          </div>

          {/* KPI Summary of Filtered Extract */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Records to Extract</span>
              <span className="text-xl font-black text-white font-mono mt-0.5 block">
                {filteredCountsForExtraction.length}
              </span>
            </div>

            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Units Counted</span>
              <span className="text-xl font-black text-emerald-400 font-mono mt-0.5 block">
                {filteredCountsForExtraction.reduce((acc, c) => acc + c.countedQuantity, 0).toLocaleString()}
              </span>
            </div>

            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Masterlist Reconciled</span>
              <span className="text-xl font-black text-purple-400 font-mono mt-0.5 block">
                {reconciliationData.filter((r) => r.status === 'matched').length} / {reconciliationData.length} SKUs
              </span>
            </div>

            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Discrepancies</span>
              <span className="text-xl font-black text-amber-400 font-mono mt-0.5 block">
                {reconciliationData.filter((r) => r.status === 'over' || r.status === 'under').length} SKUs
              </span>
            </div>
          </div>

          {/* Masterlist Reconciliation Preview */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">Physical Count vs. Masterlist Variance</h4>
                <p className="text-xs text-slate-400">
                  Real-time variance calculation against uploaded system stock
                </p>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {reconciliationData.length} SKUs Reconciled
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="sticky top-0 bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">System Stock</th>
                    <th className="px-3 py-2 text-right">Physical Count</th>
                    <th className="px-3 py-2 text-right">Variance</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 font-mono text-[11px]">
                  {reconciliationData.slice(0, 15).map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-bold text-purple-300">{row.sku}</td>
                      <td className="px-3 py-2 font-sans text-slate-200 truncate max-w-[200px]">{row.description}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{row.systemStock}</td>
                      <td className="px-3 py-2 text-right text-white font-bold">{row.countedQuantity}</td>
                      <td className={`px-3 py-2 text-right font-bold ${
                        row.variance === 0
                          ? 'text-slate-400'
                          : row.variance > 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}>
                        {row.variance > 0 ? `+${row.variance}` : row.variance}
                      </td>
                      <td className="px-3 py-2 text-center font-sans">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          row.status === 'matched'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : row.status === 'over'
                            ? 'bg-blue-500/15 text-blue-400'
                            : row.status === 'under'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Quick Extraction Action Footer */}
            <div className="pt-2 flex items-center justify-between text-xs text-slate-400">
              <span>Showing first 15 SKUs. Full variance analysis will be included in Sheet 2 of the Excel extract.</span>
              <button
                onClick={handleExtractToExcel}
                className="text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
              >
                <span>Extract All Records Now</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
