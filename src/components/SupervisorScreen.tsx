import React, { useState, useMemo, useEffect } from 'react';
import {
  InventoryCount,
  Store,
  AppUser,
  LocationVerification,
  LocationVerificationStatus,
  Product,
  LocationRecountTask,
  LocationTag,
  ManagedUser,
  CorrectionRequest,
  StoreCountFinalization,
  CountVarianceItem,
  CountingSession,
} from '../types/inventory';
import {
  closeCountingSession,
  getCountTypeLabel,
  getCountTypeShortLabel,
  isSessionVisibleForStore,
} from '../services/sessionService';
import {
  getLocationVerificationId,
  reviewLocationVerification,
} from '../services/locationVerificationService';
import {
  assignLocationRecountCounter,
  computeVarianceLocationsForRecount,
  DetectedVarianceLocation,
  getEffectiveCountsForReconciliation,
  getEligibleCountersForLocationRecount,
  openLocationRecountTask,
  reviewLocationRecountTask,
} from '../services/recountService';
import {
  evaluateStoreFinalizationReadiness,
  finalizeStoreCounting,
  StoreFinalizationReadiness,
} from '../services/finalizationService';
import { requestLocationTag } from '../services/locationTagService';
import { getLocalManagedUsers, subscribeToManagedUsers } from '../services/userService';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Users,
  Building2,
  TrendingUp,
  Download,
  Search,
  Filter,
  CheckCircle2,
  Calendar,
  Layers,
  ArrowDownToLine,
  MapPin,
  Lock,
  ClipboardCheck,
  ShieldCheck,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  Check,
  AlertCircle,
  RefreshCw,
  Send,
  UserCheck,
} from 'lucide-react';

interface SupervisorScreenProps {
  counts: InventoryCount[];
  stores: Store[];
  catalog?: Product[];
  currentUser?: AppUser;
  locationVerifications?: LocationVerification[];
  locationRecounts?: LocationRecountTask[];
  locationTags?: LocationTag[];
  correctionRequests?: CorrectionRequest[];
  countFinalizations?: StoreCountFinalization[];
  activeSession?: CountingSession | null;
}

export const SupervisorScreen: React.FC<SupervisorScreenProps> = ({
  counts,
  stores,
  catalog = [],
  currentUser,
  locationVerifications = [],
  locationRecounts = [],
  locationTags = [],
  correctionRequests = [],
  countFinalizations = [],
  activeSession = null,
}) => {
  const isSessionClosed = activeSession?.status === 'closed';
  const isStoreSupervisor = currentUser?.role === 'supervisor';
  const isOpsSupervisor = currentUser?.role === 'ops_supervisor';
  const isAdminUser = currentUser?.role === 'admin';
  const canManageRecounts = isStoreSupervisor || isOpsSupervisor || isAdminUser;
  const assignedStoreId = currentUser?.assignedStoreId || currentUser?.activeStoreId;
  const assignedStore = useMemo(() => {
    return stores.find((s) => s.storeId === assignedStoreId) || stores[0];
  }, [stores, assignedStoreId]);

  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<
    | 'verify_locations'
    | 'second_count'
    | 'system_balance'
    | 'location_tags'
    | 'all'
    | 'by_user'
    | 'by_store'
    | 'by_location'
  >('verify_locations');
  const [verificationStatusFilter, setVerificationStatusFilter] = useState<
    'all' | LocationVerificationStatus | 'in_progress'
  >('all');
  const [expandedLocations, setExpandedLocations] = useState<Record<string, boolean>>({});
  const [checkedLineItems, setCheckedLineItems] = useState<Record<string, boolean>>({});
  const [reviewNotesMap, setReviewNotesMap] = useState<Record<string, string>>({});
  const [reviewingLocationKey, setReviewingLocationKey] = useState<string | null>(null);
  const [verifyFeedback, setVerifyFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [recountFeedback, setRecountFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [recountReviewNotesMap, setRecountReviewNotesMap] = useState<Record<string, string>>({});
  const [busyRecountId, setBusyRecountId] = useState<string | null>(null);
  const [isOpeningAllRecounts, setIsOpeningAllRecounts] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>(() => getLocalManagedUsers());
  const [selectedAssigneeByLocId, setSelectedAssigneeByLocId] = useState<Record<string, string>>({});
  const [draftAssigneeByTaskId, setDraftAssigneeByTaskId] = useState<Record<string, string>>({});
  const [finalizingStoreId, setFinalizingStoreId] = useState<string | null>(null);
  const [isClosingSession, setIsClosingSession] = useState<boolean>(false);
  const [finalizeFeedback, setFinalizeFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'variances' | 'matched' | 'uncounted'>('all');

  useEffect(() => {
    const unsub = subscribeToManagedUsers((users) => {
      setManagedUsers(users);
    });
    return () => unsub();
  }, []);

  // Supervisor Location Tag Request state
  const [tagRequestStoreId, setTagRequestStoreId] = useState<string>(
    assignedStore?.storeId || stores[0]?.storeId || 'ST-101'
  );
  const [tagRequestName, setTagRequestName] = useState<string>('');
  const [tagRequestZone, setTagRequestZone] = useState<string>('');
  const [tagRequestNotes, setTagRequestNotes] = useState<string>('');
  const [isSubmittingTagRequest, setIsSubmittingTagRequest] = useState<boolean>(false);
  const [tagRequestFeedback, setTagRequestFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Scoped dataset: exclude voided records from active inventory calculations;
  // store supervisor ONLY sees counts from their assigned store; ops_supervisor sees all stores
  const scopedCounts = useMemo(() => {
    const activeOnly = counts.filter((c) => c.status !== 'voided');
    if (isStoreSupervisor && assignedStore) {
      return activeOnly.filter(
        (c) =>
          c.storeId === assignedStore.storeId ||
          c.store.toLowerCase() === assignedStore.name.toLowerCase()
      );
    }
    return activeOnly;
  }, [counts, isStoreSupervisor, assignedStore]);

  // Filtered dataset
  const filteredSubmissions = useMemo(() => {
    return scopedCounts.filter((c) => {
      // Store filter (active for admin and ops_supervisor)
      if (!isStoreSupervisor && selectedStore !== 'all') {
        const matchesStore = c.storeId === selectedStore || c.store.toLowerCase().includes(selectedStore.toLowerCase());
        if (!matchesStore) return false;
      }

      // User filter
      if (selectedUser !== 'all' && c.username !== selectedUser) {
        return false;
      }

      // Text query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSku = c.sku.toLowerCase().includes(q);
        const matchStore = c.store.toLowerCase().includes(q);
        const matchUser = c.username.toLowerCase().includes(q);
        const matchDesc = (c.itemDescription || '').toLowerCase().includes(q);
        const matchLoc = (c.location || '').toLowerCase().includes(q);
        if (!matchSku && !matchStore && !matchUser && !matchDesc && !matchLoc) return false;
      }

      return true;
    });
  }, [scopedCounts, isStoreSupervisor, selectedStore, selectedUser, searchQuery]);

  // Unique users list
  const userList = useMemo(() => {
    const set = new Set<string>();
    scopedCounts.forEach((c) => {
      if (c.username) set.add(c.username);
    });
    return Array.from(set);
  }, [scopedCounts]);

  // Aggregated KPI metrics
  const metrics = useMemo(() => {
    const totalUnits = filteredSubmissions.reduce((acc, c) => acc + (Number(c.countedQuantity) || 0), 0);
    const skuSet = new Set(filteredSubmissions.map((c) => c.sku));
    const counterSet = new Set(filteredSubmissions.map((c) => c.username));
    const storeSet = new Set(filteredSubmissions.map((c) => c.store));

    return {
      totalSubmissions: filteredSubmissions.length,
      totalUnits,
      uniqueSkus: skuSet.size,
      activeCounters: counterSet.size,
      storesRepresented: storeSet.size,
    };
  }, [filteredSubmissions]);

  // User breakdown statistics
  const userBreakdown = useMemo(() => {
    const map = new Map<string, { username: string; countRecords: number; totalUnits: number; lastActive: string }>();

    filteredSubmissions.forEach((c) => {
      const u = c.username || 'Unknown';
      const existing = map.get(u) || {
        username: u,
        countRecords: 0,
        totalUnits: 0,
        lastActive: `${c.date} ${c.time}`,
      };
      existing.countRecords += 1;
      existing.totalUnits += Number(c.countedQuantity) || 0;
      map.set(u, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.totalUnits - a.totalUnits);
  }, [filteredSubmissions]);

  // Store breakdown statistics
  const storeBreakdown = useMemo(() => {
    const map = new Map<string, { store: string; countRecords: number; totalUnits: number; uniqueSkus: Set<string> }>();

    filteredSubmissions.forEach((c) => {
      const s = c.store || 'Unknown Store';
      const existing = map.get(s) || {
        store: s,
        countRecords: 0,
        totalUnits: 0,
        uniqueSkus: new Set<string>(),
      };
      existing.countRecords += 1;
      existing.totalUnits += Number(c.countedQuantity) || 0;
      existing.uniqueSkus.add(c.sku);
      map.set(s, existing);
    });

    return Array.from(map.values()).map(item => ({
      store: item.store,
      countRecords: item.countRecords,
      totalUnits: item.totalUnits,
      uniqueSkusCount: item.uniqueSkus.size,
    })).sort((a, b) => b.totalUnits - a.totalUnits);
  }, [filteredSubmissions]);

  // Location breakdown statistics
  const locationBreakdown = useMemo(() => {
    const map = new Map<string, { location: string; countRecords: number; totalUnits: number; uniqueSkus: Set<string> }>();

    filteredSubmissions.forEach((c) => {
      const loc = c.location || 'Unassigned Location';
      const existing = map.get(loc) || {
        location: loc,
        countRecords: 0,
        totalUnits: 0,
        uniqueSkus: new Set<string>(),
      };
      existing.countRecords += 1;
      existing.totalUnits += Number(c.countedQuantity) || 0;
      existing.uniqueSkus.add(c.sku);
      map.set(loc, existing);
    });

    return Array.from(map.values()).map(item => ({
      location: item.location,
      countRecords: item.countRecords,
      totalUnits: item.totalUnits,
      uniqueSkusCount: item.uniqueSkus.size,
    })).sort((a, b) => b.totalUnits - a.totalUnits);
  }, [filteredSubmissions]);

  // Grouped Location Verification Cards (Store + Location)
  const locationVerificationGroups = useMemo(() => {
    interface GroupAcc {
      key: string;
      storeId: string;
      storeName: string;
      location: string;
      items: InventoryCount[];
      totalUnits: number;
      goodUnits: number;
      damageUnits: number;
      uniqueSkus: Set<string>;
      counters: Set<string>;
      verification?: LocationVerification;
    }

    const groupMap = new Map<string, GroupAcc>();

    filteredSubmissions.forEach((c) => {
      const storeId = c.storeId || c.store || 'UNKNOWN';
      const storeName = c.store || storeId;
      const loc = (c.location || 'Unassigned Location').trim();
      const key = getLocationVerificationId(storeId, loc, activeSession?.id);
      const existing = groupMap.get(key) || {
        key,
        storeId,
        storeName,
        location: loc,
        items: [],
        totalUnits: 0,
        goodUnits: 0,
        damageUnits: 0,
        uniqueSkus: new Set<string>(),
        counters: new Set<string>(),
      };

      const qty = Number(c.countedQuantity) || 0;
      existing.items.push(c);
      existing.totalUnits += qty;
      if (c.condition === 'Damage') {
        existing.damageUnits += qty;
      } else {
        existing.goodUnits += qty;
      }
      existing.uniqueSkus.add(c.sku);
      if (c.username) existing.counters.add(c.username);
      groupMap.set(key, existing);
    });

    // Attach verification records (and ensure scoped pending verifications show up even if filtered)
    locationVerifications.forEach((v) => {
      if (isStoreSupervisor && assignedStore && v.storeId !== assignedStore.storeId) return;
      if (!isStoreSupervisor && selectedStore !== 'all' && v.storeId !== selectedStore) return;

      const existing = groupMap.get(v.id);
      if (existing) {
        existing.verification = v;
      } else if (!searchQuery.trim() && selectedUser === 'all') {
        groupMap.set(v.id, {
          key: v.id,
          storeId: v.storeId,
          storeName: v.storeName,
          location: v.location,
          items: [],
          totalUnits: v.totalUnitsSnapshot,
          goodUnits: v.totalUnitsSnapshot,
          damageUnits: 0,
          uniqueSkus: new Set<string>(),
          counters: new Set<string>([v.submittedByName]),
          verification: v,
        });
      }
    });

    const priority: Record<string, number> = {
      pending_verification: 0,
      recount_needed: 1,
      in_progress: 2,
      verified: 3,
    };

    return Array.from(groupMap.values())
      .map((g) => ({
        ...g,
        effectiveStatus: (g.verification?.status || 'in_progress') as
          | LocationVerificationStatus
          | 'in_progress',
      }))
      .sort((a, b) => {
        const diff = (priority[a.effectiveStatus] ?? 9) - (priority[b.effectiveStatus] ?? 9);
        if (diff !== 0) return diff;
        return b.totalUnits - a.totalUnits;
      });
  }, [
    filteredSubmissions,
    locationVerifications,
    isStoreSupervisor,
    assignedStore,
    selectedStore,
    searchQuery,
    selectedUser,
  ]);

  const pendingLocationCheckCount = useMemo(
    () =>
      locationVerificationGroups.filter((g) => g.effectiveStatus === 'pending_verification').length,
    [locationVerificationGroups]
  );

  const visibleVerificationGroups = useMemo(() => {
    if (verificationStatusFilter === 'all') return locationVerificationGroups;
    return locationVerificationGroups.filter((g) => g.effectiveStatus === verificationStatusFilter);
  }, [locationVerificationGroups, verificationStatusFilter]);

  const handleToggleItemCheck = (itemId: string) => {
    setCheckedLineItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const handleSupervisorReviewLocation = async (
    group: (typeof locationVerificationGroups)[number],
    decision: 'verified' | 'recount_needed'
  ) => {
    if (!currentUser) return;
    if (isSessionClosed) {
      setVerifyFeedback({
        type: 'error',
        text: 'This counting session is closed and locked. Verification decisions are disabled.',
      });
      return;
    }
    setVerifyFeedback(null);
    setReviewingLocationKey(group.key);
    try {
      const notes = reviewNotesMap[group.key] || '';
      await reviewLocationVerification({
        storeId: group.storeId,
        storeName: group.storeName,
        location: group.location,
        decision,
        supervisor: currentUser,
        supervisorNotes: notes,
        countsForLocation: group.items,
        existingVerification: group.verification,
        session: activeSession || undefined,
      });
      setVerifyFeedback({
        type: 'success',
        text:
          decision === 'verified'
            ? `Verified "${group.location}" (${group.storeName}) — tagged as Done Counting.`
            : `Flagged "${group.location}" (${group.storeName}) for recount.`,
      });
      setReviewNotesMap((prev) => ({ ...prev, [group.key]: '' }));
    } catch (err: any) {
      setVerifyFeedback({
        type: 'error',
        text: err?.message || 'Failed to save verification decision.',
      });
    } finally {
      setReviewingLocationKey(null);
    }
  };

  // Second-count variance detection & task management
  const activeStoreScopeId = isStoreSupervisor && assignedStore ? assignedStore.storeId : selectedStore;

  const detectedVarianceLocations = useMemo(
    () =>
      computeVarianceLocationsForRecount({
        counts: scopedCounts,
        catalog,
        recountTasks: locationRecounts,
        storeFilterId: activeStoreScopeId,
        sessionId: activeSession?.id,
      }),
    [scopedCounts, catalog, locationRecounts, activeStoreScopeId, activeSession?.id]
  );

  const unopenedVarianceLocations = useMemo(
    () => detectedVarianceLocations.filter((loc) => !loc.existingTask),
    [detectedVarianceLocations]
  );

  const scopedLocationRecounts = useMemo(() => {
    const filtered = locationRecounts.filter((t) => {
      if (isStoreSupervisor && assignedStore) {
        return (
          t.storeId === assignedStore.storeId ||
          t.storeName.toLowerCase() === assignedStore.name.toLowerCase()
        );
      }
      if (selectedStore !== 'all') {
        return t.storeId === selectedStore;
      }
      return true;
    });

    const priority: Record<string, number> = {
      pending_review: 0,
      open: 1,
      verified: 2,
    };

    return [...filtered].sort((a, b) => {
      const diff = (priority[a.status] ?? 9) - (priority[b.status] ?? 9);
      if (diff !== 0) return diff;
      return (b.openedAt || 0) - (a.openedAt || 0);
    });
  }, [locationRecounts, isStoreSupervisor, assignedStore, selectedStore]);

  const pendingRecountReviewCount = useMemo(
    () => scopedLocationRecounts.filter((t) => t.status === 'pending_review').length,
    [scopedLocationRecounts]
  );

  const round2QtyLookup = useMemo(() => {
    const map = new Map<string, number>();
    scopedCounts.forEach((c) => {
      if ((c.countRound ?? 1) !== 2) return;
      const key = `${c.storeId.trim().toLowerCase()}::${(c.location || '').trim().toLowerCase()}::${c.sku.trim().toLowerCase()}`;
      map.set(key, (map.get(key) || 0) + (Number(c.countedQuantity) || 0));
    });
    return map;
  }, [scopedCounts]);

  // Finalization state & System Balance unlock gating (after 2nd counting is done)
  const finalizedStoreIds = useMemo(() => {
    const set = new Set<string>();
    countFinalizations.forEach((f) => {
      if (f.status === 'finalized') {
        set.add(f.storeId);
        set.add(f.storeId.trim().toLowerCase());
      }
    });
    return set;
  }, [countFinalizations]);

  const isStoreFinalized = (storeId: string) =>
    finalizedStoreIds.has(storeId) || finalizedStoreIds.has(storeId.trim().toLowerCase());

  const storesInScopeForFinalization = useMemo(() => {
    if (isStoreSupervisor && assignedStore) {
      return [assignedStore];
    }
    if (selectedStore !== 'all') {
      const matched = stores.find((s) => s.storeId === selectedStore);
      return matched ? [matched] : [];
    }
    if (activeSession && activeSession.storeId && activeSession.storeId !== 'ALL') {
      return stores.filter((s) => isSessionVisibleForStore(activeSession, s.storeId));
    }
    return stores;
  }, [isStoreSupervisor, assignedStore, selectedStore, stores, activeSession]);

  const storeReadinessList: StoreFinalizationReadiness[] = useMemo(() => {
    return storesInScopeForFinalization.map((st) =>
      evaluateStoreFinalizationReadiness({
        store: st,
        counts,
        catalog,
        locationVerifications,
        locationRecounts,
        correctionRequests,
        countFinalizations,
        session: activeSession || undefined,
      })
    );
  }, [
    storesInScopeForFinalization,
    counts,
    catalog,
    locationVerifications,
    locationRecounts,
    correctionRequests,
    countFinalizations,
    activeSession,
  ]);

  // System balance table unlocks ONLY when all stores in active scope with counts (or selected store) are finalized, or session is closed
  const isScopeSystemBalanceUnlocked = useMemo(() => {
    if (activeSession?.status === 'closed') return true;
    if (storeReadinessList.length === 0) return false;
    if (storeReadinessList.length === 1) {
      return storeReadinessList[0].isFinalized;
    }
    const activeStores = storeReadinessList.filter(
      (r) => r.activeCountRecords > 0 || r.isFinalized
    );
    return activeStores.length > 0 && activeStores.every((r) => r.isFinalized);
  }, [storeReadinessList, activeSession?.status]);

  const finalizedReconciliationRows: (CountVarianceItem & {
    round1Quantity: number;
    round2Quantity: number | null;
  })[] = useMemo(() => {
    if (!isScopeSystemBalanceUnlocked) return [];

    const scopeStoreIds = new Set(
      storesInScopeForFinalization.map((s) => s.storeId.trim().toLowerCase())
    );
    const scopeStoreNames = new Set(
      storesInScopeForFinalization.map((s) => s.name.trim().toLowerCase())
    );

    const storeFilteredCounts = scopedCounts.filter(
      (c) =>
        scopeStoreIds.has(c.storeId.trim().toLowerCase()) ||
        scopeStoreNames.has(c.store.trim().toLowerCase())
    );
    const storeFilteredRecounts = locationRecounts.filter(
      (t) =>
        scopeStoreIds.has(t.storeId.trim().toLowerCase()) ||
        scopeStoreNames.has(t.storeName.trim().toLowerCase())
    );

    const { effectiveCounts, round1QtyBySku, round2QtyBySku } =
      getEffectiveCountsForReconciliation(storeFilteredCounts, storeFilteredRecounts);

    const countMap = new Map<string, { qty: number; stores: Set<string>; locations: Set<string> }>();
    effectiveCounts.forEach((c) => {
      const key = c.sku.toLowerCase();
      const existing = countMap.get(key) || { qty: 0, stores: new Set(), locations: new Set() };
      existing.qty += Number(c.countedQuantity) || 0;
      if (c.store) existing.stores.add(c.store);
      if (c.location) existing.locations.add(c.location);
      countMap.set(key, existing);
    });

    const rows: (CountVarianceItem & {
      round1Quantity: number;
      round2Quantity: number | null;
    })[] = [];
    const visitedSkus = new Set<string>();

    catalog.forEach((prod) => {
      const key = prod.sku.toLowerCase();
      visitedSkus.add(key);
      const countInfo = countMap.get(key);
      const countedQuantity = countInfo ? countInfo.qty : 0;
      const round1Quantity = round1QtyBySku.get(key) ?? 0;
      const round2Quantity = round2QtyBySku.has(key) ? (round2QtyBySku.get(key) ?? 0) : null;
      const systemStock = prod.systemStock ?? 0;
      const variance = countedQuantity - systemStock;

      let status: 'matched' | 'over' | 'under' | 'uncounted' = 'matched';
      if (!countInfo && round1Quantity === 0) {
        status = 'uncounted';
      } else if (variance > 0) {
        status = 'over';
      } else if (variance < 0) {
        status = 'under';
      }

      rows.push({
        sku: prod.sku,
        barcode: prod.barcode,
        description: prod.description,
        category: prod.category || 'General',
        systemStock,
        countedQuantity,
        round1Quantity,
        round2Quantity,
        variance,
        status,
        storesFound: countInfo ? Array.from(countInfo.stores) : [],
        locationsFound: countInfo ? Array.from(countInfo.locations) : [],
      });
    });

    countMap.forEach((info, key) => {
      if (!visitedSkus.has(key)) {
        const sample = effectiveCounts.find((c) => c.sku.toLowerCase() === key);
        const round1Quantity = round1QtyBySku.get(key) ?? 0;
        const round2Quantity = round2QtyBySku.has(key) ? (round2QtyBySku.get(key) ?? 0) : null;
        rows.push({
          sku: sample?.sku || key.toUpperCase(),
          barcode: sample?.barcode || '',
          description: sample?.itemDescription || 'Uncataloged Item',
          category: 'Uncataloged',
          systemStock: 0,
          countedQuantity: info.qty,
          round1Quantity,
          round2Quantity,
          variance: info.qty,
          status: 'over',
          storesFound: Array.from(info.stores),
          locationsFound: Array.from(info.locations),
        });
      }
    });

    return rows.filter((r) => {
      if (balanceFilter === 'variances' && r.status !== 'over' && r.status !== 'under') return false;
      if (balanceFilter === 'matched' && r.status !== 'matched') return false;
      if (balanceFilter === 'uncounted' && r.status !== 'uncounted') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          r.sku.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.barcode.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [
    isScopeSystemBalanceUnlocked,
    storesInScopeForFinalization,
    scopedCounts,
    locationRecounts,
    catalog,
    balanceFilter,
    searchQuery,
  ]);

  const handleFinalizeStore = async (readiness: StoreFinalizationReadiness) => {
    if (!currentUser) return;
    if (isSessionClosed) {
      setFinalizeFeedback({
        type: 'error',
        text: 'This counting session is already closed and finalized.',
      });
      return;
    }
    const store = stores.find((s) => s.storeId === readiness.storeId) || {
      storeId: readiness.storeId,
      name: readiness.storeName,
      location: '',
    };
    setFinalizeFeedback(null);
    setFinalizingStoreId(readiness.storeId);
    try {
      await finalizeStoreCounting({
        store,
        actor: currentUser,
        readiness,
        session: activeSession || undefined,
      });
      setFinalizeFeedback({
        type: 'success',
        text: `${readiness.storeName} (${readiness.storeId}) counting finalized. System balance is now unlocked.`,
      });
    } catch (err: any) {
      setFinalizeFeedback({
        type: 'error',
        text: err?.message || 'Could not finalize store counting.',
      });
    } finally {
      setFinalizingStoreId(null);
    }
  };

  const handleCloseCountingSession = async () => {
    if (!currentUser || !activeSession || activeSession.status === 'closed') return;
    setFinalizeFeedback(null);
    setIsClosingSession(true);
    try {
      await closeCountingSession({
        session: activeSession,
        actor: currentUser,
      });
      setFinalizeFeedback({
        type: 'success',
        text: `Closed and finalized "${activeSession.title}" (Cut-Off: ${activeSession.cutoffDate}). All counts are locked and Supervisor System Balance is unlocked.`,
      });
    } catch (err: any) {
      setFinalizeFeedback({
        type: 'error',
        text: err?.message || 'Could not close the counting session.',
      });
    } finally {
      setIsClosingSession(false);
    }
  };

  const handleOpenSingleRecount = async (loc: DetectedVarianceLocation) => {
    if (!currentUser) return;
    if (isSessionClosed) {
      setRecountFeedback({
        type: 'error',
        text: 'This counting session is closed and locked. New 2nd-count tasks cannot be opened.',
      });
      return;
    }
    setRecountFeedback(null);
    setBusyRecountId(loc.id);
    try {
      const selectedUserId = selectedAssigneeByLocId[loc.id] || '';
      const assignedCounter = selectedUserId
        ? managedUsers.find((u) => u.id === selectedUserId) || null
        : null;

      await openLocationRecountTask({
        storeId: loc.storeId,
        storeName: loc.storeName,
        location: loc.location,
        varianceSkus: loc.varianceSkus,
        counts: scopedCounts,
        openedBy: currentUser,
        assignedCounter,
        session: activeSession || undefined,
      });
      setRecountFeedback({
        type: 'success',
        text: assignedCounter
          ? `Opened 2nd Count at "${loc.location}" (${loc.storeName}) · Assigned to ${assignedCounter.displayName}.`
          : `Opened 2nd Count at "${loc.location}" (${loc.storeName}) for any eligible counter.`,
      });
    } catch (err: any) {
      setRecountFeedback({
        type: 'error',
        text: err?.message || 'Could not open 2nd count for this location.',
      });
    } finally {
      setBusyRecountId(null);
    }
  };

  const handleAssignRecountCounter = async (
    task: LocationRecountTask,
    assigneeId: string
  ) => {
    if (!currentUser) return;
    if (isSessionClosed) {
      setRecountFeedback({
        type: 'error',
        text: 'This counting session is closed and locked.',
      });
      return;
    }
    setRecountFeedback(null);
    setBusyRecountId(task.id);
    try {
      const assignedCounter = assigneeId
        ? managedUsers.find((u) => u.id === assigneeId) || null
        : null;

      await assignLocationRecountCounter({
        task,
        assignedCounter,
        supervisor: currentUser,
      });

      setDraftAssigneeByTaskId((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });

      setRecountFeedback({
        type: 'success',
        text: assignedCounter
          ? `Assigned "${task.location}" 2nd count to ${assignedCounter.displayName}.`
          : `Cleared counter assignment on "${task.location}" — open to any eligible counter.`,
      });
    } catch (err: any) {
      setRecountFeedback({
        type: 'error',
        text: err?.message || 'Could not update counter assignment.',
      });
    } finally {
      setBusyRecountId(null);
    }
  };

  const handleOpenAllVarianceLocations = async () => {
    if (!currentUser || unopenedVarianceLocations.length === 0) return;
    if (isSessionClosed) {
      setRecountFeedback({
        type: 'error',
        text: 'This counting session is closed and locked.',
      });
      return;
    }
    setRecountFeedback(null);
    setIsOpeningAllRecounts(true);
    let opened = 0;
    try {
      for (const loc of unopenedVarianceLocations) {
        await openLocationRecountTask({
          storeId: loc.storeId,
          storeName: loc.storeName,
          location: loc.location,
          varianceSkus: loc.varianceSkus,
          counts: scopedCounts,
          openedBy: currentUser,
          session: activeSession || undefined,
        });
        opened += 1;
      }
      setRecountFeedback({
        type: 'success',
        text: `Opened ${opened} location(s) for Blind 2nd Count. 1st-round counters are automatically excluded per location.`,
      });
    } catch (err: any) {
      setRecountFeedback({
        type: 'error',
        text: err?.message || 'Failed while opening variance locations.',
      });
    } finally {
      setIsOpeningAllRecounts(false);
    }
  };

  const handleReviewRecountTask = async (
    task: LocationRecountTask,
    decision: 'verified' | 'open'
  ) => {
    if (!currentUser) return;
    if (isSessionClosed) {
      setRecountFeedback({
        type: 'error',
        text: 'This counting session is closed and locked.',
      });
      return;
    }
    setRecountFeedback(null);
    setBusyRecountId(task.id);
    try {
      const notes = recountReviewNotesMap[task.id] || '';
      await reviewLocationRecountTask({
        task,
        decision,
        supervisor: currentUser,
        supervisorNotes: notes,
      });
      setRecountReviewNotesMap((prev) => ({ ...prev, [task.id]: '' }));
      setRecountFeedback({
        type: 'success',
        text:
          decision === 'verified'
            ? `Verified 2nd Count at "${task.location}". Recount quantities now supersede Round 1 in final reconciliation.`
            : `Re-opened "${task.location}" for another 2nd Count.`,
      });
    } catch (err: any) {
      setRecountFeedback({
        type: 'error',
        text: err?.message || 'Could not save 2nd count review decision.',
      });
    } finally {
      setBusyRecountId(null);
    }
  };

  // Export to Excel function using xlsx
  const handleExportToExcel = () => {
    setIsExporting(true);
    try {
      // 1. Format audit data for worksheet
      const rows = filteredSubmissions.map((c, index) => ({
        'No.': index + 1,
        'Count Mode': getCountTypeLabel(c.countType || activeSession?.countType),
        'Cut-Off Date': c.cutoffDate || activeSession?.cutoffDate || '—',
        'Round': (c.countRound ?? 1) === 2 ? '2nd Count' : '1st Count',
        'Username': c.username,
        'Store': c.store,
        'Store Code': c.storeId || '',
        'Location': c.location || '—',
        'SKU': c.sku,
        'Barcode': c.barcode || '',
        'Item Description': c.itemDescription || '',
        'Counted Quantity': Number(c.countedQuantity),
        'Classification': c.condition || 'Good',
        'Remarks': c.remarks || '',
        'Date': c.date,
        'Time': c.time,
        'Sync Status': c.syncStatus || 'synced',
      }));

      // 2. Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      // Set column widths for clean readability
      ws['!cols'] = [
        { wch: 6 },  // No.
        { wch: 22 }, // Count Mode
        { wch: 13 }, // Cut-Off Date
        { wch: 11 }, // Round
        { wch: 18 }, // Username
        { wch: 24 }, // Store
        { wch: 12 }, // Store Code
        { wch: 18 }, // Location
        { wch: 18 }, // SKU
        { wch: 16 }, // Barcode
        { wch: 32 }, // Item Description
        { wch: 16 }, // Counted Quantity
        { wch: 14 }, // Classification
        { wch: 25 }, // Remarks
        { wch: 14 }, // Date
        { wch: 12 }, // Time
        { wch: 12 }, // Sync Status
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Inventory Audit');

      // 3. Add summary sheet for management
      const summaryData = [
        { Metric: 'Report Title', Value: 'Retail Inventory Audit Export' },
        { Metric: 'Count Mode', Value: getCountTypeLabel(activeSession?.countType) },
        { Metric: 'Session', Value: activeSession?.title || 'Baseline' },
        { Metric: 'Cut-Off Date', Value: activeSession?.cutoffDate || '—' },
        { Metric: 'Generated Date', Value: new Date().toLocaleString() },
        { Metric: 'Total Submissions', Value: metrics.totalSubmissions },
        { Metric: 'Total Units Counted', Value: metrics.totalUnits },
        { Metric: 'Unique SKUs Counted', Value: metrics.uniqueSkus },
        { Metric: 'Active Counters', Value: metrics.activeCounters },
      ];
      const wsSummary = XLSX.utils.json_to_sheet(summaryData);
      wsSummary['!cols'] = [{ wch: 24 }, { wch: 32 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

      // 4. Download file
      const dateTag = new Date().toISOString().split('T')[0];
      const modeTag = getCountTypeShortLabel(activeSession?.countType);
      const filename = `${modeTag}_Inventory_Count_Report_${dateTag}.xlsx`;
      XLSX.writeFile(wb, filename);
    } catch (err) {
      console.error('Failed to export Excel file:', err);
      alert('Could not generate Excel file. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto pb-24 pt-2 px-3.5 space-y-4">
      {/* Top Banner with Export Button */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-xs font-bold uppercase tracking-wider ${
                isStoreSupervisor
                  ? 'text-amber-400'
                  : isOpsSupervisor
                  ? 'text-cyan-400'
                  : 'text-emerald-400'
              }`}
            >
              {isOpsSupervisor ? 'Operations Counter Supervision' : 'Supervisor Management'}
            </span>
            {activeSession && (
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${
                  activeSession.countType === 'cycle'
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'bg-indigo-500/20 text-indigo-300'
                }`}
              >
                {getCountTypeLabel(activeSession.countType)} · Cut-Off {activeSession.cutoffDate}
              </span>
            )}
            {isSessionClosed && (
              <span className="rounded-md bg-emerald-500/20 text-emerald-300 px-2 py-0.5 text-[10px] font-black uppercase">
                Session Closed
              </span>
            )}
            {isStoreSupervisor && (
              <span className="rounded-md bg-amber-500/20 text-amber-300 px-2 py-0.5 text-[10px] font-black uppercase">
                Assigned Store Scope
              </span>
            )}
            {isOpsSupervisor && (
              <span className="rounded-md bg-cyan-500/20 text-cyan-300 px-2 py-0.5 text-[10px] font-black uppercase">
                All Stores &amp; Counters
              </span>
            )}
          </div>
          <h2 className="text-lg font-black text-white mt-0.5">
            {isStoreSupervisor
              ? `${assignedStore?.name} (${assignedStore?.storeId})`
              : 'All Counter Submissions & Audit (All Branches)'}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {activeSession ? `${activeSession.title} · ` : ''}
            {isStoreSupervisor
              ? 'Store supervisors only have visibility into their designated store branch'
              : 'Isolated to the selected counting session and cut-off date'}
          </p>
        </div>

        {currentUser?.role === 'admin' ? (
          <button
            onClick={handleExportToExcel}
            disabled={isExporting || filteredSubmissions.length === 0}
            className="w-full sm:w-auto h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white shadow-lg active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isExporting ? 'Generating Excel...' : 'Export to Excel (.xlsx)'}</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-2 text-xs text-slate-400">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            <span>Count extraction restricted to Administrator</span>
          </div>
        )}
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 shadow-sm">
          <span className="text-[11px] font-medium text-slate-400 block">Total Units</span>
          <span className="text-2xl font-black text-emerald-400 font-mono tabular-nums block mt-1">
            {metrics.totalUnits.toLocaleString()}
          </span>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 shadow-sm">
          <span className="text-[11px] font-medium text-slate-400 block">Submissions</span>
          <span className="text-2xl font-black text-white font-mono tabular-nums block mt-1">
            {metrics.totalSubmissions.toLocaleString()}
          </span>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 shadow-sm">
          <span className="text-[11px] font-medium text-slate-400 block">Unique SKUs</span>
          <span className="text-2xl font-black text-white font-mono tabular-nums block mt-1">
            {metrics.uniqueSkus.toLocaleString()}
          </span>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 shadow-sm">
          <span className="text-[11px] font-medium text-slate-400 block">Active Counters</span>
          <span className="text-2xl font-black text-white font-mono tabular-nums block mt-1">
            {metrics.activeCounters}
          </span>
        </div>
      </div>

      {/* Filtering Bar */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 shadow-md space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* Store Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Store Scope
            </label>
            {isStoreSupervisor ? (
              <div className="w-full flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 font-semibold shadow-xs">
                <div className="flex items-center gap-1.5 truncate">
                  <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">{assignedStore?.name} ({assignedStore?.storeId})</span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 shrink-0 ml-1">
                  Assigned
                </span>
              </div>
            ) : (
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">All Retail Stores</option>
                {stores.map((s) => (
                  <option key={s.storeId} value={s.storeId}>
                    {s.name} ({s.storeId})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* User Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Filter by Counter
            </label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All Counter Users</option>
              {userList.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {/* Search Bar */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Search Text
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="SKU, description, store..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pl-8 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
            </div>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('verify_locations')}
            className={`rounded-lg px-3 py-1.5 font-medium transition flex items-center gap-1.5 ${
              activeTab === 'verify_locations'
                ? 'bg-emerald-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>Verify Locations ({locationVerificationGroups.length})</span>
            {pendingLocationCheckCount > 0 && (
              <span className="rounded-full bg-amber-400 text-slate-950 px-1.5 py-0.2 text-[10px] font-black">
                {pendingLocationCheckCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('second_count')}
            className={`rounded-lg px-3 py-1.5 font-medium transition flex items-center gap-1.5 ${
              activeTab === 'second_count'
                ? 'bg-amber-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>2nd Count / Variances ({scopedLocationRecounts.length})</span>
            {pendingRecountReviewCount + unopenedVarianceLocations.length > 0 && (
              <span className="rounded-full bg-amber-400 text-slate-950 px-1.5 py-0.2 text-[10px] font-black">
                {pendingRecountReviewCount + unopenedVarianceLocations.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              activeTab === 'all'
                ? 'bg-emerald-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            All Submissions ({filteredSubmissions.length})
          </button>
          <button
            onClick={() => setActiveTab('by_user')}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              activeTab === 'by_user'
                ? 'bg-emerald-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Counts by User ({userBreakdown.length})
          </button>
          <button
            onClick={() => setActiveTab('by_store')}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              activeTab === 'by_store'
                ? 'bg-emerald-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Counts by Store ({storeBreakdown.length})
          </button>
          <button
            onClick={() => setActiveTab('by_location')}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              activeTab === 'by_location'
                ? 'bg-emerald-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Counts by Location ({locationBreakdown.length})
          </button>
          <button
            onClick={() => setActiveTab('location_tags')}
            className={`rounded-lg px-3 py-1.5 font-medium transition flex items-center gap-1.5 ${
              activeTab === 'location_tags'
                ? 'bg-teal-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>
              Location Tags (
              {
                locationTags.filter((t) => {
                  if (isStoreSupervisor && assignedStore && t.storeId !== assignedStore.storeId)
                    return false;
                  if (!isStoreSupervisor && selectedStore !== 'all' && t.storeId !== selectedStore)
                    return false;
                  return t.status === 'approved';
                }).length
              }
              )
            </span>
          </button>
          <button
            onClick={() => setActiveTab('system_balance')}
            className={`rounded-lg px-3 py-1.5 font-medium transition flex items-center gap-1.5 ${
              activeTab === 'system_balance'
                ? 'bg-indigo-600 text-white font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {isScopeSystemBalanceUnlocked ? (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>System Balance</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB: VERIFY LOCATIONS (SUPERVISOR CHECK PER LOCATION) */}
      {/* ========================================================================= */}
      {activeTab === 'verify_locations' && (
        <div className="space-y-3">
          {/* Status Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-900 border border-slate-800 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: `All (${locationVerificationGroups.length})` },
                  { id: 'pending_verification', label: `Pending Check (${pendingLocationCheckCount})` },
                  {
                    id: 'recount_needed',
                    label: `Recount Needed (${locationVerificationGroups.filter((g) => g.effectiveStatus === 'recount_needed').length})`,
                  },
                  {
                    id: 'verified',
                    label: `Done Counting (${locationVerificationGroups.filter((g) => g.effectiveStatus === 'verified').length})`,
                  },
                  {
                    id: 'in_progress',
                    label: `In Progress (${locationVerificationGroups.filter((g) => g.effectiveStatus === 'in_progress').length})`,
                  },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setVerificationStatusFilter(pill.id)}
                  className={`rounded-lg px-2.5 py-1.5 font-semibold transition ${
                    verificationStatusFilter === pill.id
                      ? 'bg-amber-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>

          {verifyFeedback && (
            <div
              className={`rounded-xl border p-3 text-xs font-semibold flex items-center justify-between gap-2 ${
                verifyFeedback.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {verifyFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{verifyFeedback.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setVerifyFeedback(null)}
                className="text-slate-400 hover:text-white text-[11px] underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {visibleVerificationGroups.length === 0 ? (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center space-y-1.5">
              <ClipboardCheck className="w-9 h-9 text-slate-600 mx-auto" />
              <div className="text-sm font-bold text-slate-300">No locations match this filter</div>
              <p className="text-xs text-slate-500">
                When counters finish counting a location and tap "Done Location", it appears here for supervisor verification.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleVerificationGroups.map((group) => {
                const isExpanded =
                  expandedLocations[group.key] ?? group.effectiveStatus === 'pending_verification';
                const checkedCount = group.items.filter((i) => checkedLineItems[i.id]).length;
                const isSelfSubmitted =
                  Boolean(currentUser?.uid) && group.verification?.submittedById === currentUser?.uid;
                const isSubmittingThis = reviewingLocationKey === group.key;

                return (
                  <div
                    key={group.key}
                    className={`rounded-2xl bg-slate-900 border p-4 shadow-md space-y-3 ${
                      group.effectiveStatus === 'pending_verification'
                        ? 'border-amber-500/50'
                        : group.effectiveStatus === 'recount_needed'
                        ? 'border-rose-500/40'
                        : group.effectiveStatus === 'verified'
                        ? 'border-emerald-500/40'
                        : 'border-slate-800'
                    }`}
                  >
                    {/* Location Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                            group.effectiveStatus === 'pending_verification'
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                              : group.effectiveStatus === 'verified'
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                              : group.effectiveStatus === 'recount_needed'
                              ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                              : 'bg-slate-800 border-slate-700 text-slate-300'
                          }`}
                        >
                          <MapPin className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-black text-white font-mono">
                              {group.location}
                            </h4>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase border ${
                                group.effectiveStatus === 'pending_verification'
                                  ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                                  : group.effectiveStatus === 'verified'
                                  ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                                  : group.effectiveStatus === 'recount_needed'
                                  ? 'bg-rose-500/20 border-rose-500/30 text-rose-300'
                                  : 'bg-slate-800 border-slate-700 text-slate-300'
                              }`}
                            >
                              {group.effectiveStatus === 'pending_verification'
                                ? 'Pending Check'
                                : group.effectiveStatus === 'verified'
                                ? 'Verified · Done Counting'
                                : group.effectiveStatus === 'recount_needed'
                                ? 'Recount Needed'
                                : 'Counting in Progress'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                            <span className="text-slate-300 font-semibold">
                              {group.storeName} ({group.storeId})
                            </span>
                            <span>·</span>
                            <span>
                              Counters: {Array.from(group.counters).join(', ') || '—'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Location Metrics Summary */}
                      <div className="flex items-center gap-2 text-xs">
                        <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-center">
                          <span className="text-[10px] text-slate-500 block">Items</span>
                          <span className="font-mono font-bold text-white">{group.items.length}</span>
                        </div>
                        <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-center">
                          <span className="text-[10px] text-slate-500 block">SKUs</span>
                          <span className="font-mono font-bold text-white">{group.uniqueSkus.size}</span>
                        </div>
                        <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-center">
                          <span className="text-[10px] text-slate-500 block">Total Units</span>
                          <span className="font-mono font-black text-emerald-400">
                            {group.totalUnits.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Submission / Verification Metadata */}
                    {group.verification && (
                      <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-2 text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                          <span>
                            Submitted by <strong className="text-white">{group.verification.submittedByName}</strong>
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {group.verification.submittedDate} {group.verification.submittedTime}
                          </span>
                        </div>
                        {group.verification.counterNotes && (
                          <p className="text-[11px] text-slate-400">
                            Counter note: <span className="text-slate-200">{group.verification.counterNotes}</span>
                          </p>
                        )}
                        {group.verification.verifiedByName && (
                          <div className="pt-1 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                            <span
                              className={
                                group.verification.status === 'verified'
                                  ? 'text-emerald-300 font-semibold'
                                  : 'text-rose-300 font-semibold'
                              }
                            >
                              {group.verification.status === 'verified'
                                ? 'Verified (Tagged Done Counting)'
                                : 'Recount Flagged'}{' '}
                              by {group.verification.verifiedByName}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono">
                              {group.verification.verifiedDate} {group.verification.verifiedTime}
                            </span>
                          </div>
                        )}
                        {group.verification.supervisorNotes && (
                          <p className="text-[11px] text-amber-200/90">
                            Supervisor note: {group.verification.supervisorNotes}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Expand / Collapse Physical Item Checklist */}
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedLocations((prev) => ({ ...prev, [group.key]: !isExpanded }))
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                        <span>
                          {isExpanded ? 'Hide Item Checklist' : `Inspect Counted Items (${group.items.length})`}
                        </span>
                      </button>

                      {group.items.length > 0 && (
                        <span className="text-[11px] text-slate-400 font-mono">
                          Checked: <strong className="text-white">{checkedCount}/{group.items.length}</strong> · Good:{' '}
                          <span className="text-emerald-400">{group.goodUnits}</span> / Damage:{' '}
                          <span className="text-rose-400">{group.damageUnits}</span>
                        </span>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
                        {group.items.length === 0 ? (
                          <div className="p-4 text-xs text-slate-400 text-center">
                            No active count records currently in this location.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
                            {group.items.map((item) => {
                              const isChecked = Boolean(checkedLineItems[item.id]);
                              return (
                                <div
                                  key={item.id}
                                  onClick={() => handleToggleItemCheck(item.id)}
                                  className={`px-3 py-2.5 flex items-center justify-between gap-2.5 text-xs cursor-pointer transition ${
                                    isChecked ? 'bg-emerald-950/25' : 'hover:bg-slate-900/70'
                                  }`}
                                >
                                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleItemCheck(item.id);
                                      }}
                                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                                        isChecked
                                          ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                                          : 'bg-slate-900 border-slate-700 text-transparent hover:border-emerald-500'
                                      }`}
                                      aria-label="Mark item checked"
                                    >
                                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                                    </button>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-mono font-bold text-emerald-400">
                                          {item.sku}
                                        </span>
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
                                      <p className="text-[11px] text-slate-300 truncate">
                                        {item.itemDescription || '—'}
                                      </p>
                                      <p className="text-[10px] text-slate-500">
                                        Counter: {item.username} · {item.date} {item.time}
                                        {item.remarks ? ` · Note: ${item.remarks}` : ''}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className="font-mono font-black text-white text-sm">
                                      {item.countedQuantity}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Supervisor Verify / Recount Action Bar */}
                    {(isStoreSupervisor || isOpsSupervisor) && (
                      <div className="pt-2 border-t border-slate-800 space-y-2">
                        {isSelfSubmitted ? (
                          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-300 font-semibold flex items-center gap-2">
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                            <span>You submitted this location check — another supervisor must verify it.</span>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <input
                              type="text"
                              value={reviewNotesMap[group.key] || ''}
                              onChange={(e) =>
                                setReviewNotesMap((prev) => ({
                                  ...prev,
                                  [group.key]: e.target.value,
                                }))
                              }
                              placeholder="Verification note (required if flagging recount)..."
                              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                            />
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={isSubmittingThis}
                                onClick={() => handleSupervisorReviewLocation(group, 'recount_needed')}
                                className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-xs font-bold text-rose-300 transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Flag Recount</span>
                              </button>
                              <button
                                type="button"
                                disabled={isSubmittingThis}
                                onClick={() => handleSupervisorReviewLocation(group, 'verified')}
                                className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>
                                  {isSubmittingThis
                                    ? 'Saving...'
                                    : group.effectiveStatus === 'verified'
                                    ? 'Re-Verify'
                                    : 'Verify Location'}
                                </span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB: SECOND COUNT / VARIANCES (PER-LOCATION SEGREGATION & REVIEW) */}
      {/* ========================================================================= */}
      {activeTab === 'second_count' && (
        <div className="space-y-4">
          {recountFeedback && (
            <div
              className={`rounded-xl border p-3 text-xs font-semibold flex items-center justify-between gap-2 ${
                recountFeedback.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {recountFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{recountFeedback.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setRecountFeedback(null)}
                className="text-slate-400 hover:text-white text-[11px] underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Section 1: Auto-Detected Locations with SKU Variances */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-md space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Detected Locations with SKU Variances ({unopenedVarianceLocations.length} pending open)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Auto-detected by comparing 1st-round counts against Masterlist system stock. Opening a location blocks its 1st-round counters from performing its 2nd count.
                </p>
              </div>
              {canManageRecounts && unopenedVarianceLocations.length > 0 && (
                <button
                  type="button"
                  onClick={handleOpenAllVarianceLocations}
                  disabled={isOpeningAllRecounts}
                  className="shrink-0 h-10 px-3.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow active:scale-95 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>
                    {isOpeningAllRecounts
                      ? 'Opening All...'
                      : `Open All (${unopenedVarianceLocations.length})`}
                  </span>
                </button>
              )}
            </div>

            {unopenedVarianceLocations.length === 0 ? (
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 text-center text-xs text-slate-400">
                {detectedVarianceLocations.length === 0
                  ? 'No SKU variances detected against Masterlist system stock in this scope.'
                  : 'All detected variance locations have already been opened for 2nd count below.'}
              </div>
            ) : (
              <div className="space-y-2.5">
                {unopenedVarianceLocations.map((loc) => {
                  const { eligibleCounters } = getEligibleCountersForLocationRecount({
                    storeId: loc.storeId,
                    location: loc.location,
                    counts: scopedCounts,
                    managedUsers,
                  });
                  const selectedUserId = selectedAssigneeByLocId[loc.id] || '';

                  return (
                    <div
                      key={loc.id}
                      className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-bold text-white">{loc.location}</span>
                            <span className="text-[11px] text-slate-400">
                              {loc.storeName} ({loc.storeId})
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 tabular-nums">
                            {loc.varianceSkus.length} variance SKU{loc.varianceSkus.length === 1 ? '' : 's'} flagged ·{' '}
                            {isStoreFinalized(loc.storeId) ? (
                              <>
                                {loc.totalVarianceUnits.toLocaleString()} variance units ·{' '}
                              </>
                            ) : (
                              <span className="text-slate-400">
                                System balance &amp; variance locked until finalized ·{' '}
                              </span>
                            )}
                            <span className="text-rose-300">
                              1st-round excluded: {loc.excludedCounterNames.join(', ') || 'None'}
                            </span>
                          </p>
                        </div>

                        {canManageRecounts && (
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                            <select
                              value={selectedUserId}
                              onChange={(e) =>
                                setSelectedAssigneeByLocId((prev) => ({
                                  ...prev,
                                  [loc.id]: e.target.value,
                                }))
                              }
                              aria-label={`Assign counter for ${loc.location}`}
                              className="rounded-xl border border-slate-700 bg-slate-900 px-3 min-h-[44px] text-xs text-white focus:border-cyan-400 focus:outline-none"
                            >
                              <option value="">Any Eligible Counter (Open Pool)</option>
                              {eligibleCounters.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.displayName} ({u.role === 'ops_counter' ? 'Ops Counter' : 'Store Counter'})
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleOpenSingleRecount(loc)}
                              disabled={busyRecountId === loc.id}
                              className="shrink-0 min-h-[44px] px-3.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/35 border border-amber-500/40 text-xs font-bold text-amber-300 transition active:scale-95 disabled:opacity-50"
                            >
                              {busyRecountId === loc.id ? 'Opening...' : 'Open 2nd Count'}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Eligible Counters Preview Strip */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/80 text-[11px]">
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-300 mr-1">
                          <Users className="w-3.5 h-3.5" />
                          Eligible Counters ({eligibleCounters.length}):
                        </span>
                        {eligibleCounters.length === 0 ? (
                          <span className="text-rose-300">
                            No eligible counters available for {loc.storeName} (all store/ops counters touched Round 1).
                          </span>
                        ) : (
                          eligibleCounters.map((u) => {
                            const isPicked = selectedUserId === u.id;
                            return (
                              <button
                                key={u.id}
                                type="button"
                                disabled={!canManageRecounts}
                                onClick={() =>
                                  setSelectedAssigneeByLocId((prev) => ({
                                    ...prev,
                                    [loc.id]: isPicked ? '' : u.id,
                                  }))
                                }
                                className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold border transition ${
                                  isPicked
                                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:border-emerald-400'
                                }`}
                              >
                                {isPicked && <Check className="w-3 h-3" />}
                                <span>{u.displayName}</span>
                                <span className="text-[10px] opacity-75">
                                  · {u.role === 'ops_counter' ? 'Ops' : 'Store'}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Active, Submitted & Verified Second Count Tasks */}
          <div className="space-y-3">
            {scopedLocationRecounts.length === 0 ? (
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center space-y-1.5">
                <RefreshCw className="w-8 h-8 text-slate-600 mx-auto" />
                <div className="text-sm font-bold text-slate-300">No 2nd-count tasks opened yet</div>
                <p className="text-xs text-slate-500">
                  Open any variance location above to assign a blind 2nd count to eligible associates.
                </p>
              </div>
            ) : (
              scopedLocationRecounts.map((task) => {
                const isSelfSubmitted =
                  Boolean(currentUser?.uid) && task.submittedById === currentUser?.uid;
                const isBusy = busyRecountId === task.id;
                const locLower = task.location.trim().toLowerCase();
                const storeLower = task.storeId.trim().toLowerCase();

                const { eligibleCounters } = getEligibleCountersForLocationRecount({
                  storeId: task.storeId,
                  location: task.location,
                  counts: scopedCounts,
                  managedUsers,
                  task,
                });
                const currentAssignedId = task.assignedCounterId || '';
                const draftAssigneeId =
                  draftAssigneeByTaskId[task.id] !== undefined
                    ? draftAssigneeByTaskId[task.id]
                    : currentAssignedId;
                const hasAssignmentChanged = draftAssigneeId !== currentAssignedId;

                return (
                  <div
                    key={task.id}
                    className={`rounded-2xl bg-slate-900 border p-4 shadow-md space-y-3 ${
                      task.status === 'pending_review'
                        ? 'border-amber-500/50'
                        : task.status === 'verified'
                        ? 'border-emerald-500/40'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-black text-white font-mono">{task.location}</h4>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase border ${
                              task.status === 'pending_review'
                                ? 'bg-amber-500/20 border-amber-500/35 text-amber-300'
                                : task.status === 'verified'
                                ? 'bg-emerald-500/20 border-emerald-500/35 text-emerald-300'
                                : 'bg-slate-800 border-slate-700 text-slate-300'
                            }`}
                          >
                            {task.status === 'pending_review'
                              ? 'Pending Supervisor Review'
                              : task.status === 'verified'
                              ? 'Verified · 2nd Count Final'
                              : 'Open for 2nd Count'}
                          </span>
                          {task.assignedCounterId && task.assignedCounterName ? (
                            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold bg-cyan-500/15 border border-cyan-500/35 text-cyan-300">
                              <UserCheck className="w-3 h-3" />
                              Assigned: {task.assignedCounterName}
                            </span>
                          ) : (
                            <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold bg-slate-950 border border-slate-700 text-slate-300">
                              Open Pool · Any Eligible Counter
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          {task.storeName} ({task.storeId}) · Excluded 1st-round:{' '}
                          <span className="text-rose-300">
                            {task.excludedCounterNames.join(', ') || 'None'}
                          </span>
                          {task.assignedByName && task.assignedCounterName ? (
                            <>
                              {' '}
                              · Assigned by <span className="text-cyan-300">{task.assignedByName}</span>
                            </>
                          ) : null}
                          {task.submittedByName ? (
                            <>
                              {' '}
                              · 2nd Count by <strong className="text-white">{task.submittedByName}</strong>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono shrink-0">
                        Opened {task.openedDate} {task.openedTime}
                      </span>
                    </div>

                    {/* Eligible Counters & Supervisor Ops Assignment Control */}
                    <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-200 flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Eligible Counters for {task.location} ({eligibleCounters.length})</span>
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {task.status === 'open'
                            ? 'Supervisor Ops can assign one counter or leave open to any eligible counter'
                            : 'Eligible pool preserved for audit reference'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {eligibleCounters.length === 0 ? (
                          <span className="text-[11px] text-rose-300">
                            No active eligible counters found for {task.storeName}.
                          </span>
                        ) : (
                          eligibleCounters.map((u) => {
                            const isAssignedHere = task.assignedCounterId === u.id;
                            const isDraftPicked = draftAssigneeId === u.id;
                            return (
                              <button
                                key={u.id}
                                type="button"
                                disabled={!canManageRecounts || task.status !== 'open'}
                                onClick={() =>
                                  setDraftAssigneeByTaskId((prev) => ({
                                    ...prev,
                                    [task.id]: isDraftPicked ? '' : u.id,
                                  }))
                                }
                                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition ${
                                  isAssignedHere
                                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                                    : isDraftPicked
                                    ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                                    : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300 hover:border-emerald-400 disabled:hover:border-emerald-500/25'
                                }`}
                              >
                                {isAssignedHere && <UserCheck className="w-3 h-3 text-cyan-300" />}
                                <span>{u.displayName}</span>
                                <span className="text-[10px] opacity-75">
                                  · {u.role === 'ops_counter' ? 'Ops' : 'Store'}
                                </span>
                                {isAssignedHere && (
                                  <span className="text-[10px] font-black uppercase text-cyan-300">
                                    · Assigned
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>

                      {canManageRecounts && task.status === 'open' && (
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-slate-800/80">
                          <select
                            value={draftAssigneeId}
                            onChange={(e) =>
                              setDraftAssigneeByTaskId((prev) => ({
                                ...prev,
                                [task.id]: e.target.value,
                              }))
                            }
                            aria-label={`Select counter for ${task.location}`}
                            className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 min-h-[44px] text-xs text-white focus:border-cyan-400 focus:outline-none"
                          >
                            <option value="">Any Eligible Counter (Open Pool)</option>
                            {eligibleCounters.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.displayName} ({u.role === 'ops_counter' ? 'Ops Counter' : 'Store Counter'})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={isBusy || !hasAssignmentChanged}
                            onClick={() => handleAssignRecountCounter(task, draftAssigneeId)}
                            className="shrink-0 min-h-[44px] px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white shadow transition active:scale-95 disabled:opacity-40 flex items-center justify-center gap-1.5"
                          >
                            <UserCheck className="w-4 h-4" />
                            <span>
                              {isBusy
                                ? 'Saving...'
                                : draftAssigneeId
                                ? currentAssignedId
                                  ? 'Reassign Counter'
                                  : 'Assign Counter'
                                : 'Open to Any Eligible'}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Side-by-side comparison: System Stock & Variance stay locked until 2nd counting is done and counting is finalized */}
                    {(() => {
                      const taskStoreFinalized = isStoreFinalized(task.storeId);
                      return (
                        <div className="space-y-2">
                          {!taskStoreFinalized && (
                            <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-[11px] text-slate-300 flex items-center gap-2">
                              <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <span>
                                Blind review mode: System balance and variance remain hidden until 2nd counting is done and counting for {task.storeName} is finalized.
                              </span>
                            </div>
                          )}
                          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                                <tr>
                                  <th className="py-2.5 px-3">SKU / Description</th>
                                  <th className="py-2.5 px-3 text-right">System</th>
                                  <th className="py-2.5 px-3 text-right">1st Count</th>
                                  <th className="py-2.5 px-3 text-right">2nd Count</th>
                                  <th className="py-2.5 px-3 text-right">Remaining Var.</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/80 text-slate-200 font-mono tabular-nums">
                                {task.varianceSkus.map((v) => {
                                  const r2Key = `${storeLower}::${locLower}::${v.sku.trim().toLowerCase()}`;
                                  const r2Qty = round2QtyLookup.get(r2Key);
                                  const hasR2 = r2Qty !== undefined;
                                  const effectiveQty = hasR2 ? r2Qty : v.firstCountQty;
                                  const remainingVar = effectiveQty - v.systemStock;

                                  return (
                                    <tr key={v.sku} className="hover:bg-slate-900/60">
                                      <td className="py-2 px-3">
                                        <span className="font-bold text-amber-300 block">{v.sku}</span>
                                        <span className="font-sans text-[11px] text-slate-400 truncate max-w-[220px] block">
                                          {v.description}
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 text-right text-slate-400">
                                        {taskStoreFinalized ? (
                                          v.systemStock
                                        ) : (
                                          <span className="inline-flex items-center justify-end gap-1 font-sans text-[11px] text-slate-500">
                                            <Lock className="w-3 h-3" />
                                            Locked
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-2 px-3 text-right text-slate-300">
                                        {v.firstCountQty}
                                      </td>
                                      <td className="py-2 px-3 text-right font-bold text-white">
                                        {hasR2 ? r2Qty : '—'}
                                      </td>
                                      <td
                                        className={`py-2 px-3 text-right font-bold ${
                                          !taskStoreFinalized
                                            ? 'text-slate-500 font-sans text-[11px] font-medium'
                                            : remainingVar === 0
                                            ? 'text-emerald-400'
                                            : remainingVar > 0
                                            ? 'text-blue-400'
                                            : 'text-rose-400'
                                        }`}
                                      >
                                        {!taskStoreFinalized
                                          ? 'Until Finalized'
                                          : remainingVar > 0
                                          ? `+${remainingVar}`
                                          : remainingVar}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}

                    {(task.counterNotes || task.supervisorNotes) && (
                      <div className="rounded-xl bg-slate-950/70 border border-slate-800 px-3 py-2 text-[11px] space-y-0.5 text-slate-300">
                        {task.counterNotes && (
                          <p>
                            Counter note: <span className="text-white">{task.counterNotes}</span>
                          </p>
                        )}
                        {task.supervisorNotes && (
                          <p className="text-amber-200/90">
                            Supervisor note: {task.supervisorNotes}
                          </p>
                        )}
                      </div>
                    )}

                    {canManageRecounts && task.status === 'pending_review' && (
                      <div className="pt-2 border-t border-slate-800 space-y-2">
                        {isSelfSubmitted ? (
                          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-300 font-semibold flex items-center gap-2">
                            <Lock className="w-3.5 h-3.5 shrink-0" />
                            <span>You submitted this 2nd count — another supervisor must verify it.</span>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <input
                              type="text"
                              value={recountReviewNotesMap[task.id] || ''}
                              onChange={(e) =>
                                setRecountReviewNotesMap((prev) => ({
                                  ...prev,
                                  [task.id]: e.target.value,
                                }))
                              }
                              placeholder="Review note (required if re-opening for recount)..."
                              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                            />
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleReviewRecountTask(task, 'open')}
                                className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-xs font-bold text-rose-300 transition active:scale-95 disabled:opacity-50"
                              >
                                Re-open Recount
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleReviewRecountTask(task, 'verified')}
                                className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>{isBusy ? 'Saving...' : 'Verify & Finalize'}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Content depending on active tab */}
      {activeTab === 'all' && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3.5">SKU / Item</th>
                  <th className="py-3 px-3">Round</th>
                  <th className="py-3 px-3">Location</th>
                  <th className="py-3 px-3">Counter</th>
                  <th className="py-3 px-3">Store</th>
                  <th className="py-3 px-3 text-right">Qty</th>
                  <th className="py-3 px-3">Condition</th>
                  <th className="py-3 px-3">Date / Time</th>
                  <th className="py-3 px-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-200">
                {filteredSubmissions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      No inventory counts match the selected criteria.
                    </td>
                  </tr>
                ) : (
                  filteredSubmissions.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-800/50 transition">
                      <td className="py-3 px-3.5">
                        <span className="font-mono font-bold text-emerald-400 block">{c.sku}</span>
                        <span className="text-slate-400 text-[11px] truncate max-w-[200px] block">
                          {c.itemDescription || '—'}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`text-[11px] font-bold ${
                            (c.countRound ?? 1) === 2 ? 'text-amber-300' : 'text-slate-400'
                          }`}
                        >
                          {(c.countRound ?? 1) === 2 ? '2nd Count' : '1st Count'}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-mono text-emerald-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 text-[11px]">
                          <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                          {c.location || '—'}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-medium text-white">{c.username}</td>
                      <td className="py-3 px-3 whitespace-nowrap text-slate-300">{c.store}</td>
                      <td className="py-3 px-3 text-right font-mono font-black text-white text-sm tabular-nums">
                        {c.countedQuantity}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase border ${
                            c.condition === 'Damage'
                              ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                          }`}
                        >
                          {c.condition || 'Good'}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-slate-400 text-[11px]">
                        {c.date} <span className="text-slate-500">{c.time}</span>
                      </td>
                      <td className="py-3 px-3 text-slate-400 text-[11px] max-w-[150px] truncate">
                        {c.remarks || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'by_user' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {userBreakdown.map((u) => (
            <div
              key={u.username}
              className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600/20 text-emerald-400 font-bold text-sm">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{u.username}</h4>
                    <span className="text-[11px] text-slate-400">Counter Staff</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Units</span>
                  <span className="text-lg font-black text-emerald-400 font-mono tabular-nums">
                    {u.totalUnits.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
                <span>Submissions: <strong className="text-white font-mono">{u.countRecords}</strong></span>
                <span>Last count: {u.lastActive}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'by_store' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {storeBreakdown.map((st) => (
            <div
              key={st.store}
              className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-emerald-400" />
                  <h4 className="text-sm font-bold text-white">{st.store}</h4>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Units</span>
                  <span className="text-lg font-black text-emerald-400 font-mono tabular-nums">
                    {st.totalUnits.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
                <span>Counts recorded: <strong className="text-white font-mono">{st.countRecords}</strong></span>
                <span>Unique SKUs: <strong className="text-white font-mono">{st.uniqueSkusCount}</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'by_location' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {locationBreakdown.map((loc) => {
            const matchingGroup = locationVerificationGroups.find(
              (g) => g.location.trim().toLowerCase() === loc.location.trim().toLowerCase()
            );
            const locStatus = matchingGroup?.effectiveStatus || 'in_progress';

            return (
              <div
                key={loc.location}
                className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600/20 text-emerald-400">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-white font-mono truncate">{loc.location}</h4>
                      <span
                        className={`inline-block mt-0.5 rounded px-1.5 py-0.5 text-[9px] font-black uppercase border ${
                          locStatus === 'verified'
                            ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                            : locStatus === 'pending_verification'
                            ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                            : locStatus === 'recount_needed'
                            ? 'bg-rose-500/20 border-rose-500/30 text-rose-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                      >
                        {locStatus === 'verified'
                          ? 'Done Counting'
                          : locStatus === 'pending_verification'
                          ? 'Pending Check'
                          : locStatus === 'recount_needed'
                          ? 'Recount Needed'
                          : 'Counting'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Units</span>
                    <span className="text-lg font-black text-emerald-400 font-mono tabular-nums">
                      {loc.totalUnits.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
                  <span>Items counted: <strong className="text-white font-mono">{loc.countRecords}</strong></span>
                  <span>Unique SKUs: <strong className="text-white font-mono">{loc.uniqueSkusCount}</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'location_tags' && (
        <div className="space-y-4">
          {/* Request New Location Form */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-teal-400" />
                <h3 className="text-sm font-bold text-white">
                  Request New Location Tag (Admin Approval Required)
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Standard location tags are managed by Admin. Need a new shelf, bay, or promotional display added? Submit it here for Admin approval.
              </p>
            </div>

            {tagRequestFeedback && (
              <div
                className={`rounded-xl border p-3 text-xs font-medium flex items-center gap-2 ${
                  tagRequestFeedback.type === 'success'
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                }`}
              >
                {tagRequestFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{tagRequestFeedback.text}</span>
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!currentUser) return;
                setTagRequestFeedback(null);
                const resolvedStore = isStoreSupervisor
                  ? assignedStore
                  : stores.find((s) => s.storeId === tagRequestStoreId) || stores[0];
                if (!resolvedStore) {
                  setTagRequestFeedback({ type: 'error', text: 'Select a valid store.' });
                  return;
                }
                setIsSubmittingTagRequest(true);
                try {
                  const created = await requestLocationTag({
                    store: resolvedStore,
                    name: tagRequestName,
                    zone: tagRequestZone,
                    notes: tagRequestNotes,
                    requester: currentUser,
                    existingTags: locationTags,
                  });
                  setTagRequestName('');
                  setTagRequestZone('');
                  setTagRequestNotes('');
                  setTagRequestFeedback({
                    type: 'success',
                    text: `Submitted "${created.name}" (${resolvedStore.name}) to Admin for approval.`,
                  });
                } catch (err: any) {
                  setTagRequestFeedback({
                    type: 'error',
                    text: err?.message || 'Failed to submit location tag request.',
                  });
                } finally {
                  setIsSubmittingTagRequest(false);
                }
              }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              {!isStoreSupervisor && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Store Branch
                  </label>
                  <select
                    value={tagRequestStoreId}
                    onChange={(e) => setTagRequestStoreId(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 min-h-[44px] text-xs text-white focus:border-teal-400 focus:outline-none"
                  >
                    {stores.map((s) => (
                      <option key={s.storeId} value={s.storeId}>
                        {s.name} ({s.storeId})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Location Tag Name <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  value={tagRequestName}
                  onChange={(e) => setTagRequestName(e.target.value)}
                  placeholder="e.g. Aisle 4 - Endcap B"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 min-h-[44px] text-xs font-mono text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Zone / Department (Optional)
                </label>
                <input
                  type="text"
                  value={tagRequestZone}
                  onChange={(e) => setTagRequestZone(e.target.value)}
                  placeholder="e.g. Seasonal, Beverages"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 min-h-[44px] text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                />
              </div>

              <div className={!isStoreSupervisor ? '' : 'sm:col-span-2'}>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Reason / Notes for Admin (Optional)
                </label>
                <input
                  type="text"
                  value={tagRequestNotes}
                  onChange={(e) => setTagRequestNotes(e.target.value)}
                  placeholder="e.g. Added new overflow pallet rack"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 min-h-[44px] text-xs text-white placeholder-slate-500 focus:border-teal-400 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isSubmittingTagRequest || !tagRequestName.trim()}
                  className="min-h-[44px] px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow active:scale-95 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isSubmittingTagRequest ? 'Submitting...' : 'Submit for Admin Approval'}
                  </span>
                </button>
              </div>
            </form>
          </div>

          {/* Scoped Location Tags List */}
          {(() => {
            const scopedTags = locationTags
              .filter((t) => {
                if (isStoreSupervisor && assignedStore && t.storeId !== assignedStore.storeId) {
                  return false;
                }
                if (!isStoreSupervisor && selectedStore !== 'all' && t.storeId !== selectedStore) {
                  return false;
                }
                return true;
              })
              .sort((a, b) => {
                const rank = { pending_approval: 0, approved: 1, rejected: 2 };
                const d = rank[a.status] - rank[b.status];
                if (d !== 0) return d;
                return a.name.localeCompare(b.name);
              });

            if (scopedTags.length === 0) {
              return (
                <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center space-y-1">
                  <MapPin className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-sm font-bold text-slate-300">No location tags yet</p>
                  <p className="text-xs text-slate-500">
                    Admin-approved clickable location tags and your supervisor requests will appear here.
                  </p>
                </div>
              );
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {scopedTags.map((tag) => (
                  <div
                    key={tag.id}
                    className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-white truncate">
                        {tag.name}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase border shrink-0 ${
                          tag.status === 'approved'
                            ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                            : tag.status === 'pending_approval'
                            ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                            : 'bg-rose-500/20 border-rose-500/30 text-rose-300'
                        }`}
                      >
                        {tag.status === 'approved'
                          ? 'Approved'
                          : tag.status === 'pending_approval'
                          ? 'Pending Admin'
                          : 'Rejected'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {[
                        `${tag.storeName} (${tag.storeId})`,
                        tag.zone ? `Zone: ${tag.zone}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Added by {tag.createdByName}
                      {tag.approvedByName && tag.createdByRole !== 'admin'
                        ? ` · Reviewed by ${tag.approvedByName}`
                        : ''}
                    </div>
                    {tag.rejectionReason && (
                      <div className="text-[11px] text-rose-300 pt-0.5">
                        Rejection reason: {tag.rejectionReason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
      {activeTab === 'system_balance' && (
        <div className="space-y-4">
          {finalizeFeedback && (
            <div
              className={`rounded-xl border p-3 text-xs font-semibold flex items-center justify-between gap-2 ${
                finalizeFeedback.type === 'success'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {finalizeFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{finalizeFeedback.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setFinalizeFeedback(null)}
                className="text-slate-400 hover:text-white text-[11px] underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Finalization Readiness & Unlock Controls */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  {isScopeSystemBalanceUnlocked ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Lock className="w-4 h-4 text-amber-400" />
                  )}
                  <span>
                    {isSessionClosed
                      ? 'Counting Session Closed & System Balance Unlocked'
                      : isScopeSystemBalanceUnlocked
                      ? 'System Balance Unlocked (Counting Finalized)'
                      : 'System Balance Locked Until Counting Is Finalized'}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Supervisors cannot view Masterlist system balances until Round 1 verification and all 2nd counts are completed and counting is finalized for this {activeSession ? `${getCountTypeLabel(activeSession.countType)} (Cut-Off ${activeSession.cutoffDate})` : 'session'}.
                </p>
              </div>

              {activeSession && (
                <div className="shrink-0">
                  {activeSession.status === 'closed' ? (
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 px-3 py-2 text-xs font-bold text-emerald-300 whitespace-nowrap">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Session Closed · Locked</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        isClosingSession ||
                        storeReadinessList.length === 0 ||
                        !storeReadinessList.some((r) => r.isFinalized || r.canFinalize) ||
                        storeReadinessList.some((r) => r.activeCountRecords > 0 && !r.isFinalized)
                      }
                      onClick={handleCloseCountingSession}
                      className="min-h-[44px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow transition active:scale-95 disabled:opacity-40 flex items-center justify-center gap-1.5 whitespace-nowrap"
                      title="Close & finalize the entire session after all counted stores are finalized"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>
                        {isClosingSession
                          ? 'Closing Session...'
                          : `Close & Finalize ${getCountTypeShortLabel(activeSession.countType)} Session`}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              {storeReadinessList.map((r) => (
                <div
                  key={r.storeId}
                  className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">
                          {r.storeName} ({r.storeId})
                        </span>
                        <span
                          className={`text-[11px] font-bold ${
                            r.isFinalized
                              ? 'text-emerald-400'
                              : r.canFinalize
                              ? 'text-amber-300'
                              : 'text-slate-400'
                          }`}
                        >
                          ·{' '}
                          {r.isFinalized
                            ? 'Finalized'
                            : r.canFinalize
                            ? 'Ready to Finalize'
                            : 'Counting in Progress'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>Counts: {r.activeCountRecords}</span>
                        <span>·</span>
                        <span>
                          Round 1 Verified: {r.verifiedLocationsCount}/{r.totalLocationsCounted}
                        </span>
                        <span>·</span>
                        <span>
                          2nd Counts Done: {r.verifiedRecountCount}
                          {r.unopenedVarianceCount + r.openRecountCount + r.pendingReviewRecountCount > 0
                            ? ` (${r.unopenedVarianceCount + r.openRecountCount + r.pendingReviewRecountCount} pending)`
                            : ''}
                        </span>
                      </div>
                    </div>

                    {!r.isFinalized ? (
                      <button
                        type="button"
                        disabled={!r.canFinalize || finalizingStoreId === r.storeId}
                        onClick={() => handleFinalizeStore(r)}
                        className="shrink-0 min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow transition active:scale-95 disabled:opacity-40 flex items-center justify-center gap-1.5"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>
                          {finalizingStoreId === r.storeId
                            ? 'Finalizing...'
                            : 'Finalize Store Counting'}
                        </span>
                      </button>
                    ) : (
                      <div className="text-right text-[11px] text-emerald-300 font-medium">
                        Finalized by {r.finalization?.finalizedByName || 'Supervisor'}
                        {r.finalization?.finalizedDate
                          ? ` · ${r.finalization.finalizedDate}`
                          : ''}
                      </div>
                    )}
                  </div>

                  {!r.isFinalized && r.blockingReasons.length > 0 && (
                    <ul className="text-xs text-amber-300/90 space-y-1 pt-2 border-t border-slate-800/80 list-disc list-inside">
                      {r.blockingReasons.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* System Balance Reconciliation Table (Strictly Rendered Only When Finalized) */}
          {!isScopeSystemBalanceUnlocked ? (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center space-y-2">
              <Lock className="w-9 h-9 text-slate-600 mx-auto" />
              <h4 className="text-sm font-bold text-slate-200">
                System Balance Hidden During Active Counting
              </h4>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Complete all Round 1 location checks and 2nd-count variance reviews, then finalize store counting above to view Masterlist system balances and final variances.
                {!isStoreSupervisor && selectedStore === 'all' && storeReadinessList.some((r) => r.isFinalized)
                  ? ' (Tip: Select an already-finalized branch in Store Scope above to view that branch.)'
                  : ''}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-white">
                    Finalized System Balance &amp; Reconciliation
                  </h4>
                  <p className="text-xs text-slate-400">
                    Verified 2nd-count quantities supersede Round 1 for recounted location-SKUs
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                  {(
                    [
                      { id: 'all', label: 'All SKUs' },
                      { id: 'variances', label: 'Variances' },
                      { id: 'matched', label: 'Matched' },
                      { id: 'uncounted', label: 'Uncounted' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setBalanceFilter(f.id)}
                      className={`px-2.5 py-1 rounded-lg font-semibold transition whitespace-nowrap ${
                        balanceFilter === f.id
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 max-h-[28rem] overflow-y-auto">
                <table className="w-full text-left text-xs text-slate-200">
                  <thead className="sticky top-0 bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">SKU / Description</th>
                      <th className="py-2.5 px-3 text-right">System</th>
                      <th className="py-2.5 px-3 text-right">1st Count</th>
                      <th className="py-2.5 px-3 text-right">2nd Count</th>
                      <th className="py-2.5 px-3 text-right">Final Qty</th>
                      <th className="py-2.5 px-3 text-right">Variance</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                    {finalizedReconciliationRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center font-sans text-slate-400">
                          No catalog SKUs match the selected filter.
                        </td>
                      </tr>
                    ) : (
                      finalizedReconciliationRows.map((row) => (
                        <tr key={row.sku} className="hover:bg-slate-900/60">
                          <td className="py-2 px-3">
                            <span className="font-bold text-indigo-300 block">{row.sku}</span>
                            <span className="font-sans text-[11px] text-slate-400 truncate max-w-[220px] block">
                              {row.description}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-slate-300">{row.systemStock}</td>
                          <td className="py-2 px-3 text-right text-slate-300">{row.round1Quantity}</td>
                          <td className="py-2 px-3 text-right text-amber-300 font-semibold">
                            {row.round2Quantity !== null ? row.round2Quantity : '—'}
                          </td>
                          <td className="py-2 px-3 text-right text-white font-bold">
                            {row.countedQuantity}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-bold ${
                              row.variance === 0
                                ? 'text-emerald-400'
                                : row.variance > 0
                                ? 'text-blue-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {row.variance > 0 ? `+${row.variance}` : row.variance}
                          </td>
                          <td className="py-2 px-3 text-center font-sans">
                            <span
                              className={`text-[11px] font-bold uppercase ${
                                row.status === 'matched'
                                  ? 'text-emerald-400'
                                  : row.status === 'over'
                                  ? 'text-blue-400'
                                  : row.status === 'under'
                                  ? 'text-rose-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
