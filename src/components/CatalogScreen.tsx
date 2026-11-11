import React, { useState, useEffect } from 'react';
import { Product } from '../types/inventory';
import { fetchCatalog, getLocalCatalog } from '../services/catalogService';
import { AddProductModal } from './AddProductModal';
import { Package, Search, Plus, Barcode, Tag, Sparkles } from 'lucide-react';

interface CatalogScreenProps {
  onSelectProductForCount?: (product: Product) => void;
}

export const CatalogScreen: React.FC<CatalogScreenProps> = ({ onSelectProductForCount }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);

  useEffect(() => {
    // Initial local read
    setProducts(getLocalCatalog());

    // Background fetch from Firestore
    fetchCatalog().then((fetched) => {
      setProducts(fetched);
    });
  }, []);

  const categories = Array.from(new Set(products.map((p) => p.category || 'General')));

  const filteredProducts = products.filter((p) => {
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchSku = p.sku.toLowerCase().includes(q);
      const matchBarcode = p.barcode.toLowerCase().includes(q);
      const matchDesc = p.description.toLowerCase().includes(q);
      if (!matchSku && !matchBarcode && !matchDesc) return false;
    }
    return true;
  });

  return (
    <div className="w-full max-w-4xl mx-auto pb-24 pt-2 px-3.5 space-y-4">
      {/* Top Header */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-md flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-400 font-medium">Product Master Catalog</span>
          <h2 className="text-lg font-black text-white">{filteredProducts.length} Items Listed</h2>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white shadow-md active:scale-95 transition flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>Add SKU</span>
        </button>
      </div>

      {/* Search & Filter */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3 shadow-md space-y-2.5">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search catalog by SKU, barcode, title..."
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pl-9 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition ${
              categoryFilter === 'all'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            All Categories
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition ${
                categoryFilter === c
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filteredProducts.map((p) => (
          <div
            key={p.sku}
            className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm hover:border-slate-700 transition flex flex-col justify-between space-y-3"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-emerald-500/15 text-emerald-400 px-2 py-0.5 font-mono text-xs font-bold">
                  {p.sku}
                </span>
                <span className="text-[11px] text-slate-400">{p.category}</span>
              </div>
              <h3 className="mt-2 text-sm font-bold text-white leading-snug">{p.description}</h3>
            </div>

            <div className="border-t border-slate-800 pt-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-slate-400 font-mono">
                <Barcode className="w-3.5 h-3.5 text-slate-500" />
                <span>{p.barcode}</span>
              </div>

              {onSelectProductForCount && (
                <button
                  onClick={() => onSelectProductForCount(p)}
                  className="rounded-lg bg-slate-800 hover:bg-emerald-600 hover:text-white px-2.5 py-1 text-[11px] font-semibold text-emerald-400 transition"
                >
                  Count Item →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <AddProductModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onProductAdded={(newProd) => {
          setProducts((prev) => [newProd, ...prev]);
        }}
      />
    </div>
  );
};
