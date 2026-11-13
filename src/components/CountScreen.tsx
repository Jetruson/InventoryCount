import React, { useState, useEffect, useRef } from 'react';
import { Product, Store, InventoryCount, AppUser, ItemCondition } from '../types/inventory';
import { findProductByCode, getLocalCatalog } from '../services/catalogService';
import { recordCount } from '../services/offlineSyncService';
import { BarcodeScanner } from './BarcodeScanner';
import { AddProductModal } from './AddProductModal';
import { LocationPickerModal } from './LocationPickerModal';
import { playScanSuccessSound, playScanErrorSound } from '../utils/audioFeedback';
import {
  Barcode,
  Camera,
  CheckCircle2,
  Plus,
  Minus,
  RotateCcw,
  Search,
  AlertCircle,
  Send,
  MapPin,
  Edit3,
  X,
  CloudCheck,
  Clock,
  ChevronDown,
} from 'lucide-react';

interface CountScreenProps {
  currentUser: AppUser;
  activeStore: Store;
  catalog?: Product[];
  onCountSaved: (savedCount: InventoryCount) => void;
}

export const CountScreen: React.FC<CountScreenProps> = ({
  currentUser,
  activeStore,
  catalog: externalCatalog,
  onCountSaved,
}) => {
  const [catalog, setCatalog] = useState<Product[]>(() =>
    externalCatalog && externalCatalog.length > 0 ? externalCatalog : getLocalCatalog()
  );
  const [useCamera, setUseCamera] = useState<boolean>(true);
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [countedQty, setCountedQty] = useState<string>('1');
  const [condition, setCondition] = useState<ItemCondition>(() => {
    try {
      return localStorage.getItem('inventory_count_active_condition') === 'Damage' ? 'Damage' : 'Good';
    } catch {
      return 'Good';
    }
  });
  const [remarks, setRemarks] = useState<string>('');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [submittedConfirmation, setSubmittedConfirmation] = useState<{
    sku: string;
    description: string;
    qty: number;
    unit: string;
    condition: ItemCondition;
    location: string;
    storeName: string;
    synced: boolean;
  } | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const canAddSku =
    currentUser.role === 'supervisor' ||
    currentUser.role === 'ops_supervisor' ||
    currentUser.role === 'admin';

  // Sticky location state retained across multiple counted items
  const [currentLocation, setCurrentLocation] = useState<string>(() => {
    return localStorage.getItem('inventory_count_active_location') || 'Aisle 1 - Shelf A';
  });
  const [itemsInLocationCount, setItemsInLocationCount] = useState<number>(0);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);

  // Sync catalog whenever App.tsx pushes a real-time Firestore catalog update
  useEffect(() => {
    if (externalCatalog !== undefined) {
      setCatalog(externalCatalog);
    } else {
      setCatalog(getLocalCatalog());
    }
  }, [externalCatalog]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
    };
  }, []);

  // Handle scanned or entered barcode
  const handleBarcodeIdentified = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setBarcodeInput(trimmed);
    const matched = findProductByCode(trimmed, catalog);

    if (matched) {
      setSelectedProduct(matched);
      setValidationError(null);
      playScanSuccessSound();
    } else {
      setSelectedProduct(null);
      playScanErrorSound();
      setValidationError(`Unrecognized barcode: "${trimmed}". Tap below to register as a new item.`);
    }
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) {
      setValidationError('Please enter a barcode or SKU');
      return;
    }
    handleBarcodeIdentified(barcodeInput);
  };

  // Quick increment/decrement steppers
  const adjustQuantity = (delta: number) => {
    const current = parseInt(countedQty, 10) || 0;
    const next = Math.max(0, current + delta);
    setCountedQty(String(next));
  };

  // Submit count
  const handleSaveCount = async () => {
    setValidationError(null);

    // 1. Validation: Barcode cannot be blank
    const cleanBarcode = barcodeInput.trim();
    if (!cleanBarcode) {
      setValidationError('Barcode cannot be blank. Scan or enter a barcode.');
      playScanErrorSound();
      return;
    }

    // 2. Validation: Quantity must be >= 0
    const parsedQty = Number(countedQty);
    if (isNaN(parsedQty) || parsedQty < 0) {
      setValidationError('Counted quantity must be greater than or equal to zero (0).');
      playScanErrorSound();
      return;
    }

    if (!selectedProduct) {
      setValidationError('Please select or register a valid product for this barcode first.');
      playScanErrorSound();
      return;
    }

    setIsSaving(true);

    try {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const timeStr = now.toTimeString().split(' ')[0]; // HH:mm:ss

      const record = await recordCount({
        username: currentUser.displayName || 'Counter Staff',
        userId: currentUser.uid,
        store: activeStore.name,
        storeId: activeStore.storeId,
        sku: selectedProduct.sku,
        barcode: selectedProduct.barcode || cleanBarcode,
        itemDescription: selectedProduct.description,
        countedQuantity: parsedQty,
        condition,
        remarks: remarks.trim(),
        location: currentLocation,
        date: dateStr,
        time: timeStr,
      });

      onCountSaved(record);
      setItemsInLocationCount((prev) => prev + 1);
      playScanSuccessSound();

      // Show prominent confirmation notification toast & inline banner
      const confirmationPayload = {
        sku: selectedProduct.sku,
        description: selectedProduct.description,
        qty: parsedQty,
        unit: selectedProduct.unit || 'pcs',
        condition,
        location: currentLocation,
        storeName: activeStore.name,
        synced: record.syncStatus === 'synced',
      };
      setSubmittedConfirmation(confirmationPayload);
      setSaveSuccessMsg(`Saved: ${selectedProduct.sku} (${condition} · Qty: ${parsedQty}) at [${currentLocation}]`);

      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
      }
      confirmTimerRef.current = setTimeout(() => {
        setSubmittedConfirmation(null);
        setSaveSuccessMsg(null);
      }, 4500);

      // Reset item inputs for next count (currentLocation & condition are retained!)
      setBarcodeInput('');
      setSelectedProduct(null);
      setCountedQty('1');
      setRemarks('');
    } catch (err: unknown) {
      setValidationError('Error saving count. Please verify network or try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLocationChanged = (newLoc: string) => {
    setCurrentLocation(newLoc);
    setItemsInLocationCount(0);
    try {
      localStorage.setItem('inventory_count_active_location', newLoc);
    } catch {}
    setSaveSuccessMsg(`Active location changed to "${newLoc}". Ready for items.`);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const sampleProducts = catalog.slice(0, 4);

  return (
    <div className="w-full max-w-xl mx-auto pb-24 pt-2 px-3.5 space-y-3.5">
      {/* Floating Count Submission Confirmation Notification */}
      {submittedConfirmation && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md rounded-2xl bg-emerald-950/95 backdrop-blur-md border-2 border-emerald-400/70 p-3.5 shadow-2xl shadow-emerald-950/80 text-slate-100 animate-in fade-in slide-in-from-top-3 duration-200"
        >
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-slate-950 shadow-md">
                <CheckCircle2 className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-emerald-300">
                    Count Submitted
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                      submittedConfirmation.synced
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {submittedConfirmation.synced ? (
                      <>
                        <CloudCheck className="w-3 h-3" />
                        Synced
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3" />
                        Queued Offline
                      </>
                    )}
                  </span>
                </div>
                <p className="text-sm font-bold text-white truncate">
                  {submittedConfirmation.sku} · Qty:{' '}
                  <span className="text-emerald-300 font-mono">
                    {submittedConfirmation.qty} {submittedConfirmation.unit}
                  </span>{' '}
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase align-middle ${
                      submittedConfirmation.condition === 'Damage'
                        ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                        : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {submittedConfirmation.condition}
                  </span>
                </p>
                <p className="text-[11px] text-slate-300 truncate">
                  {submittedConfirmation.description}
                </p>
                <p className="text-[10px] text-emerald-300/90 font-mono truncate">
                  {submittedConfirmation.storeName} · {submittedConfirmation.location}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSubmittedConfirmation(null)}
              className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-emerald-900/60 transition shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Active Store Indicator */}
      <div className="flex items-center justify-between bg-slate-800/80 rounded-xl px-3.5 py-2 border border-slate-700/60 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Counting at:</span>
          <span className="font-bold text-white tracking-wide">{activeStore.name}</span>
        </div>
        <span className="rounded-md bg-emerald-500/15 text-emerald-400 px-2 py-0.5 font-mono font-semibold text-[11px]">
          {activeStore.storeId}
        </span>
      </div>

      {/* Active Location Banner (Sticky across multiple items until changed) */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-emerald-500/30 p-2.5 sm:p-3.5 shadow-md flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
          <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
            <MapPin className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                Active Location
              </span>
              <span className="text-[10px] text-slate-500">· Retained for next items</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:mt-0.5">
              <span className="text-sm font-bold text-white font-mono break-words leading-snug">
                {currentLocation}
              </span>
              <span className="text-[11px] text-slate-400 font-sans shrink-0">
                ({itemsInLocationCount} {itemsInLocationCount === 1 ? 'item' : 'items'})
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsLocationModalOpen(true)}
          className="flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-200 active:scale-95 transition shrink-0 min-h-[36px]"
          title="Change location when finished counting this area"
        >
          <Edit3 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="sm:hidden">Change</span>
          <span className="hidden sm:inline">Change Location</span>
        </button>
      </div>

      {/* Mode Switcher: Camera Scanner vs Manual Keypad Entry */}
      <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
        <button
          onClick={() => setUseCamera(true)}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition active:scale-95 ${
            useCamera
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>Camera Scanner</span>
        </button>
        <button
          onClick={() => setUseCamera(false)}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition active:scale-95 ${
            !useCamera
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Barcode className="w-4 h-4" />
          <span>Manual Barcode</span>
        </button>
      </div>

      {/* Success Notification Banner */}
      {saveSuccessMsg && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-600/20 border border-emerald-500/40 px-3.5 py-2.5 text-xs font-bold text-emerald-300 animate-in fade-in duration-150">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Validation Error Banner */}
      {validationError && (
        <div className="flex flex-col gap-2 rounded-xl bg-rose-500/15 border border-rose-500/30 p-3 text-xs text-rose-300 animate-in fade-in">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed font-medium">{validationError}</span>
          </div>
          {barcodeInput && !selectedProduct && (
            canAddSku ? (
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="mt-1 self-start flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-500 active:scale-95 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Register "{barcodeInput}" to Catalog</span>
              </button>
            ) : (
              <div className="mt-1 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 font-medium">
                ⚠️ Unlisted Barcode: Counters cannot register new SKUs. Please provide this barcode to your Supervisor or Administrator to add to the Masterlist.
              </div>
            )
          )}
        </div>
      )}

      {/* Scanner Section */}
      {useCamera ? (
        <BarcodeScanner
          isScanningActive={useCamera}
          onScan={(code) => handleBarcodeIdentified(code)}
        />
      ) : (
        <form onSubmit={handleManualSearch} className="space-y-2">
          <div className="relative">
            <input
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="Scan or type barcode / SKU..."
              className="w-full rounded-2xl border-2 border-slate-700 bg-slate-950 px-4 py-3.5 pl-11 font-mono text-base text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              autoFocus
            />
            <Search className="absolute left-3.5 top-4 w-5 h-5 text-slate-400" />
            {barcodeInput && (
              <button
                type="button"
                onClick={() => setBarcodeInput('')}
                className="absolute right-3 top-3.5 rounded-md p-1 text-slate-400 hover:text-white"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="w-full h-12 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-100 hover:bg-slate-700 active:scale-98 transition flex items-center justify-center gap-2"
          >
            <Search className="w-4 h-4 text-emerald-400" />
            <span>Search Barcode / SKU</span>
          </button>
        </form>
      )}

      {/* Quick Test Barcodes Chips for instant demo */}
      {!selectedProduct && (
        <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold text-slate-300">Quick Barcode Samples:</span>
            <span className="text-[10px] text-slate-500">Tap to load</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sampleProducts.map((p) => (
              <button
                key={p.sku}
                onClick={() => handleBarcodeIdentified(p.barcode)}
                className="rounded-lg bg-slate-900 border border-slate-800 px-2.5 py-1 text-[11px] font-mono text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 transition"
              >
                {p.barcode} ({p.sku})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Identified Product Card */}
      {selectedProduct && (
        <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border-2 border-emerald-500/60 p-4 shadow-xl text-slate-100 animate-in fade-in duration-150">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 font-mono text-xs font-bold text-emerald-400">
                  Item No: {selectedProduct.sku}
                </span>
                <span className="text-xs text-slate-400">· Group: {selectedProduct.category || 'General'}</span>
              </div>
              <h2 className="mt-1.5 text-base font-bold text-white leading-snug">
                {selectedProduct.description}
              </h2>
            </div>
            <button
              onClick={() => setSelectedProduct(null)}
              className="text-xs text-slate-400 hover:text-white underline shrink-0 ml-2"
            >
              Change
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800/80 pt-2.5 text-xs">
            <div>
              <span className="text-slate-400">Barcode / Code:</span>{' '}
              <span className="font-mono text-slate-200">{selectedProduct.barcode || selectedProduct.sku}</span>
            </div>
            <div>
              <span className="text-slate-400">UoM:</span>{' '}
              <span className="font-medium text-slate-200">{selectedProduct.unit || 'pcs'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Counted Quantity Entry Section */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-md space-y-3">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
          Counted Quantity <span className="text-emerald-400">*</span>
        </label>

        {/* Big Quantity Display + Steppers */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => adjustQuantity(-1)}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-800 border border-slate-700 text-xl font-bold text-slate-200 hover:bg-slate-700 active:scale-95 transition"
            title="Minus 1"
          >
            <Minus className="w-6 h-6" />
          </button>

          <div className="relative flex-1">
            <input
              type="number"
              min="0"
              step="1"
              value={countedQty}
              onChange={(e) => setCountedQty(e.target.value)}
              className="w-full h-14 rounded-2xl border-2 border-slate-700 bg-slate-950 text-center font-mono text-3xl font-black text-white focus:border-emerald-500 focus:outline-none tabular-nums"
              placeholder="0"
            />
            {selectedProduct && (
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 uppercase">
                {selectedProduct.unit}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => adjustQuantity(1)}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-lg shadow-emerald-900/20 hover:bg-emerald-500 active:scale-95 transition"
            title="Plus 1"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>

        {/* Quick Stepper Chips: +5, +10, +50, Reset to 0 */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          <button
            type="button"
            onClick={() => adjustQuantity(5)}
            className="h-10 rounded-xl bg-slate-800 border border-slate-700/80 text-xs font-bold text-slate-200 hover:bg-slate-700 active:scale-95 transition"
          >
            +5
          </button>
          <button
            type="button"
            onClick={() => adjustQuantity(10)}
            className="h-10 rounded-xl bg-slate-800 border border-slate-700/80 text-xs font-bold text-slate-200 hover:bg-slate-700 active:scale-95 transition"
          >
            +10
          </button>
          <button
            type="button"
            onClick={() => adjustQuantity(50)}
            className="h-10 rounded-xl bg-slate-800 border border-slate-700/80 text-xs font-bold text-slate-200 hover:bg-slate-700 active:scale-95 transition"
          >
            +50
          </button>
          <button
            type="button"
            onClick={() => setCountedQty('0')}
            className="h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs font-bold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition"
          >
            Zero (0)
          </button>
        </div>
      </div>

      {/* Item Classification Dropdown (Good / Damage) */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-md space-y-2">
        <label
          htmlFor="item-condition-select"
          className="block text-xs font-bold uppercase tracking-wider text-slate-400"
        >
          Item Classification <span className="text-emerald-400">*</span>
        </label>
        <div className="relative">
          <select
            id="item-condition-select"
            value={condition}
            onChange={(e) => {
              const next = e.target.value as ItemCondition;
              setCondition(next);
              try {
                localStorage.setItem('inventory_count_active_condition', next);
              } catch {}
            }}
            className={`w-full h-12 appearance-none rounded-xl border-2 px-3.5 pr-10 text-sm font-bold focus:outline-none transition cursor-pointer ${
              condition === 'Damage'
                ? 'border-rose-500/70 bg-rose-950/30 text-rose-300 focus:border-rose-400'
                : 'border-emerald-500/50 bg-slate-950 text-emerald-300 focus:border-emerald-400'
            }`}
          >
            <option value="Good" className="bg-slate-900 text-emerald-300 font-semibold">
              Good
            </option>
            <option value="Damage" className="bg-slate-900 text-rose-300 font-semibold">
              Damage
            </option>
          </select>
          <ChevronDown
            className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
              condition === 'Damage' ? 'text-rose-400' : 'text-emerald-400'
            }`}
          />
        </div>
      </div>

      {/* Remarks Section */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-md space-y-2.5">
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
          Remarks (Optional)
        </label>

        {/* Quick Remarks Chips */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { code: 'NSC', label: 'No Stock Card', value: 'NSC (No Stock Card)' },
            { code: 'OST', label: 'Outdated Stock Card', value: 'OST (Outdated Stock Card)' },
            { code: 'NPT', label: 'No Price Tag', value: 'NPT (No Price Tag)' },
          ].map((tag) => {
            const isSelected = remarks
              .split(',')
              .map((s) => s.trim())
              .includes(tag.value);
            return (
              <button
                key={tag.code}
                type="button"
                onClick={() => {
                  setRemarks((prev) => {
                    const parts = prev
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (parts.includes(tag.value)) {
                      return parts.filter((p) => p !== tag.value).join(', ');
                    }
                    return [...parts, tag.value].join(', ');
                  });
                }}
                className={`rounded-lg px-2.5 py-1.5 text-xs border transition active:scale-95 ${
                  isSelected
                    ? 'bg-emerald-600/25 border-emerald-500/60 text-emerald-300 font-semibold'
                    : 'bg-slate-800 border-slate-700/80 text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {isSelected ? '✓ ' : '+ '}
                <span className="font-bold">{tag.code}</span>{' '}
                <span className={isSelected ? 'text-emerald-200/90' : 'text-slate-400'}>
                  ({tag.label})
                </span>
              </button>
            );
          })}
        </div>

        <input
          type="text"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="e.g. NSC, OST, NPT or additional notes..."
          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Sticky Save Thumb Button (Complies with 48px touch target & 15% sticky cap) */}
      <div className="pt-2">
        <button
          onClick={handleSaveCount}
          disabled={isSaving}
          className="w-full h-14 rounded-2xl bg-emerald-600 text-base font-bold text-white shadow-xl shadow-emerald-950 hover:bg-emerald-500 active:scale-98 transition flex items-center justify-center gap-2.5"
        >
          <Send className="w-5 h-5" />
          <span>{isSaving ? 'Recording Count...' : 'SAVE COUNT'}</span>
        </button>
      </div>

      {/* Add New Product Modal */}
      <AddProductModal
        isOpen={isAddModalOpen}
        initialBarcode={barcodeInput}
        onClose={() => setIsAddModalOpen(false)}
        onProductAdded={(newProd) => {
          setCatalog(prev => [newProd, ...prev]);
          setSelectedProduct(newProd);
          setValidationError(null);
        }}
      />

      {/* Location Selection & Barcode Scan Modal */}
      <LocationPickerModal
        isOpen={isLocationModalOpen}
        currentLocation={currentLocation}
        onClose={() => setIsLocationModalOpen(false)}
        onSelectLocation={handleLocationChanged}
      />
    </div>
  );
};
