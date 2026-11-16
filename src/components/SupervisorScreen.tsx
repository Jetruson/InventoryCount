import React, { useState, useMemo } from 'react';
import { InventoryCount, Store, AppUser, LocationVerification, LocationVerificationStatus } from '../types/inventory';
import {
  getLocationVerificationId,
  reviewLocationVerification,
} from '../services/locationVerificationService';
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
} from 'lucide-react';

interface SupervisorScreenProps {
  counts: InventoryCount[];
  stores: Store[];
  currentUser?: AppUser;
  locationVerifications?: LocationVerification[];
}

export const SupervisorScreen: React.FC<SupervisorScreenProps> = ({
  counts,
  stores,
  currentUser,
  locationVerifications = [],
}) => {
  const isStoreSupervisor = currentUser?.role === 'supervisor';
  const isOpsSupervisor = currentUser?.role === 'ops_supervisor';
  const assignedStoreId = currentUser?.assignedStoreId || currentUser?.activeStoreId;
  const assignedStore = useMemo(() => {
    return stores.find((s) => s.storeId === assignedStoreId) || stores[0];
  }, [stores, assignedStoreId]);

  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'verify_locations' | 'all' | 'by_user' | 'by_store' | 'by_location'>('verify_locations');
  const [verificationStatusFilter, setVerificationStatusFilter] = useState<
    'all' | LocationVerificationStatus | 'in_progress'
  >('all');
  const [expandedLocations, setExpandedLocations] = useState<Record<string, boolean>>({});
  const [checkedLineItems, setCheckedLineItems] = useState<Record<string, boolean>>({});
  const [reviewNotesMap, setReviewNotesMap] = useState<Record<string, string>>({});
  const [reviewingLocationKey, setReviewingLocationKey] = useState<string | null>(null);
  const [verifyFeedback, setVerifyFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

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
      const key = getLocationVerificationId(storeId, loc);
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

  // Export to Excel function using xlsx
  const handleExportToExcel = () => {
    setIsExporting(true);
    try {
      // 1. Format audit data for worksheet
      const rows = filteredSubmissions.map((c, index) => ({
        'No.': index + 1,
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
      const filename = `Inventory_Count_Report_${dateTag}.xlsx`;
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
          <div className="flex items-center gap-2">
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
            {isStoreSupervisor && (
              <span className="rounded-md bg-amber-500/20 text-amber-300 px-2 py-0.5 text-[10px] font-black uppercase">
                Assigned Store Scope
              </span>
            )}
            {isOpsSupervisor && (
              <span className="rounded-md bg-cyan-500/20 text-cyan-300 px-2 py-0.5 text-[10px] font-black uppercase">
                All Stores & Counters
              </span>
            )}
          </div>
          <h2 className="text-lg font-black text-white mt-0.5">
            {isStoreSupervisor
              ? `${assignedStore?.name} (${assignedStore?.storeId})`
              : 'All Counter Submissions & Audit (All Branches)'}
          </h2>
          {isStoreSupervisor && (
            <p className="text-xs text-slate-400 mt-0.5">
              Store supervisors only have visibility into their designated store branch
            </p>
          )}
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

      {/* Content depending on active tab */}
      {activeTab === 'all' && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden shadow-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3.5">SKU / Item</th>
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
                    <td colSpan={8} className="py-8 text-center text-slate-400">
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
    </div>
  );
};
