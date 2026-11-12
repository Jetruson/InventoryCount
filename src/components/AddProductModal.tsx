import React, { useState } from 'react';
import { Product } from '../types/inventory';
import { addProductToCatalog } from '../services/catalogService';
import { X, Plus, PackageCheck } from 'lucide-react';

interface AddProductModalProps {
  initialBarcode?: string;
  initialSku?: string;
  isOpen: boolean;
  onClose: () => void;
  onProductAdded: (newProduct: Product) => void;
}

export const AddProductModal: React.FC<AddProductModalProps> = ({
  initialBarcode = '',
  initialSku = '',
  isOpen,
  onClose,
  onProductAdded,
}) => {
  const [sku, setSku] = useState(initialSku || (initialBarcode ? `SKU-${initialBarcode.slice(-6)}` : ''));
  const [barcode, setBarcode] = useState(initialBarcode);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General Retail');
  const [unit, setUnit] = useState('pcs');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanItemNo = sku.trim().toUpperCase();
    if (!cleanItemNo) {
      setError('Item No. is required');
      return;
    }
    if (!description.trim()) {
      setError('Item Description is required');
      return;
    }

    const cleanBarcode = barcode.trim() || cleanItemNo;

    setIsSubmitting(true);
    setError(null);

    try {
      const added = await addProductToCatalog({
        sku: cleanItemNo,
        barcode: cleanBarcode,
        description: description.trim(),
        category: category.trim(),
        unit: unit.trim(),
      });
      onProductAdded(added);
      onClose();
    } catch (err: unknown) {
      setError('Could not add product to catalog. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-3">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 text-slate-100 shadow-2xl animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">Add New Item to Masterlist</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-rose-500/15 border border-rose-500/30 px-3 py-2 text-xs font-medium text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Item No. <span className="text-emerald-400">*</span>
            </label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g. APP-TEE-BLK-S"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none uppercase"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Item Description <span className="text-emerald-400">*</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Men's Cotton T-Shirt Black Small"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Barcode / Scanning Code <span className="text-slate-500 text-[10px] font-normal">(optional, defaults to Item No.)</span>
            </label>
            <input
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Leave empty to use Item No. as barcode"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Item Group</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="General Retail">General Retail</option>
                <option value="Apparel">Apparel</option>
                <option value="Electronics">Electronics</option>
                <option value="Grocery">Grocery</option>
                <option value="Home & Living">Home & Living</option>
                <option value="Health & Beauty">Health & Beauty</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">UoM (Unit of Measure)</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="pcs">Pieces (pcs)</option>
                <option value="box">Box (box)</option>
                <option value="pack">Pack (pack)</option>
                <option value="bag">Bag (bag)</option>
                <option value="tin">Tin (tin)</option>
                <option value="kg">Kilogram (kg)</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="w-1/2 rounded-xl border border-slate-700 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-lg hover:bg-emerald-500 active:scale-95 transition"
            >
              <Plus className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving...' : 'Save to Catalog'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
