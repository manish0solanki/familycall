import { useCallback, useEffect, useRef, useState } from 'react';

type Facing = 'user' | 'environment';

const VIDEO: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

function describeMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Camera and microphone access is blocked. Allow access in your browser settings, then reload this page.';
    case 'NotFoundError':
      return 'No camera or microphone was found on this device.';
    case 'NotReadableError':
      return 'Your camera or microphone is being used by another app. Close it and reload this page.';
    default:
      return 'Could not start your camera and microphone.';
  }
}

/** The local camera + microphone stream, with mute / camera / flip controls. */
export function useLocalMedia() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facing, setFacing] = useState<Facing>('user');
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Video calls need a secure (https) connection and a modern browser.');
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { ...VIDEO, facingMode: 'user' }, audio: AUDIO })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setCanSwitchCamera(devices.filter((d) => d.kind === 'videoinput').length > 1);
      })
      .catch((err) => {
        if (!cancelled) setError(describeMediaError(err));
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !on));
      return !on;
    });
  }, []);

  const toggleCam = useCallback(() => {
    setCamOn((on) => {
      streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !on));
      return !on;
    });
  }, []);

  /** Switches front/back camera; returns the new video track so the call can send it. */
  const switchCamera = useCallback(async (): Promise<MediaStreamTrack | null> => {
    const s = streamRef.current;
    if (!s) return null;
    const next: Facing = facing === 'user' ? 'environment' : 'user';
    const old = s.getVideoTracks()[0];
    // Many phones can't open two cameras at once, so release the old one first.
    old?.stop();
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode: { ideal: next } } });
      const track = fresh.getVideoTracks()[0];
      track.enabled = camOn;
      if (old) s.removeTrack(old);
      s.addTrack(track);
      setFacing(next);
      return track;
    } catch (err) {
      console.error('[media] could not switch camera', err);
      // Try to get the previous camera back.
      const fallback = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode: { ideal: facing } } });
      const track = fallback.getVideoTracks()[0];
      track.enabled = camOn;
      if (old) s.removeTrack(old);
      s.addTrack(track);
      return track;
    }
  }, [facing, camOn]);

  return { stream, error, micOn, camOn, facing, canSwitchCamera, toggleMic, toggleCam, switchCamera };
}

export type LocalMedia = ReturnType<typeof useLocalMedia>;
