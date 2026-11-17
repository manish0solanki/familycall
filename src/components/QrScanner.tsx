import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import jsQR from 'jsqr';
import { Icon } from './Icon';

interface Props {
  /** Called with the decoded text. Return an error message to keep scanning, or null to stop. */
  onResult: (text: string) => string | null;
  onClose: () => void;
}

/** Longest side we decode at; plenty for a QR code and keeps phones fast. */
const MAX_DECODE_SIZE = 640;
const SCAN_INTERVAL_MS = 150;

function decode(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement, thorough: boolean) {
  const scale = Math.min(1, MAX_DECODE_SIZE / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(data, canvas.width, canvas.height, { inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert' });
}

/** Full-screen QR scanner using the back camera, with a "pick a photo" fallback. */
export function QrScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  if (!canvasRef.current && typeof document !== 'undefined') canvasRef.current = document.createElement('canvas');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
        const code = decode(video, video.videoWidth, video.videoHeight, canvas, false);
        if (code?.data) {
          const error = onResultRef.current(code.data);
          if (!error) return; // done; parent will close us
          setMessage(error);
        }
      }
      timer = setTimeout(tick, SCAN_INTERVAL_MS);
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser can’t open the camera here. Upload a photo of the QR code instead.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current!;
        video.srcObject = s;
        video.play().catch(() => {});
        tick();
      })
      .catch(() => setCameraError('Couldn’t open the camera. Allow camera access, or upload a photo of the QR code instead.'));

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canvasRef.current) return;
    setMessage('Reading photo…');
    try {
      const bitmap = await createImageBitmap(file);
      const code = decode(bitmap, bitmap.width, bitmap.height, canvasRef.current, true);
      bitmap.close();
      if (!code?.data) {
        setMessage('No QR code found in that photo. Try a clearer, closer picture.');
        return;
      }
      setMessage(onResult(code.data));
    } catch {
      setMessage('Couldn’t read that photo. Try another one.');
    }
  };

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Scan a QR code">
      {!cameraError && <video ref={videoRef} className="scanner__video" playsInline muted aria-hidden="true" />}
      <div className="scanner__overlay">
        <div className="scanner__top">
          <h2>Scan the invite QR code</h2>
          <button type="button" className="round-btn" onClick={onClose} aria-label="Close scanner">
            <Icon name="close" />
          </button>
        </div>
        {cameraError ? (
          <p className="scanner__error" role="alert">{cameraError}</p>
        ) : (
          <div className="scanner__frame" aria-hidden="true" />
        )}
        <div className="scanner__bottom">
          <p className="scanner__hint" role="status">{message ?? 'Point your camera at the QR code on the other phone or screen.'}</p>
          <button type="button" className="btn btn--light btn--lg" onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={22} />
            Upload a photo of the QR code
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} data-testid="qr-file" />
        </div>
      </div>
    </div>
  );
}
