import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EffectsProcessor, type EffectsStatus } from '../effects/processor';
import { loadEffects, needsProcessing, saveEffects, type EffectSettings } from '../effects/settings';

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

/**
 * The local camera + microphone, with mute / camera / flip controls and video effects.
 *
 * `stream` is what the call sends: the microphone plus either the raw camera or the
 * effects-processed video. It stays the same MediaStream object; when its video track
 * changes, `videoVersion` increases so the call can swap the track it's sending.
 */
export function useLocalMedia() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoVersion, setVideoVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facing, setFacing] = useState<Facing>('user');
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const [effects, setEffectsState] = useState<EffectSettings>(loadEffects);
  const [effectsStatus, setEffectsStatus] = useState<EffectsStatus | 'off'>('off');

  /** Straight from the camera and microphone. */
  const rawRef = useRef<MediaStream | null>(null);
  /** What we send: mic + (raw or processed) video. */
  const outRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<EffectsProcessor | null>(null);
  const camOnRef = useRef(true);

  const setOutgoingVideo = useCallback((track: MediaStreamTrack) => {
    const out = outRef.current;
    if (!out) return;
    for (const t of out.getVideoTracks()) if (t !== track) out.removeTrack(t);
    if (!out.getVideoTracks().includes(track)) out.addTrack(track);
    track.enabled = camOnRef.current;
    setVideoVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Video calls need a secure (https) connection and a modern browser.');
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { ...VIDEO, facingMode: 'user' }, audio: AUDIO })
      .then(async (raw) => {
        if (cancelled) {
          raw.getTracks().forEach((t) => t.stop());
          return;
        }
        rawRef.current = raw;
        outRef.current = new MediaStream(raw.getTracks());
        setStream(outRef.current);
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setCanSwitchCamera(devices.filter((d) => d.kind === 'videoinput').length > 1);
      })
      .catch((err) => {
        if (!cancelled) setError(describeMediaError(err));
      });

    return () => {
      cancelled = true;
      processorRef.current?.dispose();
      processorRef.current = null;
      rawRef.current?.getTracks().forEach((t) => t.stop());
      rawRef.current = null;
      outRef.current = null;
    };
  }, []);

  // Start, update or stop the effects processor when the settings change.
  useEffect(() => {
    const raw = rawRef.current;
    const rawVideo = raw?.getVideoTracks()[0];
    if (!stream || !rawVideo) return;

    if (needsProcessing(effects)) {
      if (processorRef.current) {
        processorRef.current.setSettings(effects);
      } else {
        const processor = new EffectsProcessor(rawVideo, effects, setEffectsStatus);
        processorRef.current = processor;
        setOutgoingVideo(processor.track);
      }
    } else if (processorRef.current) {
      processorRef.current.dispose();
      processorRef.current = null;
      setEffectsStatus('off');
      setOutgoingVideo(rawVideo);
    }
  }, [effects, stream, setOutgoingVideo]);

  const setEffects = useCallback((next: EffectSettings) => {
    setEffectsState(next);
    saveEffects(next);
  }, []);

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      rawRef.current?.getAudioTracks().forEach((t) => (t.enabled = !on));
      return !on;
    });
  }, []);

  const toggleCam = useCallback(() => {
    setCamOn((on) => {
      camOnRef.current = !on;
      rawRef.current?.getVideoTracks().forEach((t) => (t.enabled = !on));
      outRef.current?.getVideoTracks().forEach((t) => (t.enabled = !on));
      return !on;
    });
  }, []);

  /** Switches front/back camera. The outgoing video updates on its own (watch `videoVersion`). */
  const switchCamera = useCallback(async () => {
    const raw = rawRef.current;
    if (!raw) return;
    const next: Facing = facing === 'user' ? 'environment' : 'user';
    const old = raw.getVideoTracks()[0];
    // Many phones can't open two cameras at once, so release the old one first.
    old?.stop();
    let track: MediaStreamTrack;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode: { ideal: next } } });
      track = fresh.getVideoTracks()[0];
      setFacing(next);
    } catch (err) {
      console.error('[media] could not switch camera', err);
      // Get the previous camera back.
      const fallback = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode: { ideal: facing } } });
      track = fallback.getVideoTracks()[0];
    }
    track.enabled = camOnRef.current;
    if (old) raw.removeTrack(old);
    raw.addTrack(track);
    if (processorRef.current) processorRef.current.setSource(track);
    else setOutgoingVideo(track);
  }, [facing, setOutgoingVideo]);

  /** Video-only stream for on-screen previews; a new object whenever the video track changes. */
  const previewStream = useMemo(() => {
    void videoVersion;
    const video = stream?.getVideoTracks()[0];
    return video ? new MediaStream([video]) : null;
  }, [stream, videoVersion]);

  return {
    stream,
    previewStream,
    videoVersion,
    error,
    micOn,
    camOn,
    facing,
    canSwitchCamera,
    toggleMic,
    toggleCam,
    switchCamera,
    effects,
    setEffects,
    effectsStatus,
  };
}

export type LocalMedia = ReturnType<typeof useLocalMedia>;
