import React, { useState, useEffect } from 'react';
import {
  InventoryCount,
  AppUser,
  CorrectionRequestType,
  ItemCondition,
  CorrectionRequest,
} from '../types/inventory';
import { submitCorrectionOrVoidRequest } from '../services/auditService';
import {
  X,
  FileEdit,
  Ban,
  AlertTriangle,
  Paperclip,
  Send,
  CheckCircle2,
  MapPin,
  Package,
} from 'lucide-react';

interface CorrectionRequestModalProps {
  isOpen: boolean;
  countRecord: InventoryCount | null;
  initialMode: CorrectionRequestType;
  currentUser: AppUser;
  onClose: () => void;
  onSubmitted: (req: CorrectionRequest) => void;
}

export const CorrectionRequestModal: React.FC<CorrectionRequestModalProps> = ({
  isOpen,
  countRecord,
  initialMode,
  currentUser,
  onClose,
  onSubmitted,
}) => {
  const [mode, setMode] = useState<CorrectionRequestType>(initialMode);
  const [proposedQty, setProposedQty] = useState<string>('0');
  const [proposedLocation, setProposedLocation] = useState<string>('');
  const [proposedSku, setProposedSku] = useState<string>('');
  const [proposedBarcode, setProposedBarcode] = useState<string>('');
  const [proposedDescription, setProposedDescription] = useState<string>('');
  const [proposedCondition, setProposedCondition] = useState<ItemCondition>('Good');
  const [proposedRemarks, setProposedRemarks] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [attachmentName, setAttachmentName] = useState<string | undefined>(undefined);
  const [attachmentDataUrl, setAttachmentDataUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && countRecord) {
      setMode(initialMode);
      setProposedQty(String(countRecord.countedQuantity));
      setProposedLocation(countRecord.location || '');
      setProposedSku(countRecord.sku || '');
      setProposedBarcode(countRecord.barcode || '');
      setProposedDescription(countRecord.itemDescription || '');
      setProposedCondition(countRecord.condition || 'Good');
      setProposedRemarks(countRecord.remarks || '');
      setReason('');
      setAttachmentName(undefined);
      setAttachmentDataUrl(undefined);
      setError(null);
    }
  }, [isOpen, countRecord, initialMode]);

  if (!isOpen || !countRecord) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      setError('Supporting attachment must be 200 KB or smaller.');
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setAttachmentName(file.name);
      setAttachmentDataUrl(typeof reader.result === 'string' ? reader.result : undefined);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!reason.trim()) {
      setError(
        mode === 'void'
          ? 'Please enter a mandatory reason for voiding this count record.'
          : 'Please enter a mandatory reason for this correction request.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const req = await submitCorrectionOrVoidRequest({
        count: countRecord,
        requestType: mode,
        proposedValues: {
          countedQuantity: Number(proposedQty),
          location: proposedLocation,
          sku: proposedSku,
          barcode: proposedBarcode,
          itemDescription: proposedDescription,
          condition: proposedCondition,
          remarks: proposedRemarks,
        },
        reason,
        currentUser,
        attachmentName,
        attachmentDataUrl,
      });
      onSubmitted(req);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xs p-3 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl overflow-hidden my-auto animate-in fade-in slide-in-from-bottom duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-white ${
                mode === 'void' ? 'bg-rose-600' : 'bg-amber-600'
              }`}
            >
              {mode === 'void' ? <Ban className="w-4 h-4" /> : <FileEdit className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {mode === 'void' ? 'Request Record Void' : 'Request Count Correction'}
              </h3>
              <p className="text-[11px] text-slate-400">
                Requires supervisor approval before changes take effect
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-5 pt-3">
          <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('correction');
                setError(null);
              }}
              className={`py-2 rounded-lg transition ${
                mode === 'correction'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Correction Request
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('void');
                setError(null);
              }}
              className={`py-2 rounded-lg transition ${
                mode === 'void'
                  ? 'bg-rose-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Void Record (Soft Delete)
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-3 text-xs font-medium text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Original Record Snapshot */}
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <span>Original Submitted Record</span>
              <span className="font-mono text-slate-500">{countRecord.id}</span>
            </div>
            <div className="font-bold text-white flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                {countRecord.sku} — {countRecord.itemDescription}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 text-[11px]">
              <div>
                <span className="text-slate-500 block">Qty</span>
                <span className="font-mono font-bold text-emerald-300">
                  {countRecord.countedQuantity}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Condition</span>
                <span className="font-semibold text-slate-200">{countRecord.condition || 'Good'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Location</span>
                <span className="font-mono text-slate-200 truncate block">
                  {countRecord.location || '—'}
                </span>
              </div>
            </div>
          </div>

          {mode === 'void' ? (
            <div className="rounded-xl bg-rose-950/30 border border-rose-500/30 p-3 text-xs text-rose-200 space-y-1">
              <div className="font-bold text-rose-300 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Soft-Delete / Void Policy</span>
              </div>
              <p className="text-[11px] text-rose-200/80 leading-relaxed">
                Voided counts are never permanently erased. Once approved by a supervisor, this record
                will be excluded from active inventory totals while remaining visible in the immutable Audit Trail.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Proposed Quantity <span className="text-amber-400">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={proposedQty}
                    onChange={(e) => setProposedQty(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono font-bold text-white focus:border-amber-400 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Proposed Classification
                  </label>
                  <select
                    value={proposedCondition}
                    onChange={(e) => setProposedCondition(e.target.value as ItemCondition)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white focus:border-amber-400 focus:outline-none"
                  >
                    <option value="Good">Good</option>
                    <option value="Damage">Damage</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Proposed Location
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={proposedLocation}
                    onChange={(e) => setProposedLocation(e.target.value)}
                    placeholder="e.g. Aisle 2 - Shelf B"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pl-8 text-xs font-mono text-white focus:border-amber-400 focus:outline-none"
                  />
                  <MapPin className="w-3.5 h-3.5 text-amber-400 absolute left-2.5 top-2.5" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Item No. / SKU
                  </label>
                  <input
                    type="text"
                    value={proposedSku}
                    onChange={(e) => setProposedSku(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-amber-400 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Barcode
                  </label>
                  <input
                    type="text"
                    value={proposedBarcode}
                    onChange={(e) => setProposedBarcode(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Item Description
                </label>
                <input
                  type="text"
                  value={proposedDescription}
                  onChange={(e) => setProposedDescription(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Remarks
                </label>
                <input
                  type="text"
                  value={proposedRemarks}
                  onChange={(e) => setProposedRemarks(e.target.value)}
                  placeholder="Optional updated remarks..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Mandatory Reason */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              {mode === 'void' ? 'Reason for Voiding' : 'Reason for Correction'}{' '}
              <span className="text-rose-400">*</span>
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                mode === 'void'
                  ? 'e.g. Duplicate scan submitted by mistake...'
                  : 'e.g. Misread outer carton quantity during initial scan...'
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
              required
            />
          </div>

          {/* Optional Supporting Attachment */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Supporting Attachment <span className="text-slate-500 font-normal">(optional, max 200 KB)</span>
            </label>
            <label className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-300 hover:border-slate-500 cursor-pointer transition">
              <div className="flex items-center gap-2 truncate">
                <Paperclip className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">
                  {attachmentName || 'Attach photo or document (optional)'}
                </span>
              </div>
              {attachmentName && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <input
                type="file"
                accept="image/*,.pdf,.txt,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          {/* Actions */}
          <div className="pt-2 flex gap-2.5 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="w-1/3 rounded-xl border border-slate-700 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-2/3 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold text-white shadow-lg active:scale-95 transition disabled:opacity-50 ${
                mode === 'void'
                  ? 'bg-rose-600 hover:bg-rose-500'
                  : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {isSubmitting
                  ? 'Submitting...'
                  : mode === 'void'
                  ? 'Submit Void Request'
                  : 'Submit Correction Request'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
