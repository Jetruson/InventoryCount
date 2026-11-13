import React, { useState, useMemo } from 'react';
import { InventoryCount, Store, AppUser } from '../types/inventory';
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
} from 'lucide-react';

interface HistoryScreenProps {
  counts: InventoryCount[];
  activeStore: Store;
  currentUser?: AppUser;
}

export const HistoryScreen: React.FC<HistoryScreenProps> = ({ counts, activeStore, currentUser }) => {
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
  const [storeFilter, setStoreFilter] = useState<'all' | 'current'>(
    canSwitchStores ? 'all' : 'current'
  );
  const [extractNotice, setExtractNotice] = useState<string | null>(null);

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Filter counts strictly by role permissions
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

      // 2. Store scope filtering
      if (!canSwitchStores) {
        // Store Counter & Store Supervisor are strictly locked to their designated branch
        const matchesDesignated =
          item.storeId === activeStore.storeId ||
          item.store.toLowerCase() === activeStore.name.toLowerCase();
        if (!matchesDesignated) return false;
      } else if (storeFilter === 'current') {
        if (item.storeId !== activeStore.storeId && item.store !== activeStore.name) {
          return false;
        }
      }

      // 3. SKU / description / location match
      if (skuFilter.trim()) {
        const query = skuFilter.trim().toLowerCase();
        const matchesSku = item.sku.toLowerCase().includes(query);
        const matchesDesc = (item.itemDescription || '').toLowerCase().includes(query);
        const matchesBarcode = (item.barcode || '').toLowerCase().includes(query);
        const matchesLoc = (item.location || '').toLowerCase().includes(query);
        if (!matchesSku && !matchesDesc && !matchesBarcode && !matchesLoc) return false;
      }

      // 4. Date filter
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
    storeFilter,
    activeStore,
    isCounterRole,
    canSwitchStores,
    currentUser,
    todayStr,
    yesterdayStr,
    oneWeekAgo,
  ]);

  const totalCountedUnits = useMemo(() => {
    return filteredCounts.reduce((acc, curr) => acc + (Number(curr.countedQuantity) || 0), 0);
  }, [filteredCounts]);

  const handleExtractExcel = () => {
    if (filteredCounts.length === 0) return;
    try {
      const rows = filteredCounts.map((c, idx) => ({
        '#': idx + 1,
        'Count ID': c.id,
        Date: c.date,
        Time: c.time,
        Store: c.store,
        'Store ID': c.storeId || '',
        'Shelf/Bin Location': c.location || '—',
        SKU: c.sku,
        Barcode: c.barcode || '',
        'Item Description': c.itemDescription || '',
        'Counted Quantity': Number(c.countedQuantity) || 0,
        Classification: c.condition || 'Good',
        Remarks: c.remarks || '',
        'Counter Username': c.username,
        'User ID': c.userId,
        'Sync Status': c.syncStatus || 'synced',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [
        { wch: 6 },
        { wch: 22 },
        { wch: 12 },
        { wch: 10 },
        { wch: 22 },
        { wch: 12 },
        { wch: 20 },
        { wch: 18 },
        { wch: 16 },
        { wch: 36 },
        { wch: 16 },
        { wch: 14 },
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
        Date: c.date,
        Time: c.time,
        Store: c.store,
        StoreID: c.storeId || '',
        Location: c.location || '',
        SKU: c.sku,
        Barcode: c.barcode || '',
        Description: c.itemDescription || '',
        CountedQuantity: Number(c.countedQuantity) || 0,
        Classification: c.condition || 'Good',
        Remarks: c.remarks || '',
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
            <span className="text-2xl font-black text-white tabular-nums">{filteredCounts.length}</span>
            <span className="text-xs text-slate-400">records</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400 font-medium">Total Quantity</span>
          <div className="text-2xl font-black text-emerald-400 tabular-nums">
            {totalCountedUnits.toLocaleString()}
          </div>
        </div>
      </div>

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

        {/* Date Segmented Tabs */}
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

        {/* Store Scope Toggle */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80 text-xs">
          <span className="text-slate-400 text-[11px] font-semibold">Store:</span>
          {canSwitchStores ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setStoreFilter('all')}
                className={`rounded-md px-2 py-1 text-xs transition ${
                  storeFilter === 'all'
                    ? 'bg-emerald-600 text-white font-semibold shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {role === 'ops_counter' ? 'All My Counts' : 'All Stores'}
              </button>
              <button
                onClick={() => setStoreFilter('current')}
                className={`rounded-md px-2 py-1 text-xs transition ${
                  storeFilter === 'current'
                    ? 'bg-emerald-600 text-white font-semibold shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Current ({activeStore.storeId})
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg bg-slate-800/90 border border-slate-700/80 px-2 py-0.5 text-xs text-slate-200">
              <Building2 className="w-3 h-3 text-emerald-400" />
              <span className="font-semibold">{activeStore.name} ({activeStore.storeId})</span>
              <span className="text-[9px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/15 px-1 py-0.2 rounded ml-1">
                Designated Branch
              </span>
            </div>
          )}
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
          filteredCounts.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm hover:border-slate-700 transition space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-slate-800 border border-slate-700 px-2 py-0.5 font-mono text-xs font-bold text-emerald-400">
                      {item.sku}
                    </span>
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
                  <h4 className="mt-1 text-sm font-semibold text-white leading-snug">
                    {item.itemDescription || 'Standard Stock Item'}
                  </h4>
                </div>

                <div className="text-right shrink-0">
                  <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-1.5 text-right">
                    <span className="text-[10px] uppercase text-slate-400 font-semibold block">Counted</span>
                    <span className="text-lg font-black text-white font-mono tabular-nums">
                      {item.countedQuantity}
                    </span>
                  </div>
                </div>
              </div>

              {item.remarks && (
                <div className="rounded-lg bg-slate-950/60 border border-slate-800/80 px-2.5 py-1 text-xs text-amber-300/90 font-mono">
                  Note: {item.remarks}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-slate-300">{item.username}</span>
                  <span>·</span>
                  <span>{item.date} {item.time}</span>
                </div>

                <div className="flex items-center gap-1">
                  {item.syncStatus === 'synced' ? (
                    <span className="flex items-center gap-1 text-emerald-400 text-[10px] font-semibold">
                      <CheckCircle2 className="w-3 h-3" /> Synced
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-400 text-[10px] font-semibold">
                      <Clock className="w-3 h-3" /> Pending Sync
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
