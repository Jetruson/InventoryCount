import React, { useState, useEffect, useMemo } from 'react';
import {
  MapPin,
  Check,
  X,
  ShieldCheck,
  Lock,
  Search,
  Plus,
  Clock,
  AlertCircle,
  Barcode,
  Send,
} from 'lucide-react';
import { BarcodeScanner } from './BarcodeScanner';
import { playScanSuccessSound, playScanErrorSound } from '../utils/audioFeedback';
import {
  AppUser,
  CountingSession,
  LocationTag,
  LocationVerification,
  Store,
} from '../types/inventory';
import { requestLocationTag } from '../services/locationTagService';
import {
  doesRecordBelongToSession,
  getCountTypeShortLabel,
} from '../services/sessionService';

interface LocationPickerModalProps {
  isOpen: boolean;
  currentLocation: string;
  activeStoreId?: string;
  activeStore?: Store;
  currentUser?: AppUser;
  activeSession?: CountingSession | null;
  locationTags?: LocationTag[];
  locationVerifications?: LocationVerification[];
  canOverrideDoneLocation?: boolean;
  onClose: () => void;
  onSelectLocation: (newLocation: string) => void;
}

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  isOpen,
  currentLocation,
  activeStoreId,
  activeStore,
  currentUser,
  activeSession,
  locationTags = [],
  locationVerifications = [],
  canOverrideDoneLocation = false,
  onClose,
  onSelectLocation,
}) => {
  const [mode, setMode] = useState<'select' | 'scan' | 'request'>('select');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [scannedFeedback, setScannedFeedback] = useState<string | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [isScanPaused, setIsScanPaused] = useState<boolean>(false);

  // Supervisor Request New Location form state
  const [requestName, setRequestName] = useState<string>('');
  const [requestZone, setRequestZone] = useState<string>('');
  const [requestNotes, setRequestNotes] = useState<string>('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState<boolean>(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);

  const isSupervisor =
    currentUser?.role === 'supervisor' || currentUser?.role === 'ops_supervisor';

  useEffect(() => {
    if (isOpen) {
      setMode('select');
      setSearchQuery('');
      setScannedFeedback(null);
      setBlockedError(null);
      setIsScanPaused(false);
      setRequestName('');
      setRequestZone('');
      setRequestNotes('');
      setRequestError(null);
      setRequestSuccess(null);
    }
  }, [isOpen]);

  const storeScopedTags = useMemo(() => {
    if (!activeStoreId) return locationTags;
    return locationTags.filter((t) => t.storeId === activeStoreId);
  }, [locationTags, activeStoreId]);

  const approvedTags = useMemo(() => {
    return storeScopedTags
      .filter((t) => t.status === 'approved')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [storeScopedTags]);

  const pendingTags = useMemo(() => {
    return storeScopedTags
      .filter((t) => t.status === 'pending_approval')
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [storeScopedTags]);

  const rejectedTags = useMemo(() => {
    return storeScopedTags
      .filter((t) => t.status === 'rejected')
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [storeScopedTags]);

  const filteredApprovedTags = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return approvedTags;
    return approvedTags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.zone || '').toLowerCase().includes(q) ||
        (t.code || '').toLowerCase().includes(q)
    );
  }, [approvedTags, searchQuery]);

  const doneCountingLocations = useMemo(() => {
    return locationVerifications.filter((v) => {
      if (v.status !== 'verified' && !v.doneCounting) return false;
      if (activeStoreId && v.storeId !== activeStoreId) return false;
      if (activeSession && !doesRecordBelongToSession(v, activeSession)) return false;
      return true;
    });
  }, [locationVerifications, activeStoreId, activeSession]);

  const findDoneVerification = (locName: string) => {
    const clean = locName.trim().toLowerCase();
    if (!clean) return undefined;
    return doneCountingLocations.find((v) => v.location.trim().toLowerCase() === clean);
  };

  if (!isOpen) return null;

  const handleTapLocation = (locName: string) => {
    const cleanLoc = locName.trim();
    if (!cleanLoc) return;

    const alreadyDone = findDoneVerification(cleanLoc);
    if (alreadyDone && !canOverrideDoneLocation) {
      playScanErrorSound();
      setBlockedError(
        `Location "${alreadyDone.location}" is already verified and tagged Done Counting by ${alreadyDone.verifiedByName || 'Supervisor'}. Please tap another location.`
      );
      return;
    }

    playScanSuccessSound();
    setBlockedError(null);
    onSelectLocation(cleanLoc);
    onClose();
  };

  const handleLocationBarcodeScanned = (decoded: string) => {
    const trimmed = decoded.trim();
    if (!trimmed) return;

    setIsScanPaused(true);
    setScannedFeedback(trimmed);

    const lower = trimmed.toLowerCase();
    const matchedTag = approvedTags.find(
      (t) =>
        t.name.trim().toLowerCase() === lower ||
        (t.code && t.code.trim().toLowerCase() === lower)
    );

    if (!matchedTag) {
      playScanErrorSound();
      const pendingMatch = pendingTags.find(
        (t) =>
          t.name.trim().toLowerCase() === lower ||
          (t.code && t.code.trim().toLowerCase() === lower)
      );
      setBlockedError(
        pendingMatch
          ? `Location "${pendingMatch.name}" is still pending Admin approval and cannot be used yet.`
          : `"${trimmed}" is not an Admin-approved location tag for this store.`
      );
      return;
    }

    const alreadyDone = findDoneVerification(matchedTag.name);
    if (alreadyDone && !canOverrideDoneLocation) {
      playScanErrorSound();
      setBlockedError(
        `Location "${alreadyDone.location}" is already verified and tagged Done Counting.`
      );
      return;
    }

    playScanSuccessSound();
    setBlockedError(null);
    setTimeout(() => {
      onSelectLocation(matchedTag.name);
      onClose();
    }, 350);
  };

  const handleSubmitSupervisorRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !isSupervisor) return;
    setRequestError(null);
    setRequestSuccess(null);

    const trimmedName = requestName.trim();
    if (!trimmedName) {
      setRequestError('Please enter the location name to request.');
      return;
    }

    const targetStore: Store = activeStore || {
      storeId: activeStoreId || currentUser.assignedStoreId || 'ST-101',
      name: activeStore?.name || currentUser.assignedStoreName || activeStoreId || 'Store',
      location: '',
    };

    setIsSubmittingRequest(true);
    try {
      const created = await requestLocationTag({
        store: targetStore,
        name: trimmedName,
        zone: requestZone,
        notes: requestNotes,
        requester: currentUser,
        existingTags: locationTags,
      });
      playScanSuccessSound();
      setRequestName('');
      setRequestZone('');
      setRequestNotes('');
      setRequestSuccess(
        `Requested "${created.name}" for ${targetStore.name}. Awaiting Administrator approval before counters can select it.`
      );
    } catch (err: any) {
      playScanErrorSound();
      setRequestError(err?.message || 'Failed to submit location request.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xs p-3">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">Select Location Tag</h3>
              <p className="text-[11px] text-slate-400 truncate">
                {activeStore?.name || activeStoreId || 'Active Store'}
                {activeSession
                  ? ` · ${getCountTypeShortLabel(activeSession.countType)} (${activeSession.cutoffDate})`
                  : ''}{' '}
                · Tap to select
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="p-3 bg-slate-950 border-b border-slate-800 shrink-0">
          <div
            className={`grid ${
              isSupervisor ? 'grid-cols-3' : 'grid-cols-2'
            } p-1 bg-slate-900 rounded-xl border border-slate-800 text-xs font-semibold gap-1`}
          >
            <button
              type="button"
              onClick={() => {
                setMode('select');
                setBlockedError(null);
                setIsScanPaused(false);
              }}
              className={`min-h-[44px] px-2 rounded-lg transition flex items-center justify-center gap-1.5 ${
                mode === 'select'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Locations ({approvedTags.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('scan');
                setBlockedError(null);
                setScannedFeedback(null);
                setIsScanPaused(false);
              }}
              className={`min-h-[44px] px-2 rounded-lg transition flex items-center justify-center gap-1.5 ${
                mode === 'scan'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Barcode className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Scan Tag</span>
            </button>
            {isSupervisor && (
              <button
                type="button"
                onClick={() => {
                  setMode('request');
                  setBlockedError(null);
                  setIsScanPaused(false);
                }}
                className={`min-h-[44px] px-2 rounded-lg transition flex items-center justify-center gap-1.5 ${
                  mode === 'request'
                    ? 'bg-amber-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Request New</span>
              </button>
            )}
          </div>
        </div>

        {/* Body Content */}
        <div className="p-4 space-y-3.5 overflow-y-auto">
          {blockedError && (
            <div className="rounded-xl bg-amber-500/15 border border-amber-500/40 p-3 text-xs text-amber-200 flex items-start gap-2">
              <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{blockedError}</p>
            </div>
          )}

          {mode === 'select' && (
            <>
              {/* Search Filter */}
              {approvedTags.length > 4 && (
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter location tags or zones..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pl-9 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none min-h-[44px]"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3.5" />
                </div>
              )}

              {/* Clickable Admin-Approved Location Tags */}
              {approvedTags.length === 0 ? (
                <div className="rounded-2xl bg-slate-950 border border-slate-800 p-6 text-center space-y-3">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-white">
                      No approved location tags yet
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {isSupervisor
                        ? 'Ask an Administrator to add location tags for this store, or request a new location for Admin approval.'
                        : 'An Administrator must create or approve location tags for this store before you can select a location.'}
                    </p>
                  </div>
                  {isSupervisor && (
                    <button
                      type="button"
                      onClick={() => setMode('request')}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 px-4 min-h-[44px] text-xs font-bold text-white shadow active:scale-95 transition"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Request New Location</span>
                    </button>
                  )}
                </div>
              ) : filteredApprovedTags.length === 0 ? (
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-5 text-center text-xs text-slate-400">
                  No location tags match "{searchQuery}".
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredApprovedTags.map((tag) => {
                    const isCurrent =
                      tag.name.trim().toLowerCase() === currentLocation.trim().toLowerCase();
                    const doneRecord = findDoneVerification(tag.name);
                    const isLockedForUser = Boolean(doneRecord && !canOverrideDoneLocation);

                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => handleTapLocation(tag.name)}
                        className={`w-full text-left rounded-xl p-3 min-h-[54px] border transition active:scale-[0.99] flex items-center justify-between gap-3 ${
                          isCurrent
                            ? 'bg-emerald-500/15 border-emerald-400 text-white'
                            : isLockedForUser
                            ? 'bg-slate-950/60 border-slate-800/80 text-slate-400'
                            : 'bg-slate-950 border-slate-800 hover:border-emerald-500/50 text-slate-100'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold truncate">
                              {tag.name}
                            </span>
                            {isCurrent && (
                              <span className="text-[10px] font-bold uppercase text-emerald-300 shrink-0">
                                Active
                              </span>
                            )}
                          </div>
                          {(tag.zone || (tag.code && tag.code !== tag.name) || doneRecord) && (
                            <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                              {[
                                tag.zone ? `Zone: ${tag.zone}` : null,
                                tag.code && tag.code !== tag.name ? `Tag: ${tag.code}` : null,
                                doneRecord
                                  ? canOverrideDoneLocation
                                    ? `Done Counting · Tap to override`
                                    : `Done Counting · Verified by ${doneRecord.verifiedByName || 'Supervisor'}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </div>

                        <div className="shrink-0 flex items-center">
                          {isLockedForUser ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300">
                              <Lock className="w-3 h-3 text-amber-400" />
                              Closed
                            </span>
                          ) : doneRecord && canOverrideDoneLocation ? (
                            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-1 text-[10px] font-bold text-emerald-300">
                              <ShieldCheck className="w-3 h-3" />
                              Override
                            </span>
                          ) : isCurrent ? (
                            <Check className="w-5 h-5 text-emerald-400" />
                          ) : (
                            <span className="text-xs font-bold text-emerald-400">Select</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Pending Approval Locations (Non-selectable info for visibility) */}
              {pendingTags.length > 0 && (
                <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-amber-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      Pending Admin Approval ({pendingTags.length})
                    </span>
                    <span className="text-slate-500">Locked until approved</span>
                  </div>
                  <div className="space-y-1">
                    {pendingTags.map((pt) => (
                      <div
                        key={pt.id}
                        className="flex items-center justify-between text-[11px] text-slate-400 py-1 border-t border-slate-800/70 first:border-t-0"
                      >
                        <span className="font-mono text-slate-300 truncate">{pt.name}</span>
                        <span className="text-[10px] text-amber-300 shrink-0 ml-2">
                          By {pt.createdByName}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {mode === 'scan' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-300 font-medium text-center">
                Scan an Admin-approved shelf tag or bin barcode
              </div>
              <BarcodeScanner
                isScanningActive={isOpen && mode === 'scan'}
                isPaused={isScanPaused}
                pausedMessage={
                  blockedError
                    ? 'Location tag cannot be used — scan an approved tag'
                    : scannedFeedback
                    ? `Selected "${scannedFeedback}"`
                    : undefined
                }
                onResumeRequest={() => {
                  setBlockedError(null);
                  setScannedFeedback(null);
                  setIsScanPaused(false);
                }}
                onScan={handleLocationBarcodeScanned}
              />
              {scannedFeedback && !blockedError && (
                <div className="rounded-xl bg-emerald-600/20 border border-emerald-500/40 p-2.5 text-xs text-center font-bold text-emerald-300">
                  Matched approved tag: {scannedFeedback}
                </div>
              )}
            </div>
          )}

          {mode === 'request' && isSupervisor && (
            <div className="space-y-3.5">
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200 space-y-1">
                <p className="font-bold text-amber-300">Supervisor Location Request</p>
                <p className="text-[11px] leading-relaxed">
                  New locations added by supervisors stay locked until an Administrator approves them.
                </p>
              </div>

              {requestError && (
                <div className="rounded-xl bg-rose-500/15 border border-rose-500/40 p-2.5 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{requestError}</span>
                </div>
              )}

              {requestSuccess && (
                <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/40 p-2.5 text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{requestSuccess}</span>
                </div>
              )}

              <form onSubmit={handleSubmitSupervisorRequest} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Location Tag Name <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                    placeholder="e.g. Aisle 4 - Endcap B"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 min-h-[44px] text-xs font-mono text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Zone / Department (Optional)
                  </label>
                  <input
                    type="text"
                    value={requestZone}
                    onChange={(e) => setRequestZone(e.target.value)}
                    placeholder="e.g. Seasonal Display, Backroom"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 min-h-[44px] text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Reason / Notes for Admin (Optional)
                  </label>
                  <input
                    type="text"
                    value={requestNotes}
                    onChange={(e) => setRequestNotes(e.target.value)}
                    placeholder="e.g. New promotional gondola installed today"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 min-h-[44px] text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingRequest || !requestName.trim()}
                  className="w-full min-h-[48px] rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow-lg active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>
                    {isSubmittingRequest
                      ? 'Submitting Request...'
                      : 'Submit Location Request to Admin'}
                  </span>
                </button>
              </form>

              {(pendingTags.length > 0 || rejectedTags.length > 0) && (
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2">
                  <span className="text-[11px] font-bold text-slate-300 block">
                    Your Store Requests
                  </span>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {pendingTags.map((t) => (
                      <div
                        key={t.id}
                        className="text-[11px] flex items-center justify-between gap-2 py-1 border-b border-slate-800/70 last:border-b-0"
                      >
                        <span className="font-mono text-white truncate">{t.name}</span>
                        <span className="text-[10px] font-bold text-amber-300 shrink-0">
                          Pending Admin
                        </span>
                      </div>
                    ))}
                    {rejectedTags.map((t) => (
                      <div
                        key={t.id}
                        className="text-[11px] py-1 border-b border-slate-800/70 last:border-b-0 space-y-0.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-slate-300 truncate">{t.name}</span>
                          <span className="text-[10px] font-bold text-rose-400 shrink-0">
                            Rejected
                          </span>
                        </div>
                        {t.rejectionReason && (
                          <p className="text-[10px] text-rose-300/90">
                            Reason: {t.rejectionReason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
