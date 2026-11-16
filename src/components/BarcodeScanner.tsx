import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Html5Qrcode,
  Html5QrcodeScannerState,
  Html5QrcodeSupportedFormats,
} from 'html5-qrcode';
import { Camera, CameraOff, Flashlight, FlashlightOff, PauseCircle, Play, RotateCcw } from 'lucide-react';

interface BarcodeScannerProps {
  onScan: (decodedText: string) => void;
  isScanningActive: boolean;
  isPaused?: boolean;
  pausedMessage?: string;
  onResumeRequest?: () => void;
}

const RETAIL_AND_QR_FORMATS: Html5QrcodeSupportedFormats[] = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.QR_CODE,
];

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  onScan,
  isScanningActive,
  isPaused = false,
  pausedMessage,
  onResumeRequest,
}) => {
  const reactId = useId();
  const readerElementId = `html5-barcode-reader-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const [scannerStarted, setScannerStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  const isPausedRef = useRef(isPaused);
  const isHandlingScanRef = useRef<boolean>(false);
  const isTransitioningRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep latest callback and pause flag in refs so camera stream never restarts on parent re-renders
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Initialize and clean up html5-qrcode instance safely
  useEffect(() => {
    isMountedRef.current = true;

    const container = document.getElementById(readerElementId);
    if (!container) return;

    const html5QrCode = new Html5Qrcode(readerElementId, {
      formatsToSupport: RETAIL_AND_QR_FORMATS,
      useBarCodeDetectorIfSupported: true,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true,
      },
      verbose: false,
    });
    scannerRef.current = html5QrCode;

    return () => {
      isMountedRef.current = false;
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }

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
  }, [readerElementId]);

  // Manage start/stop camera lifecycle strictly from isScanningActive
  useEffect(() => {
    let cancelled = false;

    async function manageCamera() {
      const scanner = scannerRef.current;
      if (!scanner) return;

      if (isScanningActive) {
        if (scanner.isScanning || isTransitioningRef.current) return;
        isTransitioningRef.current = true;
        isHandlingScanRef.current = false;
        setCameraError(null);

        try {
          const config = {
            fps: 15,
            disableFlip: true,
            aspectRatio: 1.333,
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
              width: Math.max(160, Math.min(280, Math.floor(viewfinderWidth * 0.84))),
              height: Math.max(110, Math.min(165, Math.floor(viewfinderHeight * 0.62))),
            }),
            videoConstraints: {
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          };

          await scanner.start(
            { facingMode: 'environment' },
            config,
            (decodedText) => {
              if (isPausedRef.current || isHandlingScanRef.current) return;
              isHandlingScanRef.current = true;

              if (isMountedRef.current) {
                setLastScanned(decodedText);
              }
              onScanRef.current(decodedText);

              // Fallback release only if parent does not pause the scanner
              if (cooldownTimerRef.current) {
                clearTimeout(cooldownTimerRef.current);
              }
              cooldownTimerRef.current = setTimeout(() => {
                if (!isPausedRef.current) {
                  isHandlingScanRef.current = false;
                }
              }, 800);
            },
            () => {
              // Frame scan miss (expected during continuous camera feed)
            }
          );

          if (!cancelled && isMountedRef.current) {
            setScannerStarted(true);

            // Enable torch capability & continuous autofocus hint if supported by camera track
            try {
              const capabilities = scanner.getRunningTrackCameraCapabilities();
              if (capabilities && capabilities.torchFeature().isSupported()) {
                setHasTorch(true);
              } else {
                setHasTorch(false);
              }

              const trackCaps = scanner.getRunningTrackCapabilities() as MediaTrackCapabilities & {
                focusMode?: string[];
              };
              if (Array.isArray(trackCaps?.focusMode) && trackCaps.focusMode.includes('continuous')) {
                await scanner.applyVideoConstraints({
                  advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
                });
              }
            } catch {
              // Ignore unsupported track capabilities
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
        if (scanner.isScanning && !isTransitioningRef.current) {
          isTransitioningRef.current = true;
          try {
            await scanner.stop();
          } catch {
            // Ignore already stopped
          } finally {
            isTransitioningRef.current = false;
            isHandlingScanRef.current = false;
            if (isMountedRef.current) {
              setScannerStarted(false);
              setIsTorchOn(false);
              setHasTorch(false);
            }
          }
        }
      }
    }

    manageCamera();

    return () => {
      cancelled = true;
    };
  }, [isScanningActive]);

  // Warm pause/resume decoder without tearing down camera MediaStream
  useEffect(() => {
    const scanner = scannerRef.current;
    if (!scanner || !scannerStarted || isTransitioningRef.current) return;

    try {
      const state = scanner.getState();
      if (isPaused && state === Html5QrcodeScannerState.SCANNING) {
        scanner.pause(true);
      } else if (!isPaused) {
        isHandlingScanRef.current = false;
        if (state === Html5QrcodeScannerState.PAUSED) {
          scanner.resume();
        }
      }
    } catch {
      // Ignore transient state errors during unmount/stop
    }
  }, [isPaused, scannerStarted]);

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
      } catch {
        // Ignore
      }
    }
    isHandlingScanRef.current = false;
    setScannerStarted(false);
  };

  return (
    <div className="relative w-full rounded-2xl bg-slate-950 overflow-hidden border border-slate-800 shadow-xl">
      {/* Viewfinder Target Container */}
      <div className="relative aspect-4/3 w-full max-h-[300px] overflow-hidden bg-slate-950 flex items-center justify-center">
        <div
          id={readerElementId}
          className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover [&>div]:!hidden"
        />

        {/* Active Scanning Framing Guides Overlay */}
        {scannerStarted && !isPaused && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative w-[260px] max-w-[84%] h-[150px] rounded-xl border-2 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]">
              <span className="absolute -top-1 -left-1 w-4 h-4 border-t-3 border-l-3 border-emerald-400 rounded-tl-sm" />
              <span className="absolute -top-1 -right-1 w-4 h-4 border-t-3 border-r-3 border-emerald-400 rounded-tr-sm" />
              <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-3 border-l-3 border-emerald-400 rounded-bl-sm" />
              <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-3 border-r-3 border-emerald-400 rounded-br-sm" />

              {/* Steady alignment laser line */}
              <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-0.5 bg-emerald-400/90 shadow-[0_0_8px_#34d399]" />

              <div className="absolute -bottom-7 left-0 right-0 text-center">
                <span className="rounded-md bg-slate-900/90 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  Align Barcode Inside Box
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Warm Paused Overlay (Camera stays ready for instant resume after Save) */}
        {scannerStarted && isPaused && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-xs p-5 text-center">
            <PauseCircle className="w-9 h-9 text-amber-400 mb-2" />
            <p className="text-sm font-bold text-white">Scanner Paused</p>
            <p className="text-xs text-slate-300 mt-1 max-w-[240px]">
              {pausedMessage || 'Save current count to resume scanning'}
            </p>
            {onResumeRequest && (
              <button
                type="button"
                onClick={onResumeRequest}
                className="mt-3 min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-lg active:scale-95 transition"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Resume Scanning</span>
              </button>
            )}
          </div>
        )}

        {/* Camera Starting / Loading State */}
        {!scannerStarted && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-6 text-center text-slate-400">
            <Camera className="w-10 h-10 text-emerald-500 mb-2" />
            <p className="text-sm font-semibold text-slate-200">Opening Camera...</p>
            <p className="text-xs text-slate-400 mt-1 max-w-[240px]">
              Point phone camera at retail barcode or QR tag
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
              type="button"
              onClick={retryCamera}
              className="mt-3 min-h-[44px] flex items-center gap-1.5 rounded-xl bg-slate-800 border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <RotateCcw className="w-4 h-4" />
              Retry Camera
            </button>
          </div>
        )}

        {/* Torch / Flashlight Button (44px+ touch hitbox) */}
        {scannerStarted && hasTorch && !isPaused && (
          <button
            type="button"
            onClick={toggleTorch}
            className={`absolute top-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border shadow-lg transition active:scale-90 ${
              isTorchOn
                ? 'bg-amber-400 border-amber-300 text-slate-950'
                : 'bg-slate-900/80 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title="Toggle Flashlight"
            aria-label="Toggle Flashlight"
          >
            {isTorchOn ? <Flashlight className="w-5 h-5 fill-current" /> : <FlashlightOff className="w-5 h-5" />}
          </button>
        )}
      </div>

      {/* Last Scanned Feedback Footer */}
      {lastScanned && (
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/90 px-4 py-2 text-xs">
          <span className="text-slate-400">Last Scanned:</span>
          <span className="font-mono font-bold text-emerald-400">{lastScanned}</span>
        </div>
      )}
    </div>
  );
};
