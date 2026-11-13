import React, { useState, useMemo } from 'react';
import {
  CorrectionRequest,
  Store,
  AppUser,
} from '../types/inventory';
import {
  approveCorrectionOrVoidRequest,
  rejectCorrectionOrVoidRequest,
} from '../services/auditService';
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Search,
  MapPin,
  Ban,
  FileEdit,
  Paperclip,
  Lock,
  ArrowRight,
  Building2,
} from 'lucide-react';

interface CorrectionRequestsScreenProps {
  requests: CorrectionRequest[];
  stores: Store[];
  currentUser: AppUser;
}

export const CorrectionRequestsScreen: React.FC<CorrectionRequestsScreenProps> = ({
  requests,
  stores,
  currentUser,
}) => {
  const isAuditUser = currentUser.role === 'audit';
  const isStoreSupervisor = currentUser.role === 'supervisor';
  const isStoreLockedAudit =
    isAuditUser && Boolean(currentUser.assignedStoreId && currentUser.assignedStoreId !== 'ALL');
  const isStoreScoped = isStoreSupervisor || isStoreLockedAudit;
  const assignedStoreId = currentUser.assignedStoreId || currentUser.activeStoreId;
  const assignedStore = useMemo(
    () => stores.find((s) => s.storeId === assignedStoreId) || stores[0],
    [stores, assignedStoreId]
  );

  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [typeFilter, setTypeFilter] = useState<'all' | 'correction' | 'void'>('all');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CorrectionRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isOpsSupervisor = currentUser.role === 'ops_supervisor';
  const isSupervisorSubmitted = (r: CorrectionRequest) =>
    r.requestedByRole === 'supervisor' || r.requestedByRole === 'ops_supervisor';
  const isOpsCounterSubmitted = (r: CorrectionRequest) => r.requestedByRole === 'ops_counter';
  const isStoreCounterSubmitted = (r: CorrectionRequest) =>
    !isSupervisorSubmitted(r) && !isOpsCounterSubmitted(r);

  const canCurrentUserReview = (r: CorrectionRequest): boolean => {
    if (isAuditUser) {
      return isSupervisorSubmitted(r);
    }
    if (isOpsSupervisor) {
      return isOpsCounterSubmitted(r);
    }
    if (isStoreSupervisor) {
      if (!isStoreCounterSubmitted(r)) return false;
      if (!assignedStore) return false;
      return (
        r.storeId === assignedStore.storeId ||
        r.store.toLowerCase() === assignedStore.name.toLowerCase()
      );
    }
    return false;
  };

  // Scoped requests:
  // - Audit: supervisor-submitted correction & void requests (store-locked if assigned to a store)
  // - Ops Supervisor: multi-store Operations Counter requests (+ any own submitted supervisor requests)
  // - Store Supervisor: same-store Store Counter requests (+ own/same-store supervisor requests awaiting Audit)
  const scopedRequests = useMemo(() => {
    let list = requests;
    if (isStoreScoped && assignedStore) {
      list = list.filter(
        (r) =>
          r.storeId === assignedStore.storeId ||
          r.store.toLowerCase() === assignedStore.name.toLowerCase()
      );
    }
    if (isAuditUser) {
      list = list.filter((r) => isSupervisorSubmitted(r));
    } else if (isOpsSupervisor) {
      list = list.filter(
        (r) => isOpsCounterSubmitted(r) || r.requestedById === currentUser.uid
      );
    } else if (isStoreSupervisor) {
      list = list.filter(
        (r) => isStoreCounterSubmitted(r) || r.requestedById === currentUser.uid
      );
    }
    return list;
  }, [requests, isStoreScoped, assignedStore, isAuditUser, isOpsSupervisor, isStoreSupervisor, currentUser.uid]);

  const pendingCount = useMemo(
    () =>
      scopedRequests.filter((r) => r.status === 'pending' && canCurrentUserReview(r)).length,
    [scopedRequests, isAuditUser, isOpsSupervisor, isStoreSupervisor, assignedStore]
  );

  const filteredRequests = useMemo(() => {
    return scopedRequests.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (typeFilter !== 'all' && r.requestType !== typeFilter) return false;
      if (!isStoreScoped && storeFilter !== 'all' && r.storeId !== storeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hit =
          r.sku.toLowerCase().includes(q) ||
          r.itemDescription.toLowerCase().includes(q) ||
          r.requestedByUsername.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [scopedRequests, statusFilter, typeFilter, storeFilter, isStoreScoped, searchQuery]);

  const isOwnRequest = (req: CorrectionRequest): boolean => {
    const myName = (currentUser.displayName || '').trim().toLowerCase();
    return (
      req.requestedById === currentUser.uid ||
      (myName.length > 0 && req.requestedByUsername.trim().toLowerCase() === myName)
    );
  };

  const handleApprove = async (req: CorrectionRequest) => {
    setActionMessage(null);
    setProcessingId(req.id);
    try {
      await approveCorrectionOrVoidRequest(req, currentUser);
      setActionMessage({
        type: 'success',
        text:
          req.requestType === 'void'
            ? `Void request ${req.id} approved. Record ${req.sku} has been soft-deleted (voided) and logged to Audit Trail.`
            : `Correction request ${req.id} approved and applied to active inventory record ${req.sku}.`,
      });
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err?.message || 'Could not approve request.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    setActionMessage(null);
    setProcessingId(rejectTarget.id);
    try {
      await rejectCorrectionOrVoidRequest(rejectTarget, currentUser, rejectionReason);
      setActionMessage({
        type: 'success',
        text: `Request ${rejectTarget.id} rejected with reason logged to Audit Trail.`,
      });
      setRejectTarget(null);
      setRejectionReason('');
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err?.message || 'Could not reject request.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto pb-24 pt-2 px-3.5 space-y-4">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 p-4 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className={`w-4 h-4 ${isAuditUser ? 'text-indigo-400' : 'text-amber-400'}`} />
            <span
              className={`text-xs font-bold uppercase tracking-wider ${
                isAuditUser ? 'text-indigo-400' : 'text-amber-400'
              }`}
            >
              {isAuditUser
                ? 'Audit Approval Workflow · Supervisor Requests'
                : isOpsSupervisor
                ? 'Ops Counter Supervisor Approval Workflow'
                : 'Store Supervisor Approval Workflow'}
            </span>
          </div>
          <h2 className="text-lg font-black text-white mt-0.5">
            {isAuditUser
              ? 'Supervisor Correction & Void Approvals'
              : isOpsSupervisor
              ? 'Multi-Store Counter Requests'
              : 'Store Counter Requests'}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isAuditUser
              ? isStoreScoped && assignedStore
                ? `Supervisor requests for ${assignedStore.name} (${assignedStore.storeId}) requiring Audit sign-off`
                : 'All supervisor-submitted correction and void requests require Audit approval'
              : isOpsSupervisor
              ? 'Multi-store Counters (Operations Counter) across all branches · Your own requests require Audit approval'
              : assignedStore
              ? `Scoped strictly to ${assignedStore.name} (${assignedStore.storeId}) Store Counters · Your own requests require Audit approval`
              : 'Scoped to your assigned store counters'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-amber-500/15 border border-amber-500/30 px-3.5 py-2 text-center">
            <span className="text-[10px] font-bold uppercase text-amber-300 block">Actionable</span>
            <span className="text-xl font-black text-amber-400 font-mono">{pendingCount}</span>
          </div>
          <div className="rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2 text-center">
            <span className="text-[10px] font-bold uppercase text-slate-400 block">Total</span>
            <span className="text-xl font-black text-white font-mono">{scopedRequests.length}</span>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {actionMessage && (
        <div
          className={`rounded-xl p-3 text-xs font-semibold flex items-start gap-2 border animate-in fade-in ${
            actionMessage.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Filter Card */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 space-y-3 shadow-md">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {[
            { id: 'pending', label: `Pending (${pendingCount})` },
            { id: 'approved', label: 'Approved' },
            { id: 'rejected', label: 'Rejected' },
            { id: 'all', label: 'All Requests' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id as any)}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                statusFilter === tab.id
                  ? 'bg-amber-600 text-white shadow'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search SKU, user, reason..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pl-8 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
          >
            <option value="all">All Request Types</option>
            <option value="correction">Corrections Only</option>
            <option value="void">Void Requests Only</option>
          </select>

          {isStoreScoped ? (
            <div className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 font-semibold">
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{assignedStore?.name}</span>
            </div>
          ) : (
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
            >
              <option value="all">All Stores</option>
              {stores.map((s) => (
                <option key={s.storeId} value={s.storeId}>
                  {s.name} ({s.storeId})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Request Cards */}
      <div className="space-y-3">
        {filteredRequests.length === 0 ? (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center text-slate-400 space-y-1">
            <ClipboardCheck className="w-10 h-10 text-slate-600 mx-auto mb-1" />
            <p className="text-sm font-semibold text-slate-300">No requests in this view</p>
            <p className="text-xs text-slate-500">
              Submitted correction and void requests requiring review will appear here.
            </p>
          </div>
        ) : (
          filteredRequests.map((req) => {
            const selfOwned = isOwnRequest(req);
            const isPending = req.status === 'pending';
            const isSupervisorReq = isSupervisorSubmitted(req);
            const isOpsCounterReq = isOpsCounterSubmitted(req);
            const reviewAllowed = canCurrentUserReview(req);

            return (
              <div
                key={req.id}
                className={`rounded-2xl bg-slate-900 border p-4 shadow-md space-y-3 ${
                  req.requestType === 'void' ? 'border-rose-500/30' : 'border-slate-800'
                }`}
              >
                {/* Top Metadata Row */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-black uppercase border ${
                          req.requestType === 'void'
                            ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                            : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        }`}
                      >
                        {req.requestType === 'void' ? (
                          <>
                            <Ban className="w-3 h-3" /> Void Request
                          </>
                        ) : (
                          <>
                            <FileEdit className="w-3 h-3" /> Correction Request
                          </>
                        )}
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                          req.status === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : req.status === 'rejected'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {req.status === 'pending' && <Clock className="w-3 h-3" />}
                        {req.status === 'approved' && <CheckCircle2 className="w-3 h-3" />}
                        {req.status === 'rejected' && <XCircle className="w-3 h-3" />}
                        {req.status}
                      </span>

                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase border ${
                          isSupervisorReq
                            ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                            : isOpsCounterReq
                            ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                            : 'bg-slate-800 border-slate-700 text-slate-300'
                        }`}
                      >
                        {isSupervisorReq
                          ? 'By Supervisor · Audit Sign-Off'
                          : isOpsCounterReq
                          ? 'By Multi-Store Counter (Ops)'
                          : 'By Store Counter'}
                      </span>

                      <span className="text-[10px] font-mono text-slate-400">{req.id}</span>
                    </div>

                    <h4 className="text-sm font-bold text-white">
                      {req.sku} — {req.itemDescription}
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      {req.store} ({req.storeId}) · Requested by{' '}
                      <strong className="text-slate-200">{req.requestedByUsername}</strong> on{' '}
                      {req.requestedDate} {req.requestedTime}
                    </p>
                  </div>
                </div>

                {/* Original vs Proposed Diff */}
                {req.requestType === 'void' ? (
                  <div className="rounded-xl bg-rose-950/25 border border-rose-500/30 p-3 text-xs space-y-1">
                    <span className="text-[10px] font-bold uppercase text-rose-300 block">
                      Record Marked for Soft-Delete (Void)
                    </span>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-200 font-mono text-[11px]">
                      <span>Qty: {req.originalValues.countedQuantity}</span>
                      <span>Loc: {req.originalValues.location || '—'}</span>
                      <span>Cond: {req.originalValues.condition}</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-1">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">
                        Original Value
                      </span>
                      <div className="font-mono text-[11px] text-slate-300 space-y-0.5">
                        <div>Qty: <strong>{req.originalValues.countedQuantity}</strong></div>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-500" />
                          Loc: {req.originalValues.location || '—'}
                        </div>
                        <div>Item: {req.originalValues.sku} · {req.originalValues.condition}</div>
                        <div className="truncate">Desc: {req.originalValues.itemDescription}</div>
                        {req.originalValues.remarks && <div>Remarks: {req.originalValues.remarks}</div>}
                      </div>
                    </div>

                    <div className="rounded-xl bg-amber-950/20 border border-amber-500/30 p-3 space-y-1">
                      <span className="text-[10px] font-bold uppercase text-amber-300 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" /> Proposed Value
                      </span>
                      <div className="font-mono text-[11px] text-amber-200 space-y-0.5">
                        <div>
                          Qty:{' '}
                          <strong
                            className={
                              req.proposedValues.countedQuantity !== req.originalValues.countedQuantity
                                ? 'text-white underline'
                                : ''
                            }
                          >
                            {req.proposedValues.countedQuantity}
                          </strong>
                        </div>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-amber-400" />
                          Loc:{' '}
                          <span
                            className={
                              req.proposedValues.location !== req.originalValues.location
                                ? 'text-white font-bold underline'
                                : ''
                            }
                          >
                            {req.proposedValues.location || '—'}
                          </span>
                        </div>
                        <div>
                          Item: {req.proposedValues.sku} · {req.proposedValues.condition}
                        </div>
                        <div className="truncate">Desc: {req.proposedValues.itemDescription}</div>
                        {req.proposedValues.remarks && <div>Remarks: {req.proposedValues.remarks}</div>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Reason & Optional Attachment */}
                <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5 text-xs space-y-1.5">
                  <div>
                    <span className="text-slate-400 font-semibold">Reason: </span>
                    <span className="text-slate-200">{req.reason}</span>
                  </div>
                  {req.attachmentName && (
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80">
                      <Paperclip className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      {req.attachmentDataUrl ? (
                        <a
                          href={req.attachmentDataUrl}
                          download={req.attachmentName}
                          className="text-amber-300 hover:underline font-medium text-[11px]"
                        >
                          {req.attachmentName} (Download Attachment)
                        </a>
                      ) : (
                        <span className="text-slate-300 text-[11px]">{req.attachmentName}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Review Outcome or Action Buttons */}
                {!isPending ? (
                  <div className="border-t border-slate-800 pt-2.5 text-[11px] text-slate-400 flex flex-col gap-1">
                    <div>
                      {req.status === 'approved' ? 'Approved' : 'Rejected'} by{' '}
                      <strong className="text-slate-200">{req.reviewedByUsername}</strong> on{' '}
                      {req.reviewedDate} {req.reviewedTime}
                    </div>
                    {req.rejectionReason && (
                      <div className="text-rose-300 font-medium">
                        Rejection Reason: {req.rejectionReason}
                      </div>
                    )}
                  </div>
                ) : selfOwned ? (
                  <div className="rounded-xl bg-slate-950 border border-amber-500/30 p-2.5 flex items-center gap-2 text-xs text-amber-300 font-medium">
                    <Lock className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>
                      Self-approval prohibited — your request must be reviewed by an Audit user.
                    </span>
                  </div>
                ) : !reviewAllowed ? (
                  <div className="rounded-xl bg-indigo-950/30 border border-indigo-500/30 p-2.5 flex items-center gap-2 text-xs text-indigo-300 font-medium">
                    <Lock className="w-4 h-4 shrink-0 text-indigo-400" />
                    <span>
                      {isSupervisorReq
                        ? 'Audit Approval Required — supervisor correction and void requests can only be approved or rejected by an Audit user.'
                        : isOpsCounterReq
                        ? 'Ops Supervisor Approval Required — multi-store counter requests must be reviewed by the Operations Counter Supervisor.'
                        : 'Store Supervisor Approval Required — store counter requests must be reviewed by the Store Supervisor of that same store.'}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 pt-1 border-t border-slate-800">
                    <button
                      type="button"
                      disabled={processingId === req.id}
                      onClick={() => {
                        setRejectTarget(req);
                        setRejectionReason('');
                      }}
                      className="w-1/2 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 hover:bg-rose-500/25 text-xs font-bold text-rose-300 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Reject</span>
                    </button>
                    <button
                      type="button"
                      disabled={processingId === req.id}
                      onClick={() => handleApprove(req)}
                      className="w-1/2 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-lg transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {processingId === req.id
                          ? 'Applying...'
                          : req.requestType === 'void'
                          ? 'Approve Void'
                          : 'Approve & Apply'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Mandatory Rejection Reason Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
              <XCircle className="w-5 h-5 text-rose-400" />
              <span>Reject {rejectTarget.requestType === 'void' ? 'Void' : 'Correction'} Request</span>
            </div>
            <p className="text-xs text-slate-400">
              Provide a mandatory rejection reason for <strong>{rejectTarget.sku}</strong> ({rejectTarget.id}).
            </p>
            <form onSubmit={handleConfirmReject} className="space-y-3">
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this request is rejected..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder-slate-500 focus:border-rose-400 focus:outline-none"
                required
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingId === rejectTarget.id || !rejectionReason.trim()}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white disabled:opacity-50"
                >
                  {processingId === rejectTarget.id ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
