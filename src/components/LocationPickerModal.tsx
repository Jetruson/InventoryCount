import React, { useState } from 'react';
import { MapPin, Check, X } from 'lucide-react';
import { BarcodeScanner } from './BarcodeScanner';
import { playScanSuccessSound } from '../utils/audioFeedback';

interface LocationPickerModalProps {
  isOpen: boolean;
  currentLocation: string;
  onClose: () => void;
  onSelectLocation: (newLocation: string) => void;
}

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  isOpen,
  currentLocation,
  onClose,
  onSelectLocation,
}) => {
  const [manualInput, setManualInput] = useState<string>(currentLocation);
  const [mode, setMode] = useState<'manual' | 'scan'>('manual');
  const [scannedFeedback, setScannedFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = (locToSave?: string) => {
    const finalLoc = (locToSave || manualInput).trim();
    if (finalLoc) {
      onSelectLocation(finalLoc);
      onClose();
    }
  };

  const handleLocationBarcodeScanned = (decoded: string) => {
    const trimmed = decoded.trim();
    if (trimmed) {
      playScanSuccessSound();
      setScannedFeedback(trimmed);
      setManualInput(trimmed);
      setTimeout(() => {
        handleSave(trimmed);
      }, 500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xs p-3">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
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
        <div className="p-3 bg-slate-950 border-b border-slate-800">
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
        <div className="p-4 space-y-4">
          {mode === 'scan' ? (
            <div className="space-y-3">
              <div className="text-xs text-slate-300 font-medium text-center">
                Scan shelf tag or bin barcode sticker
              </div>
              <BarcodeScanner
                isScanningActive={isOpen && mode === 'scan'}
                onScan={handleLocationBarcodeScanned}
              />
              {scannedFeedback && (
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
                    onChange={(e) => setManualInput(e.target.value)}
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
                  disabled={!manualInput.trim()}
                  className="w-2/3 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3 text-xs font-bold text-white shadow-lg active:scale-95 transition disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>Set Location & Count</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
