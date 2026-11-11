import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { playScanSuccessSound } from '../utils/audioFeedback';
import { Camera, CameraOff, Flashlight, FlashlightOff, RotateCcw } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (decodedText: string) => void;
  isScanningActive: boolean;
}

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onScan, isScanningActive }) => {
  const [scannerStarted, setScannerStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isHandlingScanRef = useRef<boolean>(false);
  const isTransitioningRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  // Initialize and clean up html5-qrcode instance safely
  useEffect(() => {
    isMountedRef.current = true;
    const readerElementId = 'html5-barcode-reader';

    // Ensure DOM container exists
    const container = document.getElementById(readerElementId);
    if (!container) return;

    const html5QrCode = new Html5Qrcode(readerElementId, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
      verbose: false,
    });
    scannerRef.current = html5QrCode;

    // Asynchronous safe cleanup: NEVER call clear() while isScanning is true!
    return () => {
      isMountedRef.current = false;
      const scanner = scannerRef.current;
      scannerRef.current = null;

      if (scanner) {
        if (scanner.isScanning) {
          scanner
            .stop()
            .then(() => {
              try {
                scanner.clear();
              } catch {
                // Ignore DOM clear errors after unmount
              }
            })
            .catch(() => {
              try {
                scanner.clear();
              } catch {
                // Ignore
              }
            });
        } else {
          try {
            scanner.clear();
          } catch {
            // Ignore
          }
        }
      }
    };
  }, []);

  // Manage start/stop camera based on isScanningActive
  useEffect(() => {
    let cancelled = false;

    async function manageCamera() {
      const scanner = scannerRef.current;
      if (!scanner) return;

      if (isScanningActive) {
        if (scanner.isScanning || isTransitioningRef.current) return;
        isTransitioningRef.current = true;
        setCameraError(null);

        try {
          const config = {
            fps: 12,
            qrbox: { width: 280, height: 180 },
            aspectRatio: 1.333,
          };

          await scanner.start(
            { facingMode: 'environment' },
            config,
            (decodedText) => {
              if (isHandlingScanRef.current) return;
              isHandlingScanRef.current = true;

              playScanSuccessSound();
              if (isMountedRef.current) {
                setLastScanned(decodedText);
              }
              onScan(decodedText);

              // 1.2s cooldown between scans
              setTimeout(() => {
                isHandlingScanRef.current = false;
              }, 1200);
            },
            () => {
              // Frame scan failure (expected during continuous feed)
            }
          );

          if (!cancelled && isMountedRef.current) {
            setScannerStarted(true);

            // Check torch support
            try {
              const capabilities = scanner.getRunningTrackCameraCapabilities();
              if (capabilities && capabilities.torchFeature().isSupported()) {
                setHasTorch(true);
              }
            } catch {
              setHasTorch(false);
            }
          }
        } catch (err: unknown) {
          if (!cancelled && isMountedRef.current) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn('Camera error:', msg);
            setCameraError(
              msg.includes('NotAllowedError') || msg.includes('Permission')
                ? 'Camera access denied. Please allow camera permissions in browser settings, or use manual entry below.'
                : 'Unable to start camera. You can use manual barcode entry below.'
            );
            setScannerStarted(false);
          }
        } finally {
          isTransitioningRef.current = false;
        }
      } else {
        // Stop scanning safely
        if (scanner.isScanning && !isTransitioningRef.current) {
          isTransitioningRef.current = true;
          try {
            await scanner.stop();
          } catch (err) {
            // Ignore already stopped
          } finally {
            isTransitioningRef.current = false;
            if (isMountedRef.current) {
              setScannerStarted(false);
              setIsTorchOn(false);
            }
          }
        }
      }
    }

    manageCamera();

    return () => {
      cancelled = true;
    };
  }, [isScanningActive, onScan]);

  const toggleTorch = async () => {
    const scanner = scannerRef.current;
    if (!scanner || !hasTorch || !scanner.isScanning) return;
    try {
      const nextTorch = !isTorchOn;
      await scanner.applyVideoConstraints({
        advanced: [{ torch: nextTorch } as MediaTrackConstraintSet],
      });
      setIsTorchOn(nextTorch);
    } catch (e) {
      console.warn('Torch toggle not supported:', e);
    }
  };

  const retryCamera = async () => {
    setCameraError(null);
    const scanner = scannerRef.current;
    if (scanner && scanner.isScanning) {
      try {
        await scanner.stop();
      } catch {}
    }
    setScannerStarted(false);
  };

  return (
    <div className="relative w-full rounded-2xl bg-slate-950 overflow-hidden border border-slate-800 shadow-xl">
      {/* Viewfinder Target Container */}
      <div className="relative aspect-4/3 w-full max-h-[300px] overflow-hidden bg-slate-950 flex items-center justify-center">
        <div id="html5-barcode-reader" className="w-full h-full object-cover" />

        {/* Framing Guides Overlay */}
        {scannerStarted && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* Darkened vignette around target box */}
            <div className="relative w-[280px] h-[160px] rounded-xl border-2 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]">
              {/* Corner accents */}
              <span className="absolute -top-1 -left-1 w-4 h-4 border-t-3 border-l-3 border-emerald-400 rounded-tl-sm" />
              <span className="absolute -top-1 -right-1 w-4 h-4 border-t-3 border-r-3 border-emerald-400 rounded-tr-sm" />
              <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-3 border-l-3 border-emerald-400 rounded-bl-sm" />
              <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-3 border-r-3 border-emerald-400 rounded-br-sm" />

              {/* Scanning laser line */}
              <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-0.5 bg-emerald-400/90 shadow-[0_0_8px_#34d399] animate-pulse" />

              <div className="absolute -bottom-7 left-0 right-0 text-center">
                <span className="rounded-md bg-slate-900/90 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  Align Barcode Inside Box
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Camera Starting / Loading State */}
        {!scannerStarted && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-6 text-center text-slate-400">
            <Camera className="w-10 h-10 text-emerald-500 mb-2 animate-bounce" />
            <p className="text-sm font-semibold text-slate-200">Opening Camera...</p>
            <p className="text-xs text-slate-400 mt-1 max-w-[240px]">
              Point phone camera at retail barcode tag
            </p>
          </div>
        )}

        {/* Camera Error / Permission Fallback View */}
        {cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/95 p-6 text-center text-slate-300 z-10">
            <CameraOff className="w-9 h-9 text-amber-400 mb-2" />
            <p className="text-sm font-bold text-white">Camera Unavailable</p>
            <p className="text-xs text-slate-400 mt-1.5 max-w-[280px] leading-relaxed">
              {cameraError}
            </p>
            <button
              onClick={retryCamera}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry Camera
            </button>
          </div>
        )}

        {/* Torch / Flashlight Button */}
        {scannerStarted && hasTorch && (
          <button
            onClick={toggleTorch}
            className={`absolute top-3 right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full border shadow-lg transition active:scale-90 ${
              isTorchOn
                ? 'bg-amber-400 border-amber-300 text-slate-950'
                : 'bg-slate-900/80 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title="Toggle Flashlight"
          >
            {isTorchOn ? <Flashlight className="w-5 h-5 fill-current" /> : <FlashlightOff className="w-5 h-5" />}
          </button>
        )}
      </div>

      {/* Last Scanned Feedback Chip */}
      {lastScanned && (
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/90 px-4 py-2 text-xs">
          <span className="text-slate-400">Last Scanned:</span>
          <span className="font-mono font-bold text-emerald-400">{lastScanned}</span>
        </div>
      )}
    </div>
  );
};
