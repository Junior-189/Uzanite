import { useState, useEffect, useRef } from 'react';
import { useLang } from '../context/LangContext';
import 'barcode-detector/polyfill';

export default function BarcodeScanner({ onScan, onClose }) {
  const { t } = useLang();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animRef = useRef(null);
  const activeRef = useRef(false);
  const foundRef = useRef(false);
  const [error, setError] = useState(null);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      activeRef.current = true;
      startBarcodeDetection();
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? t('scanner.camera_permission') : t('scanner.camera_error'));
    }
  };

  const startBarcodeDetection = () => {
    if (!('BarcodeDetector' in window)) {
      setError(t('scanner.not_supported'));
      return;
    }
    let detector;
    try {
      detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'code_93', 'itf', 'codabar'] });
    } catch {
      setError(t('scanner.not_supported'));
      return;
    }
    let lastDetect = 0;
    const detect = async () => {
      if (!activeRef.current || !videoRef.current || foundRef.current) return;
      // Throttle detection to ~3/s so low-end phones are not pegged every frame.
      const now = performance.now();
      if (now - lastDetect < 300) {
        animRef.current = requestAnimationFrame(detect);
        return;
      }
      lastDetect = now;
      if (videoRef.current.readyState < 2) {
        animRef.current = requestAnimationFrame(detect);
        return;
      }
      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes.length > 0) {
          foundRef.current = true;
          onScan(barcodes[0].rawValue);
          return;
        }
      } catch {}
      animRef.current = requestAnimationFrame(detect);
    };
    animRef.current = requestAnimationFrame(detect);
  };

  const stopCamera = () => {
    activeRef.current = false;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const capabilities = track.getCapabilities?.();
      if (!capabilities?.torch) return;
      const newTorch = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: newTorch }] });
      setTorchOn(newTorch);
    } catch {}
  };

  if (error) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6">
        <div className="bg-white/10 rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-camera text-2xl text-red-400"></i>
          </div>
          <p className="text-white text-sm mb-6">{error}</p>
          <button onClick={onClose} className="bg-white text-gray-900 px-6 py-2.5 rounded-xl font-semibold text-sm">{t('scanner.close')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-64 border-2 border-white/60 rounded-2xl">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary-400 rounded-tl-lg"></div>
          <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary-400 rounded-tr-lg"></div>
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary-400 rounded-bl-lg"></div>
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary-400 rounded-br-lg"></div>
          <div className="absolute inset-x-0 top-1/2 h-0.5 bg-primary-400/80 animate-scan-line"></div>
        </div>
      </div>
      <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between">
        <p className="text-white/80 text-sm font-medium">{t('scanner.point_camera')}</p>
        <div className="flex gap-2">
          <button onClick={toggleTorch} className="w-10 h-10 rounded-full bg-white/15 backdrop-blur flex items-center justify-center">
            <i className={`fas fa-bolt text-white text-sm ${torchOn ? 'text-yellow-300' : ''}`}></i>
          </button>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/15 backdrop-blur flex items-center justify-center">
            <i className="fas fa-times text-white text-sm"></i>
          </button>
        </div>
      </div>
      <div className="absolute bottom-0 inset-x-0 p-6 text-center">
        <p className="text-white/60 text-xs">{t('scanner.hold_steady')}</p>
      </div>
    </div>
  );
}
