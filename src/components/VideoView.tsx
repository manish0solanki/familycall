import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  className?: string;
  label: string;
}

/** A <video> bound to a MediaStream. */
export function VideoView({ stream, muted = false, mirrored = false, className, label }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

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
      aria-label={label}
    />
  );
}
