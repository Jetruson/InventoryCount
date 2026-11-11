import React from 'react';
import { X, BookOpen, Database, Shield, Smartphone, Server, CheckCircle2 } from 'lucide-react';

interface DeploymentGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeploymentGuideModal: React.FC<DeploymentGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white">System Architecture & Deployment Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-xs leading-relaxed text-slate-300">
          {/* Section 1: Database Structure */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <Database className="w-4 h-4" />
              <h3>1. Firestore Database Structure</h3>
            </div>
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono space-y-2.5">
              <div>
                <span className="text-emerald-300 font-bold">/inventory_counts/{'{countId}'}</span>
                <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                  Stores each physical count record:
                </p>
                <div className="text-[11px] text-slate-400 pl-3 border-l border-slate-800 mt-1 space-y-0.5">
                  <div><strong className="text-slate-200">username</strong>: string (counter associate name)</div>
                  <div><strong className="text-slate-200">userId</strong>: string (auth UID)</div>
                  <div><strong className="text-slate-200">store</strong>: string (store name)</div>
                  <div><strong className="text-slate-200">storeId</strong>: string (e.g. ST-101)</div>
                  <div><strong className="text-slate-200">location</strong>: string (e.g. Aisle 1 - Shelf A, Bin B-104)</div>
                  <div><strong className="text-slate-200">sku</strong>: string (SKU code)</div>
                  <div><strong className="text-slate-200">barcode</strong>: string (scanned tag)</div>
                  <div><strong className="text-slate-200">itemDescription</strong>: string</div>
                  <div><strong className="text-slate-200">countedQuantity</strong>: number (validated &ge; 0)</div>
                  <div><strong className="text-slate-200">remarks</strong>: string (optional damage/note)</div>
                  <div><strong className="text-slate-200">date</strong>: string (YYYY-MM-DD)</div>
                  <div><strong className="text-slate-200">time</strong>: string (HH:mm:ss)</div>
                  <div><strong className="text-slate-200">createdAt</strong>: timestamp</div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-emerald-300 font-bold">/products/{'{productId}'}</span>
                <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                  Product master catalog with SKU, barcode, category, and unit.
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-emerald-300 font-bold">/stores/{'{storeId}'}</span>
                <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                  Retail store branches directory.
                </p>
              </div>
            </div>
          </section>

          {/* Section 2: Login System */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <Shield className="w-4 h-4" />
              <h3>2. Authentication & Security</h3>
            </div>
            <p>
              Uses Firebase Authentication (Email/Password) with custom display names and role separation:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li><strong className="text-slate-200">Counter Role</strong>: Scans barcodes, records physical stock counts, and accesses personal history.</li>
              <li><strong className="text-slate-200">Supervisor Role</strong>: Accesses all store submissions, user breakdowns, and Excel data export.</li>
              <li><strong className="text-slate-200">Hardened Rules</strong>: ABAC rules in <code className="text-emerald-400">firestore.rules</code> enforce user identity, schema validation, and quantity bounds (&ge; 0).</li>
            </ul>
          </section>

          {/* Section 3: Android Mobile PWA Deployment */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <Smartphone className="w-4 h-4" />
              <h3>3. Android Mobile & Chrome PWA Deployment</h3>
            </div>
            <div className="space-y-2 text-slate-400">
              <p>
                The app is fully PWA compliant and installable on Android devices running Google Chrome:
              </p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Open the app URL in <strong className="text-slate-200">Chrome on Android</strong>.</li>
                <li>Tap the in-app <strong className="text-emerald-400">"Install App"</strong> button in the top bar, or tap Chrome's three dots <strong className="text-slate-200">&gt; Install app / Add to Home screen</strong>.</li>
                <li>The app launches standalone without browser URL bars, granting full hardware camera access for high-speed barcode scanning.</li>
                <li><strong className="text-slate-200">Offline Resilience</strong>: When store Wi-Fi drops, counts are queued locally and automatically synced once signal recovers.</li>
              </ol>
            </div>
          </section>

          {/* Section 4: Production Build Commands */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <Server className="w-4 h-4" />
              <h3>4. Build & Production Hosting</h3>
            </div>
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-[11px] space-y-1">
              <div className="text-slate-500"># 1. Build optimized PWA bundle with service worker</div>
              <div className="text-emerald-300">npm run build</div>
              <div className="text-slate-500 mt-2"># 2. Preview or host on Cloud Run / Firebase Hosting / Vercel</div>
              <div className="text-emerald-300">firebase deploy --only hosting</div>
            </div>
          </section>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
