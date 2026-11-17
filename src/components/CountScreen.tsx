import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Product,
  Store,
  InventoryCount,
  AppUser,
  ItemCondition,
  LocationVerification,
  LocationRecountTask,
  LocationTag,
  StoreCountFinalization,
  CountingSession,
} from '../types/inventory';
import { getCountFinalizationId } from '../services/finalizationService';
import { getCountTypeLabel } from '../services/sessionService';
import { buildCatalogIndex, findProductByCodeInIndex, getLocalCatalog } from '../services/catalogService';
import { recordCount } from '../services/offlineSyncService';
import {
  getLocationVerificationId,
  submitLocationForVerification,
} from '../services/locationVerificationService';
import {
  getRecountAccessForUser,
  submitLocationRecountForReview,
} from '../services/recountService';
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
  ClipboardCheck,
  AlertTriangle,
  ShieldCheck,
  Lock,
  RefreshCw,
  EyeOff,
  Calendar,
} from 'lucide-react';

interface CountScreenProps {
  currentUser: AppUser;
  activeStore: Store;
  catalog?: Product[];
  counts?: InventoryCount[];
  locationVerifications?: LocationVerification[];
  locationRecounts?: LocationRecountTask[];
  locationTags?: LocationTag[];
  countFinalizations?: StoreCountFinalization[];
  activeSession?: CountingSession | null;
  onCountSaved: (savedCount: InventoryCount) => void;
}

export const CountScreen: React.FC<CountScreenProps> = ({
  currentUser,
  activeStore,
  catalog: externalCatalog,
  counts = [],
  locationVerifications = [],
  locationRecounts = [],
  locationTags = [],
  countFinalizations = [],
  activeSession = null,
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
    round?: 1 | 2;
  } | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isScannerPaused, setIsScannerPaused] = useState<boolean>(false);

  const catalogIndex = useMemo(() => buildCatalogIndex(catalog), [catalog]);

  const isSupervisorUser =
    currentUser.role === 'supervisor' || currentUser.role === 'ops_supervisor';
  const canAddSku =
    isSupervisorUser ||
    currentUser.role === 'admin';

  // Sticky location state retained across multiple counted items
  const [currentLocation, setCurrentLocation] = useState<string>(() => {
    return localStorage.getItem('inventory_count_active_location') || 'Aisle 1 - Shelf A';
  });
  const [itemsInLocationCount, setItemsInLocationCount] = useState<number>(0);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState<boolean>(false);
  const [counterVerifyNotes, setCounterVerifyNotes] = useState<string>('');
  const [isSubmittingVerification, setIsSubmittingVerification] = useState<boolean>(false);
  const [verifySubmitError, setVerifySubmitError] = useState<string | null>(null);

  const [countRound, setCountRound] = useState<1 | 2>(1);
  const [selectedRecountTaskId, setSelectedRecountTaskId] = useState<string>('');
  const [isSubmitRecountModalOpen, setIsSubmitRecountModalOpen] = useState<boolean>(false);
  const [recountSubmitNotes, setRecountSubmitNotes] = useState<string>('');
  const [isSubmittingRecount, setIsSubmittingRecount] = useState<boolean>(false);
  const [recountSubmitError, setRecountSubmitError] = useState<string | null>(null);

  const countsInCurrentLocation = useMemo(() => {
    const locLower = currentLocation.trim().toLowerCase();
    return counts.filter((c) => {
      if (c.status === 'voided') return false;
      if ((c.countRound ?? 1) !== 1) return false;
      const sameStore =
        c.storeId === activeStore.storeId ||
        c.store.toLowerCase() === activeStore.name.toLowerCase();
      const sameLoc = (c.location || '').trim().toLowerCase() === locLower;
      return sameStore && sameLoc;
    });
  }, [counts, activeStore, currentLocation]);

  const currentLocationUnits = useMemo(
    () => countsInCurrentLocation.reduce((sum, c) => sum + (Number(c.countedQuantity) || 0), 0),
    [countsInCurrentLocation]
  );

  const currentLocationVerification = useMemo(() => {
    const expectedId = getLocationVerificationId(
      activeStore.storeId,
      currentLocation,
      activeSession?.id
    );
    return (
      locationVerifications.find((v) => v.id === expectedId) ||
      locationVerifications.find(
        (v) =>
          v.storeId === activeStore.storeId &&
          v.location.trim().toLowerCase() === currentLocation.trim().toLowerCase()
      )
    );
  }, [locationVerifications, activeStore.storeId, currentLocation, activeSession?.id]);

  const isLocationDoneCounting =
    currentLocationVerification?.status === 'verified' ||
    currentLocationVerification?.doneCounting === true;
  const activeStoreFinalization = useMemo(() => {
    const finId = getCountFinalizationId(activeStore.storeId, activeSession?.id);
    return countFinalizations.find(
      (f) => f.id === finId || f.storeId.trim().toLowerCase() === activeStore.storeId.trim().toLowerCase()
    );
  }, [countFinalizations, activeStore.storeId, activeSession?.id]);
  const isSessionClosed = activeSession?.status === 'closed';
  const isStoreFinalized = activeStoreFinalization?.status === 'finalized';
  const isCountBlockedForUser =
    isSessionClosed ||
    isStoreFinalized ||
    (countRound === 1 && isLocationDoneCounting && !isSupervisorUser);

  const approvedLocationTagsForStore = useMemo(() => {
    return locationTags
      .filter((t) => t.storeId === activeStore.storeId && t.status === 'approved')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [locationTags, activeStore.storeId]);

  const isCurrentLocationApprovedTag = useMemo(() => {
    if (approvedLocationTagsForStore.length === 0) return true;
    const clean = currentLocation.trim().toLowerCase();
    return approvedLocationTagsForStore.some((t) => t.name.trim().toLowerCase() === clean);
  }, [approvedLocationTagsForStore, currentLocation]);

  useEffect(() => {
    if (approvedLocationTagsForStore.length === 0) return;
    if (isCurrentLocationApprovedTag) return;

    const firstAvailable = approvedLocationTagsForStore.find((tag) => {
      const verif = locationVerifications.find(
        (v) =>
          v.storeId === activeStore.storeId &&
          v.location.trim().toLowerCase() === tag.name.trim().toLowerCase()
      );
      return verif?.status !== 'verified' && verif?.doneCounting !== true;
    });
    const fallbackTag = firstAvailable || approvedLocationTagsForStore[0];
    if (fallbackTag) {
      setCurrentLocation(fallbackTag.name);
      try {
        localStorage.setItem('inventory_count_active_location', fallbackTag.name);
      } catch {}
    }
  }, [approvedLocationTagsForStore, isCurrentLocationApprovedTag, locationVerifications, activeStore.storeId]);

  // Second-count tasks scoped to activeStore with Round 1 exclusion + Supervisor Ops assignment check
  const storeRecountTasksWithAccess = useMemo(() => {
    const storeTasks = locationRecounts.filter(
      (t) =>
        (t.storeId === activeStore.storeId ||
          t.storeName.toLowerCase() === activeStore.name.toLowerCase()) &&
        (t.status === 'open' || t.status === 'pending_review')
    );

    return storeTasks
      .map((task) => {
        const access = getRecountAccessForUser({
          user: currentUser,
          storeId: activeStore.storeId,
          location: task.location,
          counts,
          task,
        });
        return { task, access };
      })
      .sort((a, b) => {
        // Priority: Assigned to Me + Open (0) -> Open Pool Eligible (1) -> Pending Review (2) -> Assigned to Other (3) -> Round 1 Excluded (4)
        const getScore = (item: typeof a) => {
          if (item.access.lockType === 'excluded_round1') return 4;
          if (item.access.lockType === 'assigned_other') return 3;
          if (item.task.status !== 'open') return 2;
          return item.access.assignedToCurrentUser ? 0 : 1;
        };
        const diff = getScore(a) - getScore(b);
        if (diff !== 0) return diff;
        return a.task.location.localeCompare(b.task.location);
      });
  }, [locationRecounts, activeStore, currentUser, counts]);

  const eligibleOpenRecountCount = useMemo(
    () =>
      storeRecountTasksWithAccess.filter(
        (item) => item.task.status === 'open' && item.access.allowed
      ).length,
    [storeRecountTasksWithAccess]
  );

  useEffect(() => {
    if (storeRecountTasksWithAccess.length === 0) {
      setSelectedRecountTaskId('');
      return;
    }
    const stillExists = storeRecountTasksWithAccess.some(
      (item) => item.task.id === selectedRecountTaskId
    );
    if (!stillExists) {
      const firstOpenEligible = storeRecountTasksWithAccess.find(
        (item) => item.task.status === 'open' && item.access.allowed
      );
      setSelectedRecountTaskId(
        (firstOpenEligible || storeRecountTasksWithAccess[0]).task.id
      );
    }
  }, [storeRecountTasksWithAccess, selectedRecountTaskId]);

  const activeRecountEntry = useMemo(
    () =>
      storeRecountTasksWithAccess.find((item) => item.task.id === selectedRecountTaskId) ||
      storeRecountTasksWithAccess[0],
    [storeRecountTasksWithAccess, selectedRecountTaskId]
  );

  const activeRecountTask = activeRecountEntry?.task;
  const activeRecountAccess = activeRecountEntry?.access;

  const round2CountsInActiveRecountLoc = useMemo(() => {
    if (!activeRecountTask) return [];
    const locLower = activeRecountTask.location.trim().toLowerCase();
    return counts.filter((c) => {
      if (c.status === 'voided') return false;
      if ((c.countRound ?? 1) !== 2) return false;
      const sameStore =
        c.storeId === activeStore.storeId ||
        c.store.toLowerCase() === activeStore.name.toLowerCase();
      const sameLoc = (c.location || '').trim().toLowerCase() === locLower;
      return sameStore && sameLoc;
    });
  }, [counts, activeRecountTask, activeStore]);

  const round2QtyBySkuInActiveLoc = useMemo(() => {
    const map = new Map<string, number>();
    round2CountsInActiveRecountLoc.forEach((c) => {
      const k = c.sku.trim().toLowerCase();
      map.set(k, (map.get(k) || 0) + (Number(c.countedQuantity) || 0));
    });
    return map;
  }, [round2CountsInActiveRecountLoc]);

  const isRound2BlockedForUser =
    countRound === 2 &&
    (isSessionClosed ||
      isStoreFinalized ||
      !activeRecountTask ||
      activeRecountTask.status !== 'open' ||
      !activeRecountAccess?.allowed);

  const handleSubmitLocationForVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSessionClosed || isStoreFinalized) {
      setVerifySubmitError('This counting session is closed/finalized and cannot accept location submissions.');
      return;
    }
    setVerifySubmitError(null);
    setIsSubmittingVerification(true);
    try {
      await submitLocationForVerification({
        store: activeStore,
        location: currentLocation,
        countsForLocation: countsInCurrentLocation,
        user: currentUser,
        counterNotes: counterVerifyNotes,
        session: activeSession || undefined,
      });
      setIsVerifyModalOpen(false);
      setCounterVerifyNotes('');
      setSaveSuccessMsg(
        `Location "${currentLocation}" submitted for Supervisor verification (${countsInCurrentLocation.length} items, ${currentLocationUnits} units).`
      );
      setTimeout(() => setSaveSuccessMsg(null), 4500);
    } catch (err: any) {
      setVerifySubmitError(err?.message || 'Could not submit location for verification.');
    } finally {
      setIsSubmittingVerification(false);
    }
  };

  const handleSubmitSecondCountForReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRecountTask) return;
    if (isSessionClosed || isStoreFinalized) {
      setRecountSubmitError('This counting session is closed/finalized and cannot accept 2nd-count submissions.');
      return;
    }
    setRecountSubmitError(null);
    setIsSubmittingRecount(true);
    try {
      await submitLocationRecountForReview({
        task: activeRecountTask,
        round2CountsForLocation: round2CountsInActiveRecountLoc,
        allCounts: counts,
        user: currentUser,
        counterNotes: recountSubmitNotes,
      });
      setIsSubmitRecountModalOpen(false);
      setRecountSubmitNotes('');
      setSaveSuccessMsg(
        `2nd Count for "${activeRecountTask.location}" submitted for Supervisor verification.`
      );
      setTimeout(() => setSaveSuccessMsg(null), 4500);
    } catch (err: any) {
      setRecountSubmitError(err?.message || 'Could not submit 2nd count for review.');
    } finally {
      setIsSubmittingRecount(false);
    }
  };

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
  const handleBarcodeIdentified = useCallback(
    (code: string, fromCamera = false) => {
      const trimmed = code.trim();
      if (!trimmed) return;

      setBarcodeInput(trimmed);
      const matched = findProductByCodeInIndex(trimmed, catalogIndex);

      if (countRound === 2) {
        if (!activeRecountTask) {
          setSelectedProduct(null);
          if (fromCamera) setIsScannerPaused(true);
          playScanErrorSound();
          setValidationError('Select an open 2nd-count location first.');
          return;
        }
        if (activeRecountAccess && !activeRecountAccess.allowed) {
          setSelectedProduct(null);
          if (fromCamera) setIsScannerPaused(true);
          playScanErrorSound();
          setValidationError(
            activeRecountAccess.reason ||
              `You cannot recount "${activeRecountTask.location}".`
          );
          return;
        }
        if (activeRecountTask.status !== 'open') {
          setSelectedProduct(null);
          if (fromCamera) setIsScannerPaused(true);
          playScanErrorSound();
          setValidationError(
            `Location "${activeRecountTask.location}" is pending supervisor review and cannot be edited right now.`
          );
          return;
        }
      }

      if (matched) {
        if (countRound === 2 && activeRecountTask) {
          const skuLower = matched.sku.trim().toLowerCase();
          const barcodeLower = (matched.barcode || '').trim().toLowerCase();
          const isFlaggedVarianceSku = activeRecountTask.varianceSkus.some(
            (v) =>
              v.sku.trim().toLowerCase() === skuLower ||
              v.barcode.trim().toLowerCase() === barcodeLower ||
              v.barcode.trim().toLowerCase() === skuLower
          );
          if (!isFlaggedVarianceSku) {
            setSelectedProduct(null);
            if (fromCamera) setIsScannerPaused(true);
            playScanErrorSound();
            setValidationError(
              `No variance flagged for "${matched.sku}" at "${activeRecountTask.location}" — only flagged variance SKUs need a 2nd count.`
            );
            return;
          }
        }

        setSelectedProduct(matched);
        setValidationError(null);
        setIsScannerPaused(true);
        playScanSuccessSound();
      } else {
        setSelectedProduct(null);
        if (fromCamera) {
          setIsScannerPaused(true);
        }
        playScanErrorSound();
        setValidationError(
          countRound === 2
            ? `Unrecognized barcode: "${trimmed}". Only flagged variance SKUs in "${activeRecountTask?.location || 'this location'}" can be recounted.`
            : `Unrecognized barcode: "${trimmed}". Tap below to register as a new item.`
        );
      }
    },
    [catalogIndex, countRound, activeRecountTask, activeRecountAccess]
  );

  const handleResumeScanner = useCallback(() => {
    setIsScannerPaused(false);
    setSelectedProduct(null);
    setBarcodeInput('');
    setValidationError(null);
  }, []);

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

    if (isSessionClosed) {
      setValidationError(
        `Session "${activeSession?.title || 'Counting Session'}" is closed and finalized. Switch to an active session or contact an Administrator to re-open it.`
      );
      playScanErrorSound();
      return;
    }

    if (isStoreFinalized) {
      setValidationError(
        `Counting for ${activeStore.name} (${activeStore.storeId}) is finalized. Contact an Administrator to re-open counting before recording more items.`
      );
      playScanErrorSound();
      return;
    }

    if (countRound === 1 && approvedLocationTagsForStore.length > 0 && !isCurrentLocationApprovedTag) {
      setValidationError(
        `Please tap "Select Location" and pick an Admin-approved location tag for ${activeStore.name}.`
      );
      playScanErrorSound();
      return;
    }

    if (countRound === 1 && isCountBlockedForUser) {
      setValidationError(
        `Location "${currentLocation}" is verified and tagged as Done Counting. Please switch to another location to count.`
      );
      playScanErrorSound();
      return;
    }

    if (countRound === 2) {
      if (!activeRecountTask) {
        setValidationError('No 2nd-count location is currently selected.');
        playScanErrorSound();
        return;
      }
      if (activeRecountAccess && !activeRecountAccess.allowed) {
        setValidationError(
          activeRecountAccess.reason ||
            `You are not authorized to recount "${activeRecountTask.location}".`
        );
        playScanErrorSound();
        return;
      }
      if (activeRecountTask.status !== 'open') {
        setValidationError(`Location "${activeRecountTask.location}" is not open for recounting.`);
        playScanErrorSound();
        return;
      }
    }

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

    if (countRound === 2 && activeRecountTask) {
      const skuLower = selectedProduct.sku.trim().toLowerCase();
      const isFlagged = activeRecountTask.varianceSkus.some(
        (v) => v.sku.trim().toLowerCase() === skuLower
      );
      if (!isFlagged) {
        setValidationError(
          `SKU "${selectedProduct.sku}" is not in the variance list for "${activeRecountTask.location}".`
        );
        playScanErrorSound();
        return;
      }
    }

    const targetLocation = countRound === 2 && activeRecountTask ? activeRecountTask.location : currentLocation;

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
        location: targetLocation,
        date: dateStr,
        time: timeStr,
        countRound,
        recountTaskId: countRound === 2 && activeRecountTask ? activeRecountTask.id : undefined,
        countType: activeSession?.countType || 'annual',
        sessionId: activeSession?.id,
        cutoffDate: activeSession?.cutoffDate,
      });

      onCountSaved(record);
      if (countRound === 1) {
        setItemsInLocationCount((prev) => prev + 1);
      }
      playScanSuccessSound();

      // Show prominent confirmation notification toast & inline banner
      const confirmationPayload = {
        sku: selectedProduct.sku,
        description: selectedProduct.description,
        qty: parsedQty,
        unit: selectedProduct.unit || 'pcs',
        condition,
        location: targetLocation,
        storeName: activeStore.name,
        synced: record.syncStatus === 'synced',
        round: countRound,
      };
      setSubmittedConfirmation(confirmationPayload);
      setSaveSuccessMsg(
        `${countRound === 2 ? '2nd Count Saved' : 'Saved'}: ${selectedProduct.sku} (${condition} · Qty: ${parsedQty}) at [${targetLocation}]`
      );

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
      setIsScannerPaused(false);
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
                    {submittedConfirmation.round === 2 ? '2nd Count Submitted' : 'Count Submitted'}
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

      {/* Active Session & Store Context Strip */}
      {activeSession && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider shrink-0 ${
                activeSession.countType === 'cycle'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
              }`}
            >
              {getCountTypeLabel(activeSession.countType)}
            </span>
            <span className="font-bold text-white truncate">{activeSession.title}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 shrink-0 tabular-nums">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>Cut-Off: {activeSession.cutoffDate}</span>
            {isSessionClosed && (
              <span className="rounded bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 text-[10px] font-sans font-bold uppercase">
                Closed
              </span>
            )}
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

      {/* Count Round Switcher: 1st Count vs 2nd Count (Variances) */}
      <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
        <button
          type="button"
          onClick={() => {
            setCountRound(1);
            setSelectedProduct(null);
            setBarcodeInput('');
            setValidationError(null);
            setIsScannerPaused(false);
          }}
          className={`flex items-center justify-center gap-2 min-h-[44px] py-2 rounded-lg text-xs font-bold transition active:scale-95 ${
            countRound === 1
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <span>1st Count</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setCountRound(2);
            setSelectedProduct(null);
            setBarcodeInput('');
            setValidationError(null);
            setIsScannerPaused(false);
          }}
          className={`flex items-center justify-center gap-2 min-h-[44px] py-2 rounded-lg text-xs font-bold transition active:scale-95 ${
            countRound === 2
              ? 'bg-amber-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>2nd Count</span>
          {eligibleOpenRecountCount > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums ${
                countRound === 2 ? 'bg-slate-950/50 text-white' : 'bg-amber-500/20 text-amber-300'
              }`}
            >
              {eligibleOpenRecountCount}
            </span>
          )}
        </button>
      </div>

      {isSessionClosed ? (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/35 px-4 py-3 text-xs text-amber-200 flex items-start gap-2.5">
          <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-300">
              Counting Session Closed &amp; Finalized
            </p>
            <p className="text-slate-300 mt-0.5">
              &ldquo;{activeSession?.title}&rdquo; (Cut-Off: {activeSession?.cutoffDate}) was closed
              {activeSession?.closedByName ? ` by ${activeSession.closedByName}` : ''}. New counts and verifications are locked unless an Administrator re-opens the session.
            </p>
          </div>
        </div>
      ) : (
        isStoreFinalized && (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/35 px-4 py-3 text-xs text-emerald-200 flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-emerald-300">
                {activeStore.name} ({activeStore.storeId}) Counting Finalized
              </p>
              <p className="text-slate-300 mt-0.5">
                Finalized by {activeStoreFinalization?.finalizedByName || 'Supervisor'}
                {activeStoreFinalization?.finalizedDate
                  ? ` on ${activeStoreFinalization.finalizedDate}`
                  : ''}
                . New submissions are locked unless an Administrator re-opens counting.
              </p>
            </div>
          </div>
        )
      )}

      {/* Round 1 Active Location Banner OR Round 2 Variance Location Queue */}
      {countRound === 1 ? (
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-emerald-500/30 p-3 shadow-md space-y-2.5">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
              <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="hidden sm:flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    Active Location
                  </span>
                  <span className="text-[10px] text-slate-500">
                    · {approvedLocationTagsForStore.length > 0 ? 'Tap Select to switch tag' : 'Retained for next items'}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:mt-0.5">
                  <button
                    type="button"
                    onClick={() => setIsLocationModalOpen(true)}
                    className="text-left text-sm font-bold text-white hover:text-emerald-300 font-mono break-words leading-snug transition"
                    title="Tap to select an approved location tag"
                  >
                    {currentLocation}
                  </button>
                  {isLocationDoneCounting && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.5 text-[10px] font-black uppercase text-emerald-300">
                      Done Counting
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400 font-sans shrink-0">
                    ({countsInCurrentLocation.length || itemsInLocationCount}{' '}
                    {(countsInCurrentLocation.length || itemsInLocationCount) === 1 ? 'item' : 'items'})
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {!isLocationDoneCounting && (
                <button
                  type="button"
                  onClick={() => {
                    setVerifySubmitError(null);
                    setCounterVerifyNotes('');
                    setIsVerifyModalOpen(true);
                  }}
                  disabled={countsInCurrentLocation.length === 0 || isSessionClosed || isStoreFinalized}
                  className="flex items-center gap-1.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/40 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-amber-300 active:scale-95 transition shrink-0 min-h-[44px] disabled:opacity-40"
                  title="Mark this location as done and notify Supervisor to check"
                >
                  <ClipboardCheck className="w-3.5 h-3.5 text-amber-400" />
                  <span className="sm:hidden">Done</span>
                  <span className="hidden sm:inline">Done Location</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsLocationModalOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-200 active:scale-95 transition shrink-0 min-h-[44px]"
                title="Tap to pick an approved location tag"
              >
                <Edit3 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="sm:hidden">Location</span>
                <span className="hidden sm:inline">Select Location</span>
              </button>
            </div>
          </div>

          {/* Live Location Verification Status Bar */}
          {currentLocationVerification && (
            <div
              className={`rounded-xl px-3 py-2 text-xs flex items-start gap-2 border ${
                currentLocationVerification.status === 'verified'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : currentLocationVerification.status === 'recount_needed'
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}
            >
              {currentLocationVerification.status === 'verified' ? (
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : currentLocationVerification.status === 'recount_needed' ? (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              ) : (
                <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="font-bold flex flex-wrap items-center gap-x-2">
                  <span>
                    {currentLocationVerification.status === 'verified'
                      ? `Tagged Done Counting · Verified by ${currentLocationVerification.verifiedByName}`
                      : currentLocationVerification.status === 'recount_needed'
                      ? `Recount Flagged by ${currentLocationVerification.verifiedByName}`
                      : `Pending Supervisor Check (Submitted by ${currentLocationVerification.submittedByName})`}
                  </span>
                  <span className="text-[10px] font-normal opacity-80">
                    {currentLocationVerification.status === 'pending_verification'
                      ? `${currentLocationVerification.submittedDate} ${currentLocationVerification.submittedTime}`
                      : `${currentLocationVerification.verifiedDate || ''} ${currentLocationVerification.verifiedTime || ''}`}
                  </span>
                </div>
                {currentLocationVerification.status === 'verified' && (
                  <p className="text-[11px] text-emerald-200/90">
                    {isSupervisorUser
                      ? 'Tagged Done Counting — Supervisor Override active: you can still add counts to this location.'
                      : 'Counting is closed for this location. Tap "Change Location" to move to your next shelf or bin.'}
                  </p>
                )}
                {currentLocationVerification.supervisorNotes && (
                  <p className="text-[11px] opacity-90">
                    Supervisor note: {currentLocationVerification.supervisorNotes}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-900 border border-amber-500/35 p-3.5 shadow-md space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                <EyeOff className="w-3.5 h-3.5" />
                <span>Blind 2nd Count Queue · {activeStore.name}</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                1st-count &amp; system quantities are hidden. You may only recount locations you did not count in Round 1.
              </p>
            </div>
            {activeRecountTask &&
              activeRecountTask.status === 'open' &&
              activeRecountAccess?.allowed && (
                <button
                  type="button"
                  onClick={() => {
                    setRecountSubmitError(null);
                    setRecountSubmitNotes('');
                    setIsSubmitRecountModalOpen(true);
                  }}
                  disabled={round2CountsInActiveRecountLoc.length === 0}
                  className="shrink-0 flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 px-3 min-h-[44px] text-xs font-bold text-white shadow active:scale-95 transition disabled:opacity-40"
                >
                  <ClipboardCheck className="w-4 h-4" />
                  <span>Submit 2nd Count</span>
                </button>
              )}
          </div>

          {storeRecountTasksWithAccess.length === 0 ? (
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 text-center space-y-1">
              <p className="text-xs font-bold text-slate-200">
                No open 2nd-count locations at {activeStore.name}
              </p>
              <p className="text-[11px] text-slate-400">
                Supervisors can open locations with SKU variances from the Supervisor dashboard.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {storeRecountTasksWithAccess.map(({ task, access }) => {
                  const isSelected = activeRecountTask?.id === task.id;
                  const isPendingReview = task.status === 'pending_review';
                  const isBlocked = !access.allowed;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => {
                        setSelectedRecountTaskId(task.id);
                        setSelectedProduct(null);
                        setBarcodeInput('');
                        setValidationError(null);
                        setIsScannerPaused(false);
                      }}
                      className={`text-left rounded-xl p-2.5 min-h-[48px] border transition active:scale-[0.99] ${
                        isSelected
                          ? isBlocked
                            ? 'bg-rose-950/35 border-rose-500/60'
                            : access.assignedToCurrentUser
                            ? 'bg-cyan-500/15 border-cyan-400'
                            : 'bg-amber-500/15 border-amber-400'
                          : isBlocked
                          ? 'bg-slate-950/70 border-slate-800 opacity-75'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-white truncate">
                          {task.location}
                        </span>
                        {access.lockType === 'excluded_round1' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-300 shrink-0">
                            <Lock className="w-3 h-3" />
                            Locked
                          </span>
                        ) : access.lockType === 'assigned_other' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-300 shrink-0">
                            <Lock className="w-3 h-3 text-amber-400" />
                            Assigned
                          </span>
                        ) : isPendingReview ? (
                          <span className="text-[10px] font-bold text-amber-300 shrink-0">
                            Pending Review
                          </span>
                        ) : access.assignedToCurrentUser ? (
                          <span className="text-[10px] font-bold text-cyan-300 shrink-0">
                            Assigned to You
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-emerald-400 shrink-0">
                            Eligible
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                        {task.varianceSkus.length} variance SKU{task.varianceSkus.length === 1 ? '' : 's'} ·{' '}
                        {access.lockType === 'excluded_round1'
                          ? 'Counted by you in 1st round'
                          : access.lockType === 'assigned_other'
                          ? `Assigned to ${task.assignedCounterName || 'another counter'}`
                          : isPendingReview
                          ? `Submitted by ${task.submittedByName || 'Counter'}`
                          : access.assignedToCurrentUser
                          ? `Assigned by ${task.assignedByName || 'Supervisor Ops'}`
                          : 'Open to eligible counters'}
                      </div>
                    </button>
                  );
                })}
              </div>

              {activeRecountTask && activeRecountAccess && !activeRecountAccess.allowed && (
                <div className="rounded-xl bg-rose-500/15 border border-rose-500/40 p-3 text-xs text-rose-200 flex items-start gap-2">
                  <Lock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-bold text-rose-100">
                      {activeRecountAccess.lockType === 'assigned_other'
                        ? `Assigned to ${activeRecountTask.assignedCounterName || 'Another Counter'}`
                        : 'Location Locked — 1st Round Exclusion Rule'}
                    </p>
                    <p className="text-[11px] leading-relaxed">
                      {activeRecountAccess.reason}
                    </p>
                  </div>
                </div>
              )}

              {activeRecountTask &&
                activeRecountAccess?.allowed &&
                activeRecountAccess.assignedToCurrentUser &&
                activeRecountTask.status === 'open' && (
                  <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/35 px-3 py-2 text-xs text-cyan-200 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-cyan-300 shrink-0" />
                    <span>
                      Assigned directly to you by{' '}
                      <strong className="text-white">
                        {activeRecountTask.assignedByName || 'Supervisor Ops'}
                      </strong>{' '}
                      for Blind 2nd Count.
                    </span>
                  </div>
                )}

              {activeRecountTask &&
                activeRecountAccess?.allowed &&
                activeRecountTask.status === 'pending_review' && (
                  <div className="rounded-xl bg-amber-500/15 border border-amber-500/35 p-3 text-xs text-amber-200 flex items-start gap-2">
                    <Clock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Submitted by {activeRecountTask.submittedByName || 'Counter'} — awaiting Supervisor verification before final reconciliation.
                    </span>
                  </div>
                )}

              {activeRecountTask &&
                activeRecountAccess?.allowed &&
                activeRecountTask.status === 'open' && (
                  <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-200">
                        Variance SKUs at {activeRecountTask.location}
                      </span>
                      <span className="text-slate-400 font-mono tabular-nums">
                        {
                          activeRecountTask.varianceSkus.filter((v) =>
                            round2QtyBySkuInActiveLoc.has(v.sku.trim().toLowerCase())
                          ).length
                        }
                        /{activeRecountTask.varianceSkus.length} recounted
                      </span>
                    </div>
                    <div className="divide-y divide-slate-800/80 max-h-48 overflow-y-auto">
                      {activeRecountTask.varianceSkus.map((v) => {
                        const qtyR2 = round2QtyBySkuInActiveLoc.get(v.sku.trim().toLowerCase());
                        const isRecounted = qtyR2 !== undefined;
                        const isActiveSelection =
                          selectedProduct?.sku.trim().toLowerCase() === v.sku.trim().toLowerCase();

                        return (
                          <button
                            key={v.sku}
                            type="button"
                            onClick={() => handleBarcodeIdentified(v.barcode || v.sku)}
                            className={`w-full text-left px-3 py-2.5 min-h-[44px] flex items-center justify-between gap-2 text-xs transition ${
                              isActiveSelection
                                ? 'bg-amber-500/15'
                                : 'hover:bg-slate-900/90'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-amber-300">{v.sku}</span>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  {v.barcode}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-300 truncate">
                                {v.description}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              {isRecounted ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300 font-mono tabular-nums">
                                  <CheckCircle2 className="w-3 h-3" />
                                  {qtyR2} {v.unit}
                                </span>
                              ) : (
                                <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                                  Pending
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {/* Mode Switcher: Camera Scanner vs Manual Keypad Entry */}
      <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
        <button
          onClick={() => {
            setUseCamera(true);
            setIsScannerPaused(Boolean(selectedProduct));
          }}
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
          onClick={() => {
            setUseCamera(false);
            setIsScannerPaused(false);
          }}
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
          {countRound === 1 && barcodeInput && !selectedProduct && (
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
                Unlisted Barcode: Counters cannot register new SKUs. Please provide this barcode to your Supervisor or Administrator to add to the Masterlist.
              </div>
            )
          )}
        </div>
      )}

      {/* Scanner Section */}
      {useCamera ? (
        <BarcodeScanner
          isScanningActive={
            useCamera &&
            !isLocationModalOpen &&
            !isAddModalOpen &&
            !isVerifyModalOpen &&
            !isSubmitRecountModalOpen
          }
          isPaused={isScannerPaused}
          pausedMessage={
            selectedProduct
              ? 'Item loaded — save count to scan next'
              : countRound === 2
              ? 'Scan skipped or locked — tap Resume to scan again'
              : 'Unrecognized barcode — register item or resume'
          }
          onResumeRequest={handleResumeScanner}
          onScan={(code) => handleBarcodeIdentified(code, true)}
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

      {/* Quick Test Barcodes Chips for instant demo (1st Count only) */}
      {countRound === 1 && !selectedProduct && (
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
              onClick={handleResumeScanner}
              className="text-xs text-slate-400 hover:text-white underline shrink-0 ml-2 min-h-[36px] px-1"
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
          disabled={isSaving || isCountBlockedForUser || isRound2BlockedForUser}
          className={`w-full h-14 rounded-2xl text-base font-bold text-white shadow-xl active:scale-98 transition flex items-center justify-center gap-2.5 disabled:opacity-50 ${
            countRound === 2
              ? 'bg-amber-600 shadow-amber-950 hover:bg-amber-500'
              : 'bg-emerald-600 shadow-emerald-950 hover:bg-emerald-500'
          }`}
        >
          <Send className="w-5 h-5" />
          <span>
            {countRound === 2
              ? !activeRecountTask
                ? 'No 2nd Count Location Available'
                : activeRecountAccess?.lockType === 'excluded_round1'
                ? 'Location Locked (1st Round Exclusion)'
                : activeRecountAccess?.lockType === 'assigned_other'
                ? `Assigned to ${activeRecountTask.assignedCounterName || 'Another Counter'}`
                : activeRecountTask.status !== 'open'
                ? 'Submitted — Pending Supervisor Review'
                : isSaving
                ? 'Recording 2nd Count...'
                : 'SAVE 2ND COUNT'
              : isSessionClosed
              ? 'Session Closed — Counting Locked'
              : isStoreFinalized
              ? 'Store Finalized — Counting Locked'
              : isCountBlockedForUser
              ? 'Location Done Counting — Switch Location'
              : isSaving
              ? 'Recording Count...'
              : isLocationDoneCounting && isSupervisorUser
              ? 'SAVE COUNT (DONE LOCATION)'
              : 'SAVE COUNT'}
          </span>
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
        activeStoreId={activeStore.storeId}
        activeStore={activeStore}
        currentUser={currentUser}
        locationTags={locationTags}
        locationVerifications={locationVerifications}
        activeSession={activeSession}
        canOverrideDoneLocation={isSupervisorUser}
        onClose={() => setIsLocationModalOpen(false)}
        onSelectLocation={handleLocationChanged}
      />

      {/* Submit Location for Supervisor Verification Modal */}
      {isVerifyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-amber-500/40 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Done with Location?</h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {activeStore.name} · {currentLocation}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsVerifyModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 shrink-0">
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-center">
                <span className="text-[10px] uppercase text-slate-400 block">Counted Items</span>
                <span className="text-lg font-black text-white font-mono">
                  {countsInCurrentLocation.length}
                </span>
              </div>
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-center">
                <span className="text-[10px] uppercase text-slate-400 block">Total Units</span>
                <span className="text-lg font-black text-emerald-400 font-mono">
                  {currentLocationUnits.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 divide-y divide-slate-800/80 min-h-[100px] max-h-52">
              {countsInCurrentLocation.map((item) => (
                <div key={item.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-emerald-400">{item.sku}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                          item.condition === 'Damage'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {item.condition || 'Good'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">
                      {item.itemDescription} · by {item.username}
                    </p>
                  </div>
                  <span className="font-mono font-black text-white text-sm shrink-0">
                    {item.countedQuantity}
                  </span>
                </div>
              ))}
            </div>

            {verifySubmitError && (
              <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-2.5 text-xs text-rose-300 font-medium shrink-0">
                {verifySubmitError}
              </div>
            )}

            <form onSubmit={handleSubmitLocationForVerification} className="space-y-3 shrink-0">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Notes for Supervisor (Optional)
                </label>
                <input
                  type="text"
                  value={counterVerifyNotes}
                  onChange={(e) => setCounterVerifyNotes(e.target.value)}
                  placeholder="e.g. All shelves and lower bins counted..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsVerifyModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Keep Counting
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingVerification || countsInCurrentLocation.length === 0}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow-md active:scale-95 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  <span>
                    {isSubmittingVerification
                      ? 'Submitting...'
                      : currentLocationVerification
                      ? 'Re-submit to Supervisor'
                      : 'Submit for Supervisor Check'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submit Blind 2nd Count for Supervisor Review Modal */}
      {isSubmitRecountModalOpen && activeRecountTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-amber-500/40 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Submit 2nd Count for Review?</h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {activeStore.name} · {activeRecountTask.location}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSubmitRecountModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 shrink-0">
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-center">
                <span className="text-[10px] uppercase text-slate-400 block">2nd Count Entries</span>
                <span className="text-lg font-black text-white font-mono tabular-nums">
                  {round2CountsInActiveRecountLoc.length}
                </span>
              </div>
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-2.5 text-center">
                <span className="text-[10px] uppercase text-slate-400 block">Variance SKUs Covered</span>
                <span className="text-lg font-black text-amber-400 font-mono tabular-nums">
                  {
                    activeRecountTask.varianceSkus.filter((v) =>
                      round2QtyBySkuInActiveLoc.has(v.sku.trim().toLowerCase())
                    ).length
                  }
                  /{activeRecountTask.varianceSkus.length}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto rounded-xl bg-slate-950 border border-slate-800 divide-y divide-slate-800/80 min-h-[90px] max-h-48">
              {round2CountsInActiveRecountLoc.map((item) => (
                <div key={item.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-bold text-amber-300">{item.sku}</span>
                    <p className="text-[11px] text-slate-400 truncate">
                      {item.itemDescription} · {item.condition || 'Good'}
                    </p>
                  </div>
                  <span className="font-mono font-black text-white text-sm shrink-0 tabular-nums">
                    {item.countedQuantity}
                  </span>
                </div>
              ))}
            </div>

            {recountSubmitError && (
              <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-2.5 text-xs text-rose-300 font-medium shrink-0">
                {recountSubmitError}
              </div>
            )}

            <form onSubmit={handleSubmitSecondCountForReview} className="space-y-3 shrink-0">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  2nd Count Notes for Supervisor (Optional)
                </label>
                <input
                  type="text"
                  value={recountSubmitNotes}
                  onChange={(e) => setRecountSubmitNotes(e.target.value)}
                  placeholder="e.g. Recounted top & bottom shelves..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSubmitRecountModalOpen(false)}
                  className="px-4 py-2 min-h-[44px] rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Keep Recounting
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRecount || round2CountsInActiveRecountLoc.length === 0}
                  className="px-4 py-2 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow-md active:scale-95 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  <span>{isSubmittingRecount ? 'Submitting...' : 'Submit 2nd Count'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
