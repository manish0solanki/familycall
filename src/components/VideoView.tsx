import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  className?: string;
  label: string;
  /** How the picture fills its box: crop to fill ('cover') or show it whole ('contain'). */
  fit?: 'cover' | 'contain';
  /** Called with the video's size whenever it changes (e.g. the sender rotates their phone). */
  onSize?: (width: number, height: number) => void;
}

/** A <video> bound to a MediaStream. */
export function VideoView({ stream, muted = false, mirrored = false, className, label, fit, onSize }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => el.videoWidth && onSizeRef.current?.(el.videoWidth, el.videoHeight);
    el.addEventListener('loadedmetadata', report);
    el.addEventListener('resize', report);
    // Some phones and tablets don't fire "resize" when the sender rotates; check every second too.
    const timer = onSizeRef.current ? setInterval(report, 1000) : null;
    return () => {
      el.removeEventListener('loadedmetadata', report);
      el.removeEventListener('resize', report);
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) el.play().catch(() => {/* autoplay is retried on the next user tap */});
  }, [stream]);

  return (
    <video
      ref={ref}
      className={`${className ?? ''}${mirrored ? ' mirrored' : ''}`}
      autoPlay
      playsInline
      muted={muted}
      style={fit ? { objectFit: fit } : undefined}
      aria-label={label}
    />
  );
}
