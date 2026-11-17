import React, { useMemo, useState } from 'react';
import {
  AppUser,
  CountingSession,
  CountType,
  InventoryCount,
  Store,
  UserRole,
} from '../types/inventory';
import {
  createCountingSession,
  doesRecordBelongToSession,
  getCountTypeLabel,
  isSessionVisibleForStore,
} from '../services/sessionService';
import {
  ArrowRight,
  Barcode,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Layers,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';

interface CountingSessionSelectPageProps {
  currentUser: AppUser;
  stores: Store[];
  activeStore: Store;
  countingSessions: CountingSession[];
  counts: InventoryCount[];
  activeSession?: CountingSession | null;
  onSelectSession: (session: CountingSession) => void;
  onSelectStore?: (store: Store) => void;
  onLogout: () => void;
  onCancelSwitch?: () => void;
}

function getRoleDisplayLabel(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'System Administrator';
    case 'ops_supervisor':
      return 'Counter Supervisor (Ops)';
    case 'supervisor':
      return 'Store Supervisor';
    case 'ops_counter':
      return 'Operations Counter';
    case 'audit':
      return 'Audit User';
    case 'counter':
    default:
      return 'Store Counter';
  }
}

export const CountingSessionSelectPage: React.FC<CountingSessionSelectPageProps> = ({
  currentUser,
  stores,
  activeStore,
  countingSessions,
  counts,
  activeSession,
  onSelectSession,
  onSelectStore,
  onLogout,
  onCancelSwitch,
}) => {
  const isSupervisor =
    currentUser.role === 'supervisor' || currentUser.role === 'ops_supervisor';
  const isOpsSupervisor = currentUser.role === 'ops_supervisor';
  const isAuditUser = currentUser.role === 'audit';
  const isStoreLockedUser =
    currentUser.role === 'counter' ||
    currentUser.role === 'supervisor' ||
    (currentUser.role === 'audit' &&
      Boolean(currentUser.assignedStoreId && currentUser.assignedStoreId !== 'ALL'));

  const userStoreScope = isStoreLockedUser
    ? currentUser.assignedStoreId || activeStore.storeId
    : 'ALL';

  const visibleSessions = useMemo(() => {
    return countingSessions.filter((s) => isSessionVisibleForStore(s, userStoreScope));
  }, [countingSessions, userStoreScope]);

  const [selectedModeFilter, setSelectedModeFilter] = useState<'all' | CountType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');

  // Inline Create Session Form State (Supervisors)
  const [isCreateFormOpen, setIsCreateFormOpen] = useState<boolean>(false);
  const [newCountType, setNewCountType] = useState<CountType>('cycle');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newCutoffDate, setNewCutoffDate] = useState<string>(
    () => new Date().toISOString().split('T')[0]
  );
  const [newStoreId, setNewStoreId] = useState<string>(() =>
    currentUser.role === 'supervisor' && currentUser.assignedStoreId
      ? currentUser.assignedStoreId
      : isOpsSupervisor
      ? 'ALL'
      : activeStore.storeId
  );
  const [newNotes, setNewNotes] = useState<string>('');
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const cycleSessions = useMemo(
    () => visibleSessions.filter((s) => s.countType === 'cycle'),
    [visibleSessions]
  );
  const annualSessions = useMemo(
    () => visibleSessions.filter((s) => s.countType === 'annual'),
    [visibleSessions]
  );

  const filteredSessions = useMemo(() => {
    return visibleSessions.filter((s) => {
      if (selectedModeFilter !== 'all' && s.countType !== selectedModeFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      return true;
    });
  }, [visibleSessions, selectedModeFilter, statusFilter]);

  const countMetricsBySessionId = useMemo(() => {
    const map = new Map<string, { records: number; units: number }>();
    visibleSessions.forEach((sess) => {
      let records = 0;
      let units = 0;
      counts.forEach((c) => {
        if (c.status === 'voided') return;
        if (!doesRecordBelongToSession(c, sess)) return;
        if (
          isStoreLockedUser &&
          userStoreScope !== 'ALL' &&
          c.storeId.trim().toLowerCase() !== userStoreScope.trim().toLowerCase()
        ) {
          return;
        }
        records += 1;
        units += Number(c.countedQuantity) || 0;
      });
      map.set(sess.id, { records, units });
    });
    return map;
  }, [visibleSessions, counts, isStoreLockedUser, userStoreScope]);

  const handleSelectAndEnter = (session: CountingSession) => {
    // If session is tied to a specific store and user can switch stores, align activeStore
    if (
      session.storeId &&
      session.storeId !== 'ALL' &&
      onSelectStore &&
      !isStoreLockedUser
    ) {
      const matched = stores.find((s) => s.storeId === session.storeId);
      if (matched) {
        onSelectStore(matched);
      }
    }
    onSelectSession(session);
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);
    try {
      const targetStore: Store | 'ALL' =
        newStoreId === 'ALL'
          ? 'ALL'
          : stores.find((s) => s.storeId === newStoreId) || activeStore;

      const created = await createCountingSession({
        countType: newCountType,
        title: newTitle,
        cutoffDate: newCutoffDate,
        store: targetStore,
        actor: currentUser,
        notes: newNotes,
      });

      setNewTitle('');
      setNewNotes('');
      setIsCreateFormOpen(false);
      handleSelectAndEnter(created);
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create counting session.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Clean Top Bar */}
      <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Barcode className="w-4 h-4" />
            </div>
            <span className="text-sm font-extrabold tracking-tight text-white whitespace-nowrap">
              Inventory Count
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {activeSession && onCancelSwitch && (
              <button
                type="button"
                onClick={onCancelSwitch}
                className="min-h-[40px] px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 whitespace-nowrap transition active:scale-95"
              >
                Back to Workspace
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="min-h-[40px] px-3.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-bold text-rose-300 flex items-center gap-1.5 whitespace-nowrap transition active:scale-95"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6">
        {/* Welcome / Identity Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold text-slate-200">{currentUser.displayName}</span>
              <span aria-hidden="true">·</span>
              <span>{getRoleDisplayLabel(currentUser.role)}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-slate-300">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                {isStoreLockedUser
                  ? `${activeStore.name} (${activeStore.storeId})`
                  : 'All Retail Stores'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Select Counting Mode &amp; Session
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
              Choose <strong className="text-cyan-300">Cycle Count</strong> or{' '}
              <strong className="text-emerald-300">Annual Inventory Count</strong> before entering the
              counting workspace. Counts, verification checks, requests, and audit trails are isolated per session.
            </p>
          </div>

          {isSupervisor && (
            <button
              type="button"
              onClick={() => {
                setCreateError(null);
                setIsCreateFormOpen((prev) => !prev);
              }}
              className="shrink-0 min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-lg flex items-center justify-center gap-2 whitespace-nowrap transition active:scale-95"
            >
              {isCreateFormOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              <span>{isCreateFormOpen ? 'Close Form' : 'New Session & Cut-Off'}</span>
            </button>
          )}
        </div>

        {/* Inline Session Creator (Supervisors) */}
        {isSupervisor && isCreateFormOpen && (
          <form
            onSubmit={handleCreateSession}
            className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white">
                  Define New Counting Session &amp; Cut-Off Date
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Tag this session as Cycle Count or Annual Inventory Count with its cut-off date.
                </p>
              </div>
            </div>

            {createError && (
              <div className="rounded-xl bg-rose-500/15 border border-rose-500/35 px-3.5 py-2.5 text-xs font-semibold text-rose-300">
                {createError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Count Mode
                </label>
                <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-xl border border-slate-800 gap-1">
                  <button
                    type="button"
                    onClick={() => setNewCountType('cycle')}
                    className={`min-h-[40px] rounded-lg text-xs font-bold transition ${
                      newCountType === 'cycle'
                        ? 'bg-cyan-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Cycle Count
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCountType('annual')}
                    className={`min-h-[40px] rounded-lg text-xs font-bold transition ${
                      newCountType === 'annual'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Annual Count
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Session Name <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={
                    newCountType === 'cycle'
                      ? 'e.g. Nov Weekly Cycle Count'
                      : 'e.g. FY2026 Annual Inventory'
                  }
                  className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Cut-Off Date <span className="text-amber-400">*</span>
                </label>
                <input
                  type="date"
                  value={newCutoffDate}
                  onChange={(e) => setNewCutoffDate(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-mono text-white focus:border-emerald-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Store Scope
                </label>
                {currentUser.role === 'supervisor' ? (
                  <div className="min-h-[44px] rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 flex items-center text-xs font-semibold text-amber-200 truncate">
                    {activeStore.name} ({activeStore.storeId})
                  </div>
                ) : (
                  <select
                    value={newStoreId}
                    onChange={(e) => setNewStoreId(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white focus:border-emerald-400 focus:outline-none"
                  >
                    <option value="ALL">All Retail Stores</option>
                    {stores.map((s) => (
                      <option key={s.storeId} value={s.storeId}>
                        {s.name} ({s.storeId})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Optional scope notes (e.g. Beverage & Snack aisles only, EOD cut-off)..."
                className="flex-1 min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isCreating || !newTitle.trim() || !newCutoffDate}
                className="shrink-0 min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-50"
              >
                {isCreating ? 'Creating Session...' : 'Create & Open Session'}
              </button>
            </div>
          </form>
        )}

        {/* Two Primary Mode Selector Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: Cycle Count */}
          <button
            type="button"
            onClick={() =>
              setSelectedModeFilter((prev) => (prev === 'cycle' ? 'all' : 'cycle'))
            }
            className={`text-left rounded-2xl p-5 border transition flex flex-col justify-between gap-4 ${
              selectedModeFilter === 'cycle'
                ? 'bg-slate-900 border-cyan-400 ring-1 ring-cyan-400/40'
                : 'bg-slate-900 border-slate-800 hover:border-cyan-500/50'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <span className="font-mono tabular-nums text-xs font-bold text-cyan-300">
                  {cycleSessions.filter((s) => s.status === 'active').length} Active ·{' '}
                  {cycleSessions.length} Total
                </span>
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-white">Cycle Count</h2>
                <p className="text-xs text-slate-400 leading-relaxed mt-1">
                  Targeted, recurring counts tagged by cut-off date. Maintains separate count
                  submissions, Round 1 checks, 2nd-count recounts, and correction requests.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs font-bold">
              <span className="text-cyan-300">
                {selectedModeFilter === 'cycle'
                  ? 'Showing Cycle Count Sessions'
                  : 'Filter Cycle Count Sessions'}
              </span>
              <ArrowRight className="w-4 h-4 text-cyan-300" />
            </div>
          </button>

          {/* Card 2: Annual Inventory Count */}
          <button
            type="button"
            onClick={() =>
              setSelectedModeFilter((prev) => (prev === 'annual' ? 'all' : 'annual'))
            }
            className={`text-left rounded-2xl p-5 border transition flex flex-col justify-between gap-4 ${
              selectedModeFilter === 'annual'
                ? 'bg-slate-900 border-emerald-400 ring-1 ring-emerald-400/40'
                : 'bg-slate-900 border-slate-800 hover:border-emerald-500/50'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                  <ClipboardList className="w-5 h-5" />
                </div>
                <span className="font-mono tabular-nums text-xs font-bold text-emerald-300">
                  {annualSessions.filter((s) => s.status === 'active').length} Active ·{' '}
                  {annualSessions.length} Total
                </span>
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-white">Annual Inventory Count</h2>
                <p className="text-xs text-slate-400 leading-relaxed mt-1">
                  Full wall-to-wall inventory count including baseline historical records,
                  location verification sign-offs, 2nd counts, and final reconciliation.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs font-bold">
              <span className="text-emerald-300">
                {selectedModeFilter === 'annual'
                  ? 'Showing Annual Inventory Sessions'
                  : 'Filter Annual Inventory Sessions'}
              </span>
              <ArrowRight className="w-4 h-4 text-emerald-300" />
            </div>
          </button>
        </div>

        {/* Session List Section */}
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold">
              {(
                [
                  { id: 'all', label: `All Modes (${visibleSessions.length})` },
                  { id: 'cycle', label: `Cycle Count (${cycleSessions.length})` },
                  { id: 'annual', label: `Annual Count (${annualSessions.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedModeFilter(tab.id)}
                  className={`min-h-[38px] px-3 rounded-lg transition whitespace-nowrap ${
                    selectedModeFilter === tab.id
                      ? tab.id === 'cycle'
                        ? 'bg-cyan-600 text-white'
                        : 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold">
              {(
                [
                  { id: 'all', label: 'All Statuses' },
                  { id: 'active', label: 'Active' },
                  { id: 'closed', label: 'Closed · Finalized' },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusFilter(st.id)}
                  className={`min-h-[38px] px-3 rounded-lg transition whitespace-nowrap ${
                    statusFilter === st.id
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {filteredSessions.length === 0 ? (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center space-y-2.5">
              <Layers className="w-9 h-9 text-slate-600 mx-auto" />
              <p className="text-sm font-bold text-slate-200">
                No {selectedModeFilter === 'all' ? '' : getCountTypeLabel(selectedModeFilter)}{' '}
                sessions match this filter
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {isSupervisor
                  ? 'Use "New Session & Cut-Off" above to create a new Cycle Count or Annual Inventory Count session.'
                  : 'Ask your Supervisor or Administrator to create a counting session, or switch filters above.'}
              </p>
              {isSupervisor && !isCreateFormOpen && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedModeFilter !== 'all') setNewCountType(selectedModeFilter);
                    setIsCreateFormOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 min-h-[44px] text-xs font-bold text-white transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create First Session</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredSessions.map((sess) => {
                const stats = countMetricsBySessionId.get(sess.id) || { records: 0, units: 0 };
                const isClosed = sess.status === 'closed';
                const isCurrent = activeSession?.id === sess.id;
                const isCycle = sess.countType === 'cycle';

                return (
                  <div
                    key={sess.id}
                    className={`rounded-2xl bg-slate-900 border p-4 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      isCurrent
                        ? 'border-emerald-400'
                        : isClosed
                        ? 'border-slate-800/80 opacity-95'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span
                          className={`font-bold ${
                            isCycle ? 'text-cyan-300' : 'text-emerald-300'
                          }`}
                        >
                          {getCountTypeLabel(sess.countType)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-200 font-semibold">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          Cut-Off {sess.cutoffDate || '—'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {sess.storeId === 'ALL'
                            ? 'All Retail Stores'
                            : `${sess.storeName} (${sess.storeId})`}
                        </span>
                        <span aria-hidden="true">·</span>
                        {isClosed ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                            <Lock className="w-3.5 h-3.5" />
                            Closed · Finalized
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Active
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-bold text-white truncate">{sess.title}</h3>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 font-mono tabular-nums">
                        <span>{stats.records} count records</span>
                        <span aria-hidden="true">·</span>
                        <span>{stats.units.toLocaleString()} units</span>
                        {sess.notes && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-sans text-slate-400 truncate max-w-md">
                              {sess.notes}
                            </span>
                          </>
                        )}
                      </div>

                      {isClosed && sess.closedByName && (
                        <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>
                            Finalized by {sess.closedByName}
                            {sess.closedAt
                              ? ` on ${new Date(sess.closedAt).toISOString().split('T')[0]}`
                              : ''}
                            {' · '}Supervisor System Balance unlocked
                          </span>
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectAndEnter(sess)}
                      className={`shrink-0 min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 whitespace-nowrap transition active:scale-95 ${
                        isClosed
                          ? 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200'
                          : isCycle
                          ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                      }`}
                    >
                      <span>
                        {isClosed
                          ? isAuditUser
                            ? 'Inspect Closed Audit'
                            : 'View Closed Session'
                          : isAuditUser
                          ? 'Open Audit Workspace'
                          : 'Enter Counting Workspace'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
