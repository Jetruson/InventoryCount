import React, { useState, useMemo } from 'react';
import { InventoryCount, Store } from '../types/inventory';
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
} from 'lucide-react';

interface SupervisorScreenProps {
  counts: InventoryCount[];
  stores: Store[];
}

export const SupervisorScreen: React.FC<SupervisorScreenProps> = ({ counts, stores }) => {
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'all' | 'by_user' | 'by_store' | 'by_location'>('all');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Filtered dataset
  const filteredSubmissions = useMemo(() => {
    return counts.filter((c) => {
      // Store filter
      if (selectedStore !== 'all') {
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
  }, [counts, selectedStore, selectedUser, searchQuery]);

  // Unique users list
  const userList = useMemo(() => {
    const set = new Set<string>();
    counts.forEach((c) => {
      if (c.username) set.add(c.username);
    });
    return Array.from(set);
  }, [counts]);

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
          <span className="text-xs text-emerald-400 font-bold uppercase tracking-wider">
            Supervisor Management
          </span>
          <h2 className="text-lg font-black text-white mt-0.5">
            Store Count Oversight & Audit
          </h2>
        </div>

        <button
          onClick={handleExportToExcel}
          disabled={isExporting || filteredSubmissions.length === 0}
          className="w-full sm:w-auto h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white shadow-lg active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>{isExporting ? 'Generating Excel...' : 'Export to Excel (.xlsx)'}</span>
        </button>
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
              Filter by Store
            </label>
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
        <div className="flex items-center gap-1.5 pt-2 border-t border-slate-800 text-xs">
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
                  <th className="py-3 px-3">Date / Time</th>
                  <th className="py-3 px-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-200">
                {filteredSubmissions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
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
          {locationBreakdown.map((loc) => (
            <div
              key={loc.location}
              className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600/20 text-emerald-400">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white font-mono">{loc.location}</h4>
                    <span className="text-[11px] text-slate-400">Shelf / Bin Area</span>
                  </div>
                </div>
                <div className="text-right">
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
          ))}
        </div>
      )}
    </div>
  );
};
