import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EffectsProcessor, type EffectsStatus } from '../effects/processor';
import { loadEffects, needsProcessing, saveEffects, type EffectSettings } from '../effects/settings';

type Facing = 'user' | 'environment';

/**
 * Ask every camera for its normal 1280×720 picture. Phones turn it upright to match how
 * they're held (upright → 720×1280).
 *
 * Don't ask for a particular shape (e.g. 720×1280 or an aspect ratio): Android Chrome
 * matches that against the camera's wide sensor modes *before* turning the picture, so it
 * crops a small, zoomed-in strip. And don't set resizeMode: 'none': then Android Chrome
 * hands over frames that aren't turned upright yet, and the effects step (which redraws
 * each frame on a canvas) sends them sideways.
 */
function videoConstraints(view: CameraView): MediaTrackConstraints {
  // "Wide angle" asks for the camera's 4:3 mode: the whole sensor, so more of the room
  // fits (16:9 video leaves part of a phone's 4:3 sensor unused).
  return { width: { ideal: 1280 }, height: { ideal: view === 'wide' ? 960 : 720 } };
}

/**
 * Normal or wide-angle view. Wide angle = the camera's full sensor plus its widest zoom
 * (below 1× on phones whose browser exposes an ultra-wide lens, e.g. 0.6×). Nothing is
 * ever cropped.
 */
export type CameraView = 'normal' | 'wide';
const VIEW_KEY = 'familycall:view';

function loadView(): CameraView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'wide' ? 'wide' : 'normal';
  } catch {
    return 'normal';
  }
}

const isPhone = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

type ZoomRange = { min: number; max: number; step?: number };
function zoomRange(track: MediaStreamTrack): ZoomRange | null {
  const caps = (track.getCapabilities?.() ?? {}) as { zoom?: ZoomRange };
  return caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
}

/** Applies the view to a camera track (size + zoom in one go, so neither resets the other). */
async function applyView(track: MediaStreamTrack, view: CameraView) {
  const zoom = zoomRange(track);
  const constraints: MediaTrackConstraints = { ...videoConstraints(view) };
  if (zoom) {
    const value = view === 'wide' ? zoom.min : Math.min(zoom.max, Math.max(zoom.min, 1));
    (constraints as Record<string, unknown>).advanced = [{ zoom: value }];
  }
  try {
    await track.applyConstraints(constraints);
  } catch (err) {
    console.warn('[media] could not change camera view', err);
  }
}

/** Camera request: phones also ask for zoom control (needed to reach a wide-angle lens). */
function cameraRequest(view: CameraView, facingMode: MediaTrackConstraints['facingMode']): MediaTrackConstraints {
  return { ...videoConstraints(view), facingMode, ...(isPhone() ? { zoom: true } : {}) } as MediaTrackConstraints;
}

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
  const [view, setViewState] = useState<CameraView>(loadView);
  const viewRef = useRef(view);
  viewRef.current = view;

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
      .getUserMedia({ video: cameraRequest(viewRef.current, 'user'), audio: AUDIO })
      .then(async (raw) => {
        if (cancelled) {
          raw.getTracks().forEach((t) => t.stop());
          return;
        }
        if (viewRef.current === 'wide') await applyView(raw.getVideoTracks()[0], 'wide');
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
      const fresh = await navigator.mediaDevices.getUserMedia({ video: cameraRequest(viewRef.current, { ideal: next }) });
      track = fresh.getVideoTracks()[0];
      await applyView(track, viewRef.current);
      setFacing(next);
    } catch (err) {
      console.error('[media] could not switch camera', err);
      // Get the previous camera back.
      const fallback = await navigator.mediaDevices.getUserMedia({ video: cameraRequest(viewRef.current, { ideal: facing }) });
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

  /** Normal or wide-angle camera view (remembered). */
  const setView = useCallback(async (next: CameraView) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // ignore
    }
    const track = rawRef.current?.getVideoTracks()[0];
    if (track) await applyView(track, next);
  }, []);

  /** The camera's own picture size and zoom, before effects (for the ?debug readout). */
  const cameraSize = useCallback(() => {
    const track = rawRef.current?.getVideoTracks()[0];
    const s = track?.getSettings() as (MediaTrackSettings & { zoom?: number }) | undefined;
    if (!s?.width) return '?';
    const zoom = track && zoomRange(track);
    return `${s.width}×${s.height}${zoom ? ` zoom ${s.zoom ?? '?'} (${zoom.min}–${zoom.max})` : ' (no zoom control)'}`;
  }, []);

  return {
    stream,
    previewStream,
    cameraSize,
    view,
    setView,
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
