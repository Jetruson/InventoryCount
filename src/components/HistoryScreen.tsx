import React, { useState, useMemo } from 'react';
import {
  InventoryCount,
  Store,
  AppUser,
  CorrectionRequest,
  CorrectionRequestType,
} from '../types/inventory';
import { CorrectionRequestModal } from './CorrectionRequestModal';
import * as XLSX from 'xlsx';
import {
  Calendar,
  Search,
  CheckCircle2,
  Clock,
  Layers,
  MapPin,
  Building2,
  UserCheck,
  FileSpreadsheet,
  Download,
  FileEdit,
  Ban,
  AlertTriangle,
  History,
} from 'lucide-react';

interface HistoryScreenProps {
  counts: InventoryCount[];
  activeStore: Store;
  currentUser?: AppUser;
  correctionRequests?: CorrectionRequest[];
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({
  counts,
  activeStore,
  currentUser,
  correctionRequests = [],
}) => {
  const role = currentUser?.role || 'counter';
  const isCounterRole = role === 'counter' || role === 'ops_counter';
  const isAuditRole = role === 'audit';
  const canSwitchStores =
    role === 'admin' ||
    role === 'ops_supervisor' ||
    role === 'ops_counter' ||
    (isAuditRole && (!currentUser?.assignedStoreId || currentUser.assignedStoreId === 'ALL'));

  const [skuFilter, setSkuFilter] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'week'>('all');
  const [recordStatusFilter, setRecordStatusFilter] = useState<'all' | 'active' | 'voided'>('all');
  const [extractNotice, setExtractNotice] = useState<string | null>(null);
  const [requestTarget, setRequestTarget] = useState<InventoryCount | null>(null);
  const [requestMode, setRequestMode] = useState<CorrectionRequestType>('correction');
  const [requestSuccessNotice, setRequestSuccessNotice] = useState<string | null>(null);

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Filter counts strictly by role permissions and selected store
  const filteredCounts = useMemo(() => {
    return counts.filter((item) => {
      // 1. Counters (Store Counter & Operations Counter) only see their OWN counts
      if (isCounterRole && currentUser) {
        const matchesUserId = item.userId === currentUser.uid;
        const matchesUsername =
          item.username &&
          currentUser.displayName &&
          item.username.toLowerCase() === currentUser.displayName.toLowerCase();
        if (!matchesUserId && !matchesUsername) {
          return false;
        }
      }

      // 2. Store scope filtering: always match only the currently selected activeStore
      const matchesSelectedStore =
        item.storeId === activeStore.storeId ||
        item.store.toLowerCase() === activeStore.name.toLowerCase();
      if (!matchesSelectedStore) return false;

      // 3. SKU / description / location match
      if (skuFilter.trim()) {
        const query = skuFilter.trim().toLowerCase();
        const matchesSku = item.sku.toLowerCase().includes(query);
        const matchesDesc = (item.itemDescription || '').toLowerCase().includes(query);
        const matchesBarcode = (item.barcode || '').toLowerCase().includes(query);
        const matchesLoc = (item.location || '').toLowerCase().includes(query);
        if (!matchesSku && !matchesDesc && !matchesBarcode && !matchesLoc) return false;
      }

      // 4. Record status filter (active vs voided)
      const normalizedStatus = item.status === 'voided' ? 'voided' : 'active';
      if (recordStatusFilter !== 'all' && normalizedStatus !== recordStatusFilter) {
        return false;
      }

      // 5. Date filter
      if (dateFilter === 'today') {
        return item.date === todayStr;
      } else if (dateFilter === 'yesterday') {
        return item.date === yesterdayStr;
      } else if (dateFilter === 'week') {
        const itemDate = new Date(item.date);
        return itemDate >= oneWeekAgo;
      }

      return true;
    });
  }, [
    counts,
    skuFilter,
    dateFilter,
    recordStatusFilter,
    activeStore,
    isCounterRole,
    currentUser,
    todayStr,
    yesterdayStr,
    oneWeekAgo,
  ]);

  const activeFilteredCounts = useMemo(
    () => filteredCounts.filter((c) => c.status !== 'voided'),
    [filteredCounts]
  );

  const voidedFilteredCount = useMemo(
    () => filteredCounts.filter((c) => c.status === 'voided').length,
    [filteredCounts]
  );

  // Voided records are excluded from active inventory calculations
  const totalCountedUnits = useMemo(() => {
    return activeFilteredCounts.reduce((acc, curr) => acc + (Number(curr.countedQuantity) || 0), 0);
  }, [activeFilteredCounts]);

  const requestsByCountId = useMemo(() => {
    const map = new Map<string, { pending?: CorrectionRequest; latest?: CorrectionRequest }>();
    const sorted = [...correctionRequests].sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
    for (const req of sorted) {
      const existing = map.get(req.inventoryCountId) || {};
      if (!existing.latest) existing.latest = req;
      if (req.status === 'pending' && !existing.pending) existing.pending = req;
      map.set(req.inventoryCountId, existing);
    }
    return map;
  }, [correctionRequests]);

  const handleExtractExcel = () => {
    if (filteredCounts.length === 0) return;
    try {
      const rows = filteredCounts.map((c, idx) => ({
        '#': idx + 1,
        'Count ID': c.id,
        Status: c.status === 'voided' ? 'VOIDED' : 'ACTIVE',
        Version: c.version || 1,
        Date: c.date,
        Time: c.time,
        Store: c.store,
        'Store ID': c.storeId || '',
        'Shelf/Bin Location': c.location || '—',
        SKU: c.sku,
        Barcode: c.barcode || '',
        'Item Description': c.itemDescription || '',
        'Active Quantity': c.status === 'voided' ? 0 : Number(c.countedQuantity) || 0,
        'Submitted / Last Qty': Number(c.countedQuantity) || 0,
        'Original Quantity': c.originalQuantity ?? (Number(c.countedQuantity) || 0),
        Classification: c.condition || 'Good',
        Remarks: c.remarks || '',
        'Void Reason': c.voidReason || '',
        'Counter Username': c.username,
        'User ID': c.userId,
        'Sync Status': c.syncStatus || 'synced',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 6 },
        { wch: 22 },
        { wch: 10 },
        { wch: 9 },
        { wch: 12 },
        { wch: 10 },
        { wch: 22 },
        { wch: 12 },
        { wch: 20 },
        { wch: 18 },
        { wch: 16 },
        { wch: 36 },
        { wch: 14 },
        { wch: 18 },
        { wch: 16 },
        { wch: 14 },
        { wch: 24 },
        { wch: 24 },
        { wch: 18 },
        { wch: 24 },
        { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Audit Counts');

      const dateTag = new Date().toISOString().split('T')[0];
      const filename = `Audit_Count_Extract_${dateTag}.xlsx`;
      XLSX.writeFile(wb, filename);
      setExtractNotice(`Extracted ${filteredCounts.length} records to ${filename}`);
    } catch (err) {
      console.error('Excel extract error:', err);
    }
  };

  const handleExtractCSV = () => {
    if (filteredCounts.length === 0) return;
    try {
      const rows = filteredCounts.map((c) => ({
        CountID: c.id,
        Status: c.status === 'voided' ? 'VOIDED' : 'ACTIVE',
        Version: c.version || 1,
        Date: c.date,
        Time: c.time,
        Store: c.store,
        StoreID: c.storeId || '',
        Location: c.location || '',
        SKU: c.sku,
        Barcode: c.barcode || '',
        Description: c.itemDescription || '',
        ActiveQuantity: c.status === 'voided' ? 0 : Number(c.countedQuantity) || 0,
        OriginalQuantity: c.originalQuantity ?? (Number(c.countedQuantity) || 0),
        Classification: c.condition || 'Good',
        Remarks: c.remarks || '',
        VoidReason: c.voidReason || '',
        Username: c.username,
        UserID: c.userId,
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Counts');

      const dateTag = new Date().toISOString().split('T')[0];
      const filename = `Audit_Count_Extract_${dateTag}.csv`;
      XLSX.writeFile(wb, filename, { bookType: 'csv' });
      setExtractNotice(`Extracted ${filteredCounts.length} records to ${filename}`);
    } catch (err) {
      console.error('CSV extract error:', err);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto pb-24 pt-2 px-3.5 space-y-4">
      {/* Header Summary Strip */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-md flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">History Submissions</span>
            {isCounterRole && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                <UserCheck className="w-3 h-3" />
                My Counts Only
              </span>
            )}
            {isAuditRole && (
              <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">
                Audit View · Read & Extract
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl font-black text-white tabular-nums">{activeFilteredCounts.length}</span>
            <span className="text-xs text-slate-400">
              active {voidedFilteredCount > 0 ? `· ${voidedFilteredCount} voided` : 'records'}
            </span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400 font-medium">Active Quantity</span>
          <div className="text-2xl font-black text-emerald-400 tabular-nums">
            {totalCountedUnits.toLocaleString()}
          </div>
        </div>
      </div>

      {requestSuccessNotice && (
        <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-2.5 text-xs font-semibold text-emerald-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{requestSuccessNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setRequestSuccessNotice(null)}
            className="text-emerald-300 hover:text-white text-[11px] font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Audit User Count Extraction Bar */}
      {isAuditRole && (
        <div className="rounded-2xl bg-gradient-to-r from-indigo-950/60 to-slate-900 border border-indigo-500/30 p-4 shadow-md space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <h3 className="text-sm font-bold text-white">Extract Count History</h3>
              <p className="text-[11px] text-slate-400">
                Download filtered count records ({filteredCounts.length} matching)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExtractExcel}
                disabled={filteredCounts.length === 0}
                className="flex-1 sm:flex-none h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md active:scale-95 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={handleExtractCSV}
                disabled={filteredCounts.length === 0}
                className="flex-1 sm:flex-none h-10 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-md active:scale-95 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>CSV (.csv)</span>
              </button>
            </div>
          </div>

          {extractNotice && (
            <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>{extractNotice}</span>
            </div>
          )}
        </div>
      )}

      {/* Filter Controls */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 shadow-md space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            placeholder="Filter by SKU, description, barcode, location..."
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pl-9 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
        </div>

        {/* Date & Record Status Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-400 text-[11px] font-semibold shrink-0 mr-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> Date:
          </span>
          {[
            { id: 'all', label: 'All Time' },
            { id: 'today', label: 'Today' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'week', label: 'Past 7 Days' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setDateFilter(tab.id as 'all' | 'today' | 'yesterday' | 'week')}
              className={`rounded-lg px-2.5 py-1.5 font-medium whitespace-nowrap shrink-0 transition ${
                dateFilter === tab.id
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-400 text-[11px] font-semibold shrink-0 mr-1 flex items-center gap-1">
            <History className="w-3.5 h-3.5" /> Status:
          </span>
          {[
            { id: 'all', label: 'All Records' },
            { id: 'active', label: 'Active Only' },
            { id: 'voided', label: 'Voided Only' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setRecordStatusFilter(tab.id as 'all' | 'active' | 'voided')}
              className={`rounded-lg px-2.5 py-1.5 font-medium whitespace-nowrap shrink-0 transition ${
                recordStatusFilter === tab.id
                  ? tab.id === 'voided'
                    ? 'bg-rose-600 text-white font-bold'
                    : 'bg-emerald-600 text-white font-bold'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Selected Store Indicator */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80 text-xs">
          <span className="text-slate-400 text-[11px] font-semibold">Store:</span>
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-800/90 border border-slate-700/80 px-2 py-0.5 text-xs text-slate-200">
            <Building2 className="w-3 h-3 text-emerald-400" />
            <span className="font-semibold">{activeStore.name} ({activeStore.storeId})</span>
            <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/15 px-1 py-0.2 rounded ml-1">
              {canSwitchStores ? 'Selected Store' : 'Designated Branch'}
            </span>
          </div>
        </div>
      </div>

      {/* Count Records List */}
      <div className="space-y-2.5">
        {filteredCounts.length === 0 ? (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center text-slate-400">
            <Layers className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-300">No count records found</p>
            <p className="text-xs text-slate-500 mt-1">
              {isCounterRole
                ? 'Your personal count submissions will appear here.'
                : 'Try adjusting your SKU search or date filters above.'}
            </p>
          </div>
        ) : (
          filteredCounts.map((item) => {
            const isVoided = item.status === 'voided';
            const reqMeta = requestsByCountId.get(item.id);
            const pendingReq = reqMeta?.pending;
            const latestReq = reqMeta?.latest;
            const canRequestChanges =
              !!currentUser && !isAuditRole && role !== 'admin' && !isVoided && !pendingReq;

            return (
              <div
                key={item.id}
                className={`rounded-2xl border p-4 shadow-sm transition space-y-2 ${
                  isVoided
                    ? 'bg-slate-900/60 border-rose-500/30 opacity-80'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-slate-800 border border-slate-700 px-2 py-0.5 font-mono text-xs font-bold text-emerald-400">
                        {item.sku}
                      </span>
                      {isVoided && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 border border-rose-500/40 px-1.5 py-0.5 text-[10px] font-black uppercase text-rose-300">
                          <Ban className="w-2.5 h-2.5" />
                          VOIDED
                        </span>
                      )}
                      {(item.version || 1) > 1 && !isVoided && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                          Corrected v{item.version}
                        </span>
                      )}
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase border ${
                          item.condition === 'Damage'
                            ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                            : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        }`}
                      >
                        {item.condition || 'Good'}
                      </span>
                      <span className="text-xs text-slate-400">· {item.store}</span>
                      {item.location && (
                        <span className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
                          <MapPin className="w-3 h-3 text-emerald-400" />
                          {item.location}
                        </span>
                      )}
                    </div>
                    <h4
                      className={`mt-1 text-sm font-semibold leading-snug ${
                        isVoided ? 'text-slate-400 line-through' : 'text-white'
                      }`}
                    >
                      {item.itemDescription || 'Standard Stock Item'}
                    </h4>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-right">
                      <span className="text-[10px] uppercase text-slate-400 font-semibold block">
                        {isVoided ? 'Voided' : 'Counted'}
                      </span>
                      <span
                        className={`text-lg font-black font-mono tabular-nums ${
                          isVoided ? 'text-slate-500 line-through' : 'text-white'
                        }`}
                      >
                        {item.countedQuantity}
                      </span>
                      {item.originalQuantity !== undefined &&
                        item.originalQuantity !== item.countedQuantity && (
                          <span className="block text-[9px] text-amber-400 font-mono">
                            Orig: {item.originalQuantity}
                          </span>
                        )}
                    </div>
                  </div>
                </div>

                {item.remarks && (
                  <div className="rounded-lg bg-slate-950/60 border border-slate-800/80 px-2.5 py-1 text-xs text-amber-300/90 font-mono">
                    Note: {item.remarks}
                  </div>
                )}

                {isVoided && (
                  <div className="rounded-lg bg-rose-950/40 border border-rose-500/30 px-2.5 py-1.5 text-[11px] text-rose-200 flex items-start gap-1.5">
                    <Ban className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Excluded from active inventory</span>
                      {item.voidReason ? ` · Reason: ${item.voidReason}` : ''}
                      {item.voidedBy ? ` (Approved by ${item.voidedBy})` : ''}
                    </div>
                  </div>
                )}

                {pendingReq && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5 text-[11px] text-amber-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>
                      Pending{' '}
                      <strong className="uppercase">
                        {pendingReq.requestType === 'void' ? 'Void' : 'Correction'}
                      </strong>{' '}
                      ·{' '}
                      {pendingReq.requestedByRole === 'supervisor' ||
                      pendingReq.requestedByRole === 'ops_supervisor'
                        ? 'Awaiting Audit Approval'
                        : pendingReq.requestedByRole === 'ops_counter'
                        ? 'Awaiting Ops Supervisor Approval'
                        : 'Awaiting Store Supervisor Approval'}{' '}
                      (Requested by {pendingReq.requestedByUsername})
                    </span>
                  </div>
                )}

                {!pendingReq && latestReq?.status === 'rejected' && !isVoided && (
                  <div className="rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-[11px] text-slate-300 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <span>
                      Last {latestReq.requestType} rejected by {latestReq.reviewedByUsername}:{' '}
                      <span className="text-rose-300">{latestReq.rejectionReason}</span>
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-300">{item.username}</span>
                    <span>·</span>
                    <span>
                      {item.date} {item.time}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {item.syncStatus === 'synced' ? (
                      <span className="flex items-center gap-1 text-emerald-400 text-[10px] font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> Synced
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-400 text-[10px] font-semibold">
                        <Clock className="w-3 h-3" /> Pending Sync
                      </span>
                    )}

                    {canRequestChanges && (
                      <div className="flex items-center gap-1.5 ml-1">
                        <button
                          type="button"
                          onClick={() => {
                            setRequestTarget(item);
                            setRequestMode('correction');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 px-2 py-1 text-[10px] font-bold text-amber-300 transition active:scale-95"
                        >
                          <FileEdit className="w-3 h-3" />
                          <span>Correction</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRequestTarget(item);
                            setRequestMode('void');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 px-2 py-1 text-[10px] font-bold text-rose-300 transition active:scale-95"
                        >
                          <Ban className="w-3 h-3" />
                          <span>Void</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {currentUser && (
        <CorrectionRequestModal
          isOpen={Boolean(requestTarget)}
          countRecord={requestTarget}
          initialMode={requestMode}
          currentUser={currentUser}
          onClose={() => setRequestTarget(null)}
          onSubmitted={(req) => {
            setRequestSuccessNotice(
              `${req.requestType === 'void' ? 'Void' : 'Correction'} request submitted for ${req.sku}. Awaiting supervisor approval.`
            );
          }}
        />
      )}
    </div>
  );
};
