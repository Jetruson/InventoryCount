import React, { useState, useEffect, useMemo } from 'react';
import { MapPin, Check, X, ShieldCheck, Lock } from 'lucide-react';
import { BarcodeScanner } from './BarcodeScanner';
import { playScanSuccessSound, playScanErrorSound } from '../utils/audioFeedback';
import { LocationVerification } from '../types/inventory';

interface LocationPickerModalProps {
  isOpen: boolean;
  currentLocation: string;
  activeStoreId?: string;
  locationVerifications?: LocationVerification[];
  canOverrideDoneLocation?: boolean;
  onClose: () => void;
  onSelectLocation: (newLocation: string) => void;
}

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  isOpen,
  currentLocation,
  activeStoreId,
  locationVerifications = [],
  canOverrideDoneLocation = false,
  onClose,
  onSelectLocation,
}) => {
  const [manualInput, setManualInput] = useState<string>(currentLocation);
  const [mode, setMode] = useState<'manual' | 'scan'>('manual');
  const [scannedFeedback, setScannedFeedback] = useState<string | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setManualInput(currentLocation);
      setScannedFeedback(null);
      setBlockedError(null);
    }
  }, [isOpen, currentLocation]);

  const doneCountingLocations = useMemo(() => {
    return locationVerifications.filter((v) => {
      if (v.status !== 'verified' && !v.doneCounting) return false;
      if (activeStoreId && v.storeId !== activeStoreId) return false;
      return true;
    });
  }, [locationVerifications, activeStoreId]);

  const findDoneVerification = (locName: string) => {
    const clean = locName.trim().toLowerCase();
    if (!clean) return undefined;
    return doneCountingLocations.find((v) => v.location.trim().toLowerCase() === clean);
  };

  const matchedDoneLocation = useMemo(
    () => findDoneVerification(manualInput),
    [manualInput, doneCountingLocations]
  );

  if (!isOpen) return null;

  const handleSave = (locToSave?: string) => {
    const finalLoc = (locToSave || manualInput).trim();
    if (!finalLoc) return;

    const alreadyDone = findDoneVerification(finalLoc);
    if (alreadyDone && !canOverrideDoneLocation) {
      playScanErrorSound();
      setBlockedError(
        `Location "${alreadyDone.location}" is already verified and tagged Done Counting by ${alreadyDone.verifiedByName || 'Supervisor'}. Please choose another location.`
      );
      return;
    }

    setBlockedError(null);
    onSelectLocation(finalLoc);
    onClose();
  };

  const handleLocationBarcodeScanned = (decoded: string) => {
    const trimmed = decoded.trim();
    if (trimmed) {
      setScannedFeedback(trimmed);
      setManualInput(trimmed);
      const alreadyDone = findDoneVerification(trimmed);
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
        handleSave(trimmed);
      }, 500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xs p-3">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <MapPin className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Set Counting Location</h3>
              <p className="text-[11px] text-slate-400">Multiple items will be counted here</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="p-3 bg-slate-950 border-b border-slate-800 shrink-0">
          <div className="grid grid-cols-2 p-1 bg-slate-900 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`py-2 rounded-lg transition ${
                mode === 'manual' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Manual Location Entry
            </button>
            <button
              type="button"
              onClick={() => setMode('scan')}
              className={`py-2 rounded-lg transition ${
                mode === 'scan' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Scan Location Barcode
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {(blockedError || matchedDoneLocation) && (
            <div className="rounded-xl bg-amber-500/15 border border-amber-500/40 p-3 text-xs text-amber-200 flex items-start gap-2">
              <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-amber-300">
                  {canOverrideDoneLocation
                    ? 'Location Tagged: Done Counting (Supervisor Override)'
                    : 'Location Tagged: Done Counting'}
                </p>
                <p className="text-[11px] mt-0.5">
                  {blockedError ||
                    (canOverrideDoneLocation
                      ? `"${matchedDoneLocation?.location}" was verified by ${matchedDoneLocation?.verifiedByName || 'Supervisor'}, and as a Supervisor you can still select it to add counts.`
                      : `"${matchedDoneLocation?.location}" has already been verified by ${matchedDoneLocation?.verifiedByName || 'Supervisor'} and tagged Done Counting.`)}
                </p>
              </div>
            </div>
          )}

          {mode === 'scan' ? (
            <div className="space-y-3">
              <div className="text-xs text-slate-300 font-medium text-center">
                Scan shelf tag or bin barcode sticker
              </div>
              <BarcodeScanner
                isScanningActive={isOpen && mode === 'scan'}
                onScan={handleLocationBarcodeScanned}
              />
              {scannedFeedback && !blockedError && (
                <div className="rounded-xl bg-emerald-600/20 border border-emerald-500/40 p-2.5 text-xs text-center font-bold text-emerald-300">
                  Scanned: {scannedFeedback} — Setting location...
                </div>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
              className="space-y-3.5"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Location Code / Shelf Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={manualInput}
                    onChange={(e) => {
                      setManualInput(e.target.value);
                      setBlockedError(null);
                    }}
                    placeholder="e.g. Aisle 3 - Shelf B, Bin 402, Rack 12"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 pl-10 text-sm font-mono text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    autoFocus
                  />
                  <MapPin className="absolute left-3.5 top-3.5 w-4 h-4 text-emerald-400" />
                </div>
              </div>

              <div className="pt-2 flex gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-1/3 rounded-xl border border-slate-700 py-3 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!manualInput.trim() || (!canOverrideDoneLocation && Boolean(matchedDoneLocation))}
                  className="w-2/3 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3 text-xs font-bold text-white shadow-lg active:scale-95 transition disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {matchedDoneLocation
                      ? canOverrideDoneLocation
                        ? 'Select Done Location & Count'
                        : 'Already Done Counting'
                      : 'Set Location & Count'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {/* List of Verified / Done Counting Locations in Active Store */}
          {doneCountingLocations.length > 0 && (
            <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Done Counting Locations ({doneCountingLocations.length})
                </span>
                <span className="text-slate-500">
                  {canOverrideDoneLocation ? 'Tap to select (Supervisor)' : 'Verified & Closed'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {doneCountingLocations.map((v) =>
                  canOverrideDoneLocation ? (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => handleSave(v.location)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-400/60 px-2 py-1 text-[11px] font-mono text-emerald-300 transition active:scale-95"
                      title={`Verified by ${v.verifiedByName || 'Supervisor'} — tap to add count`}
                    >
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>{v.location}</span>
                      <span className="text-[9px] font-sans font-black uppercase bg-emerald-500/20 px-1 rounded text-emerald-200">
                        Done Counting
                      </span>
                    </button>
                  ) : (
                    <span
                      key={v.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 text-[11px] font-mono text-emerald-300"
                      title={`Verified by ${v.verifiedByName || 'Supervisor'}`}
                    >
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>{v.location}</span>
                      <span className="text-[9px] font-sans font-black uppercase bg-emerald-500/20 px-1 rounded text-emerald-200">
                        Done Counting
                      </span>
                    </span>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
