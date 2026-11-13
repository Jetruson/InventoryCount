import React, { useState, useMemo } from 'react';
import {
  AuditLogEntry,
  AuditActionType,
  InventoryCount,
  CorrectionRequest,
  Store,
  AppUser,
} from '../types/inventory';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ShieldCheck,
  Search,
  Calendar,
  MapPin,
  User,
  Filter,
  FileSpreadsheet,
  FileText,
  History,
  X,
  Lock,
  CheckCircle2,
  Ban,
  ArrowRight,
  Package,
} from 'lucide-react';

interface AuditTrailScreenProps {
  auditLogs: AuditLogEntry[];
  counts: InventoryCount[];
  correctionRequests: CorrectionRequest[];
  stores: Store[];
  currentUser: AppUser;
}

const ACTION_LABELS: Record<AuditActionType, string> = {
  COUNT_SUBMITTED: 'Original Submission',
  CORRECTION_REQUESTED: 'Correction Requested',
  VOID_REQUESTED: 'Void Requested',
  CORRECTION_APPROVED: 'Correction Approved',
  CORRECTION_REJECTED: 'Correction Rejected',
  QUANTITY_CHANGED: 'Quantity Changed',
  LOCATION_CHANGED: 'Location Changed',
  ITEM_DETAILS_CHANGED: 'Item Details Changed',
  RECORD_VOIDED: 'Record Voided',
  VOID_REJECTED: 'Void Rejected',
  COUNTS_PURGED: 'Counts Deleted (Admin)',
};

export const AuditTrailScreen: React.FC<AuditTrailScreenProps> = ({
  auditLogs,
  counts,
  correctionRequests,
  stores,
  currentUser,
}) => {
  const isStoreSupervisor = currentUser.role === 'supervisor';
  const assignedStoreId = currentUser.assignedStoreId || currentUser.activeStoreId;
  const assignedStore = useMemo(
    () => stores.find((s) => s.storeId === assignedStoreId) || stores[0],
    [stores, assignedStoreId]
  );

  // Filters
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [itemFilter, setItemFilter] = useState<string>('');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<'all' | AuditActionType>('all');
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'N/A' | 'Pending' | 'Approved' | 'Rejected'>('all');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Store scope
  const scopedLogs = useMemo(() => {
    if (isStoreSupervisor && assignedStore) {
      return auditLogs.filter(
        (l) =>
          l.storeId === assignedStore.storeId ||
          l.store.toLowerCase() === assignedStore.name.toLowerCase()
      );
    }
    return auditLogs;
  }, [auditLogs, isStoreSupervisor, assignedStore]);

  const scopedCounts = useMemo(() => {
    if (isStoreSupervisor && assignedStore) {
      return counts.filter(
        (c) =>
          c.storeId === assignedStore.storeId ||
          c.store.toLowerCase() === assignedStore.name.toLowerCase()
      );
    }
    return counts;
  }, [counts, isStoreSupervisor, assignedStore]);

  // Unique dropdown values
  const uniqueLocations = useMemo(() => {
    const set = new Set<string>();
    scopedLogs.forEach((l) => {
      if (l.location && l.location !== '—') set.add(l.location);
    });
    return Array.from(set).sort();
  }, [scopedLogs]);

  const uniqueUsers = useMemo(() => {
    const set = new Set<string>();
    scopedLogs.forEach((l) => {
      if (l.requestedBy) set.add(l.requestedBy);
      if (l.reviewedBy) set.add(l.reviewedBy);
    });
    return Array.from(set).sort();
  }, [scopedLogs]);

  // Apply all Auditor Dashboard filters
  const filteredLogs = useMemo(() => {
    return scopedLogs.filter((log) => {
      if (fromDate && log.date < fromDate) return false;
      if (toDate && log.date > toDate) return false;
      if (!isStoreSupervisor && storeFilter !== 'all' && log.storeId !== storeFilter) return false;

      if (itemFilter.trim()) {
        const q = itemFilter.trim().toLowerCase();
        const hit =
          log.sku.toLowerCase().includes(q) ||
          log.itemDescription.toLowerCase().includes(q) ||
          (log.barcode || '').toLowerCase().includes(q) ||
          log.inventoryCountId.toLowerCase().includes(q) ||
          log.id.toLowerCase().includes(q);
        if (!hit) return false;
      }

      if (locationFilter !== 'all' && log.location !== locationFilter) return false;

      if (
        userFilter !== 'all' &&
        log.requestedBy !== userFilter &&
        log.reviewedBy !== userFilter
      ) {
        return false;
      }

      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (approvalFilter !== 'all' && log.approvalStatus !== approvalFilter) return false;

      return true;
    });
  }, [
    scopedLogs,
    fromDate,
    toDate,
    isStoreSupervisor,
    storeFilter,
    itemFilter,
    locationFilter,
    userFilter,
    actionFilter,
    approvalFilter,
  ]);

  // Metrics
  const stats = useMemo(() => {
    const activeCountRecords = scopedCounts.filter((c) => c.status !== 'voided').length;
    const voidedCountRecords = scopedCounts.filter((c) => c.status === 'voided').length;
    const pendingReqs = correctionRequests.filter((r) => r.status === 'pending').length;
    const approvedChanges = filteredLogs.filter((l) => l.approvalStatus === 'Approved').length;
    return {
      totalEvents: filteredLogs.length,
      activeCountRecords,
      voidedCountRecords,
      pendingReqs,
      approvedChanges,
    };
  }, [filteredLogs, scopedCounts, correctionRequests]);

  // Per-record complete history modal data
  const recordTimeline = useMemo(() => {
    if (!selectedRecordId) return null;
    const record = counts.find((c) => c.id === selectedRecordId) || null;
    const events = auditLogs
      .filter((l) => l.inventoryCountId === selectedRecordId)
      .sort((a, b) => a.timestamp - b.timestamp);
    const reqs = correctionRequests.filter((r) => r.inventoryCountId === selectedRecordId);
    return { record, events, reqs };
  }, [selectedRecordId, counts, auditLogs, correctionRequests]);

  // Export Audit Report to Excel (.xlsx)
  const handleExportExcel = () => {
    if (filteredLogs.length === 0) return;
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Audit Trail Logs
      const logRows = filteredLogs.map((l, idx) => ({
        '#': idx + 1,
        'Transaction ID': l.id,
        'Related Inventory ID': l.inventoryCountId,
        Date: l.date,
        Time: l.time,
        Store: `${l.store} (${l.storeId})`,
        'Item ID / SKU': l.sku,
        'Item Description': l.itemDescription,
        Location: l.location,
        'Action Performed': ACTION_LABELS[l.action] || l.action,
        'Approval Status': l.approvalStatus,
        'Original Value': l.originalValue,
        'New Value': l.newValue,
        Reason: l.reason,
        'Requested By': l.requestedBy,
        'Approved / Rejected By': l.reviewedBy || '—',
      }));
      const wsLogs = XLSX.utils.json_to_sheet(logRows);
      wsLogs['!cols'] = [
        { wch: 5 },
        { wch: 22 },
        { wch: 22 },
        { wch: 12 },
        { wch: 10 },
        { wch: 22 },
        { wch: 16 },
        { wch: 32 },
        { wch: 18 },
        { wch: 22 },
        { wch: 14 },
        { wch: 34 },
        { wch: 34 },
        { wch: 30 },
        { wch: 20 },
        { wch: 20 },
      ];
      XLSX.utils.book_append_sheet(wb, wsLogs, 'Audit Trail Logs');

      // Sheet 2: Inventory Records (Active & Voided)
      const countRows = scopedCounts.map((c, idx) => ({
        '#': idx + 1,
        'Inventory ID': c.id,
        Status: (c.status || 'active').toUpperCase(),
        Version: c.version || 1,
        Store: c.store,
        Location: c.location || '—',
        SKU: c.sku,
        Description: c.itemDescription,
        'Active Qty': c.countedQuantity,
        'Original Qty': c.originalQuantity ?? c.countedQuantity,
        Classification: c.condition || 'Good',
        'Void Reason': c.voidReason || '—',
        'Submitted By': c.username,
        Date: c.date,
        Time: c.time,
      }));
      const wsCounts = XLSX.utils.json_to_sheet(countRows);
      XLSX.utils.book_append_sheet(wb, wsCounts, 'Inventory Records');

      const dateTag = new Date().toISOString().split('T')[0];
      const filename = `Inventory_Audit_Report_${dateTag}.xlsx`;
      XLSX.writeFile(wb, filename);
      setExportNotice(`Exported ${filteredLogs.length} audit events to ${filename}`);
    } catch (err) {
      console.error('Audit Excel export failed:', err);
    }
  };

  // Export Audit Report to PDF (.pdf)
  const handleExportPDF = () => {
    if (filteredLogs.length === 0) return;
    try {
      const docPdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const generatedAt = new Date().toLocaleString();

      docPdf.setFontSize(14);
      docPdf.setTextColor(15, 23, 42);
      docPdf.text('Inventory Correction & Immutable Audit Trail Report', 40, 38);

      docPdf.setFontSize(9);
      docPdf.setTextColor(71, 85, 105);
      docPdf.text(
        `Generated: ${generatedAt}  |  Generated By: ${currentUser.displayName} (${currentUser.role})  |  Events: ${filteredLogs.length}  |  Active Counts: ${stats.activeCountRecords}  |  Voided Records: ${stats.voidedCountRecords}`,
        40,
        55
      );

      const tableRows = filteredLogs.map((l) => [
        `${l.date}\n${l.time}`,
        l.id,
        l.inventoryCountId,
        `${l.sku}\n${l.itemDescription.slice(0, 35)}`,
        ACTION_LABELS[l.action] || l.action,
        l.approvalStatus,
        l.originalValue.slice(0, 60),
        l.newValue.slice(0, 60),
        l.reason.slice(0, 50),
        l.requestedBy,
        l.reviewedBy || '—',
      ]);

      autoTable(docPdf, {
        startY: 70,
        head: [
          [
            'Date/Time',
            'Audit ID',
            'Count ID',
            'Item',
            'Action',
            'Status',
            'Original Value',
            'New Value',
            'Reason',
            'Requested By',
            'Reviewed By',
          ],
        ],
        body: tableRows,
        styles: { fontSize: 7, cellPadding: 3.5, overflow: 'linebreak' },
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 30, right: 30 },
      });

      const dateTag = new Date().toISOString().split('T')[0];
      const filename = `Inventory_Audit_Report_${dateTag}.pdf`;
      docPdf.save(filename);
      setExportNotice(`Exported PDF audit report (${filteredLogs.length} events) to ${filename}`);
    } catch (err) {
      console.error('Audit PDF export failed:', err);
    }
  };

  const resetFilters = () => {
    setFromDate('');
    setToDate('');
    setItemFilter('');
    setLocationFilter('all');
    setUserFilter('all');
    setActionFilter('all');
    setApprovalFilter('all');
    setStoreFilter('all');
  };

  return (
    <div className="w-full max-w-4xl mx-auto pb-24 pt-2 px-3.5 space-y-4">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-950 border border-indigo-500/30 p-4 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
              Immutable Audit Trail & Dashboard
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
              <Lock className="w-2.5 h-2.5 text-emerald-400" /> Append-Only
            </span>
          </div>
          <h2 className="text-lg font-black text-white mt-0.5">
            Inventory Audit Trail & Compliance Logs
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Read-only tamper-evident ledger of all submissions, correction requests, approvals, rejections, and voids.
          </p>
        </div>

        {/* Export Audit Report Buttons (Excel & PDF) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filteredLogs.length === 0}
            className="h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-lg active:scale-95 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={filteredLogs.length === 0}
            className="h-10 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg active:scale-95 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {exportNotice && (
        <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3.5 py-2.5 text-xs font-semibold text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3">
          <span className="text-[10px] font-semibold uppercase text-slate-400 block">Audit Events</span>
          <span className="text-xl font-black text-indigo-300 font-mono">{stats.totalEvents}</span>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3">
          <span className="text-[10px] font-semibold uppercase text-slate-400 block">Active Counts</span>
          <span className="text-xl font-black text-emerald-400 font-mono">{stats.activeCountRecords}</span>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3">
          <span className="text-[10px] font-semibold uppercase text-slate-400 block">Approved Changes</span>
          <span className="text-xl font-black text-white font-mono">{stats.approvedChanges}</span>
        </div>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3">
          <span className="text-[10px] font-semibold uppercase text-slate-400 block">Voided Records</span>
          <span className="text-xl font-black text-rose-400 font-mono">{stats.voidedCountRecords}</span>
        </div>
      </div>

      {/* Auditor Filter Panel */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 space-y-3 shadow-md">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-300 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-indigo-400" /> Auditor Dashboard Filters
          </span>
          <button
            type="button"
            onClick={resetFilters}
            className="text-[11px] text-indigo-300 hover:underline font-semibold"
          >
            Reset All Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
          {/* Item / ID Search */}
          <div className="relative">
            <input
              type="text"
              value={itemFilter}
              onChange={(e) => setItemFilter(e.target.value)}
              placeholder="Item SKU, description, audit/count ID..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pl-8 text-xs text-white placeholder-slate-500 focus:border-indigo-400 focus:outline-none"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          {/* Date From */}
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-[10px] text-slate-500 shrink-0">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full bg-transparent text-xs text-white focus:outline-none"
            />
          </div>

          {/* Date To */}
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-[10px] text-slate-500 shrink-0">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full bg-transparent text-xs text-white focus:outline-none"
            />
          </div>

          {/* Location */}
          <div className="relative">
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pl-8 text-xs text-white focus:border-indigo-400 focus:outline-none"
            >
              <option value="all">All Locations</option>
              {uniqueLocations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
          </div>

          {/* User */}
          <div className="relative">
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pl-8 text-xs text-white focus:border-indigo-400 focus:outline-none"
            >
              <option value="all">All Users</option>
              {uniqueUsers.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <User className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
          </div>

          {/* Action Type */}
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value as any)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-400 focus:outline-none"
          >
            <option value="all">All Action Types</option>
            {Object.entries(ACTION_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>

          {/* Approval Status */}
          <select
            value={approvalFilter}
            onChange={(e) => setApprovalFilter(e.target.value as any)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-400 focus:outline-none"
          >
            <option value="all">All Approval Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="N/A">Direct Submission (N/A)</option>
          </select>

          {/* Store (for Auditors & Ops Supervisors) */}
          {!isStoreSupervisor && (
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-400 focus:outline-none"
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
      </div>

      {/* Audit Log Timeline Cards */}
      <div className="space-y-2.5">
        {filteredLogs.length === 0 ? (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center text-slate-400 space-y-1">
            <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto mb-1" />
            <p className="text-sm font-semibold text-slate-300">No audit trail entries match filters</p>
            <p className="text-xs text-slate-500">
              All inventory submissions, correction requests, approvals, and voids are logged here automatically.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-2.5 shadow-sm hover:border-slate-700 transition"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase border ${
                        log.action === 'RECORD_VOIDED' ||
                        log.action === 'VOID_REQUESTED' ||
                        log.action === 'COUNTS_PURGED'
                          ? 'bg-rose-500/20 border-rose-500/30 text-rose-300'
                          : log.action === 'CORRECTION_APPROVED' ||
                            log.action === 'QUANTITY_CHANGED' ||
                            log.action === 'LOCATION_CHANGED' ||
                            log.action === 'ITEM_DETAILS_CHANGED'
                          ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                          : log.action === 'CORRECTION_REJECTED' || log.action === 'VOID_REJECTED'
                          ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                          : log.action === 'CORRECTION_REQUESTED'
                          ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                          : 'bg-indigo-500/20 border-indigo-500/30 text-indigo-300'
                      }`}
                    >
                      {ACTION_LABELS[log.action] || log.action}
                    </span>

                    {log.approvalStatus !== 'N/A' && (
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          log.approvalStatus === 'Approved'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : log.approvalStatus === 'Rejected'
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        {log.approvalStatus}
                      </span>
                    )}

                    <span className="font-mono text-[10px] text-slate-400">{log.id}</span>
                  </div>

                  <div className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
                    <span className="font-mono text-emerald-400">{log.sku}</span>
                    <span>{log.itemDescription}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedRecordId(log.inventoryCountId)}
                  className="inline-flex items-center gap-1 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 px-2.5 py-1.5 text-[11px] font-bold text-indigo-300 transition shrink-0"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Record History</span>
                </button>
              </div>

              {/* Original -> New Diff */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-slate-300">
                  <span className="text-[10px] uppercase font-sans font-bold text-slate-500 block">
                    Original Value
                  </span>
                  <span className="break-words">{log.originalValue}</span>
                </div>
                <div className="rounded-xl bg-slate-950 border border-indigo-500/25 px-3 py-2 text-indigo-200">
                  <span className="text-[10px] uppercase font-sans font-bold text-indigo-400 flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" /> New Value
                  </span>
                  <span className="break-words">{log.newValue}</span>
                </div>
              </div>

              <div className="text-xs text-slate-300">
                <span className="text-slate-400 font-semibold">Reason: </span>
                <span>{log.reason}</span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2 text-[11px] text-slate-400">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    Requested by: <strong className="text-slate-200">{log.requestedBy}</strong>
                  </span>
                  {log.reviewedBy && (
                    <span>
                      Reviewed by: <strong className="text-emerald-300">{log.reviewedBy}</strong>
                    </span>
                  )}
                  <span>
                    {log.store} · Loc: <span className="font-mono">{log.location || '—'}</span>
                  </span>
                </div>
                <div className="font-mono text-[10px] text-slate-400">
                  {log.date} {log.time} · Ref: {log.inventoryCountId}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Complete History Modal for a Specific Inventory Record */}
      {selectedRecordId && recordTimeline && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Complete Record Audit History</h3>
                  <p className="text-[11px] font-mono text-slate-400">{selectedRecordId}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecordId(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {recordTimeline.record && (
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-white">
                      <Package className="w-4 h-4 text-emerald-400" />
                      <span>
                        {recordTimeline.record.sku} — {recordTimeline.record.itemDescription}
                      </span>
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${
                        recordTimeline.record.status === 'voided'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {recordTimeline.record.status === 'voided' ? (
                        <span className="inline-flex items-center gap-1">
                          <Ban className="w-3 h-3" /> Voided
                        </span>
                      ) : (
                        `Active (v${recordTimeline.record.version || 1})`
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono pt-1 border-t border-slate-800">
                    <div>
                      <span className="text-slate-500 font-sans block">Original Qty</span>
                      <span className="text-slate-200 font-bold">
                        {recordTimeline.record.originalQuantity ?? recordTimeline.record.countedQuantity}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block">Current Qty</span>
                      <span className="text-emerald-300 font-bold">
                        {recordTimeline.record.countedQuantity}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block">Original Loc</span>
                      <span className="text-slate-200">
                        {recordTimeline.record.originalLocation || recordTimeline.record.location || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-sans block">Current Loc</span>
                      <span className="text-emerald-300">
                        {recordTimeline.record.location || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Chronological Timeline */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Chronological Audit Events ({recordTimeline.events.length})
                </h4>
                {recordTimeline.events.map((ev, index) => (
                  <div
                    key={ev.id}
                    className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-indigo-300">
                        #{index + 1} · {ACTION_LABELS[ev.action] || ev.action}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {ev.date} {ev.time}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-300">
                      <div>Before: {ev.originalValue}</div>
                      <div className="text-emerald-300">After: {ev.newValue}</div>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Reason: <span className="text-slate-200">{ev.reason}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1 border-t border-slate-800/80">
                      <span>By: {ev.requestedBy}{ev.reviewedBy ? ` · Reviewed by: ${ev.reviewedBy}` : ''}</span>
                      <span className="font-mono">{ev.id}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
