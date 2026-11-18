import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EffectsSheet } from '../components/LazyEffectsSheet';
import { Icon } from '../components/Icon';
import { effectsActive } from '../effects/active';
import { InvitePanel } from '../components/InvitePanel';
import { VideoView } from '../components/VideoView';
import { Avatar } from '../components/Avatar';
import { ShapeButton } from '../components/ShapeButton';
import { useCalls, type CallParty } from '../lib/calls';
import { PeerCall, type CallState } from '../lib/peerCall';
import { playRingback } from '../lib/tones';
import { signalingMode } from '../lib/signaling';
import type { LocalMedia } from '../lib/useLocalMedia';

/** A call placed by tapping a contact, or answered from the incoming-call screen. */
export type DirectCall = { kind: 'outgoing'; to: CallParty } | { kind: 'incoming'; callId: string };

interface Props {
  roomId: string;
  name: string;
  media: LocalMedia;
  direct?: DirectCall;
  onLeave: () => void;
}

type RingState =
  | { state: 'idle' }
  | { state: 'ringing'; callId?: string }
  | { state: 'answered' | 'declined' | 'noanswer'; callId?: string }
  | { state: 'failed'; error: string };

/** How long the other phone rings before we give up (matches the server). */
const RING_TIMEOUT_MS = 45_000;
/** An answered call whose caller never shows up (they hung up meanwhile). */
const ANSWER_TIMEOUT_MS = 20_000;

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Deployed without Supabase settings: calls can't reach other devices. Warn instead of failing silently. */
const testMode =
  signalingMode === 'local' && !['localhost', '127.0.0.1'].includes(window.location.hostname);

/** Add ?debug to the room link to show the video sizes being sent and received. */
const DEBUG_VIDEO = new URLSearchParams(window.location.search).has('debug');

function VideoSizes({ local, remote }: { local: MediaStream | null; remote: { w: number; h: number } | null }) {
  const [sent, setSent] = useState('');
  useEffect(() => {
    const read = () => {
      const s = local?.getVideoTracks()[0]?.getSettings();
      setSent(s?.width ? `${s.width}×${s.height}` : '?');
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [local]);
  return (
    <p className="call__debug" data-testid="video-sizes">
      Sending {sent} · Receiving {remote ? `${remote.w}×${remote.h}` : '?'} · Screen {window.innerWidth}×{window.innerHeight}
    </p>
  );
}

const STATUS_TEXT: Record<CallState['status'], string> = {
  joining: 'Joining…',
  waiting: 'Waiting for family to join',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  full: 'This call is full',
  error: 'Something went wrong',
};

export function CallScreen({ roomId, name, media, direct, onLeave }: Props) {
  const navigate = useNavigate();
  const callRef = useRef<PeerCall | null>(null);
  const [call, setCall] = useState<CallState>({ status: 'joining', remoteStream: null, remoteName: null });
  const [seconds, setSeconds] = useState(0);
  const stream = media.stream!;

  useEffect(() => {
    const peerCall = new PeerCall({ roomId, name, localStream: stream, onChange: setCall });
    callRef.current = peerCall;
    void peerCall.start();
    const leaveOnClose = () => peerCall.leave();
    window.addEventListener('pagehide', leaveOnClose);
    return () => {
      window.removeEventListener('pagehide', leaveOnClose);
      peerCall.leave();
      callRef.current = null;
    };
  }, [roomId, name, stream]);

  const connected = call.status === 'connected';
  useEffect(() => {
    if (!connected) return;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  // ---- Direct calls: ring the other person, and follow what happens. ----
  const calls = useCalls();
  const outgoingTo = direct?.kind === 'outgoing' ? direct.to : null;
  const outgoingId = outgoingTo?.id;
  const [ring, setRing] = useState<RingState>({ state: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const wasConnected = useRef(false);
  if (connected) wasConnected.current = true;
  const ringRef = useRef(ring);
  ringRef.current = ring;

  // Ring once we're in the room (so we're ready when they pick up).
  const inRoom = call.status !== 'joining';
  const callsRef = useRef(calls);
  callsRef.current = calls;
  const rungAttempt = useRef(-1);
  useEffect(() => {
    const api = callsRef.current;
    if (!outgoingId || !api || !inRoom || rungAttempt.current === attempt) return;
    rungAttempt.current = attempt; // exactly one ring per attempt
    setRing({ state: 'ringing' });
    api.ring(outgoingId, roomId).then(
      (res) => setRing((r) => (r.state === 'ringing' ? { state: 'ringing', callId: res.callId } : r)),
      (err) => setRing({ state: 'failed', error: (err as Error).message }),
    );
  }, [outgoingId, inRoom, roomId, attempt]);

  // Their answer / decline arrives on our private channel.
  useEffect(() => {
    if (!calls) return;
    return calls.listen((event) => {
      const current = ringRef.current;
      if (!('callId' in current) || current.callId !== event.callId) return;
      if (event.type === 'declined') setRing({ state: 'declined', callId: event.callId });
      if (event.type === 'answered') setRing({ state: 'answered', callId: event.callId });
    });
  }, [calls]);

  // No answer after 45 s.
  const ringingCallId = ring.state === 'ringing' ? ring.callId : undefined;
  useEffect(() => {
    if (!ringingCallId || connected) return;
    const timer = setTimeout(() => {
      setRing({ state: 'noanswer', callId: ringingCallId });
      void callsRef.current?.cancel(ringingCallId, 'timeout').catch(() => {});
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ringingCallId, connected]);

  // "Ring ring" while waiting for them to pick up.
  const ringingNow = ring.state === 'ringing' && !connected && call.status === 'waiting';
  useEffect(() => (ringingNow ? playRingback() : undefined), [ringingNow]);

  // Answered a call but the caller has gone (they hung up just before).
  const [answerExpired, setAnswerExpired] = useState(false);
  useEffect(() => {
    if (direct?.kind !== 'incoming' || wasConnected.current || connected) return;
    const timer = setTimeout(() => setAnswerExpired(true), ANSWER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [direct?.kind, connected]);

  const hangUp = () => {
    const current = ringRef.current;
    if (current.state === 'ringing' && current.callId && !wasConnected.current) {
      void callsRef.current?.cancel(current.callId).catch(() => {});
    }
    callRef.current?.leave();
    onLeave();
    navigate('/');
  };

  const callAgain = () => {
    wasConnected.current = false;
    setRing({ state: 'idle' });
    setAttempt((a) => a + 1);
  };

  // Effects switched on/off or camera flipped: send the new video track without redialling.
  const { videoVersion } = media;
  useEffect(() => {
    const track = stream.getVideoTracks()[0];
    if (track) void callRef.current?.replaceVideoTrack(track);
  }, [videoVersion, stream]);

  const [showEffects, setShowEffects] = useState(false);

  // ---- Fit or fill the other person's video. ----
  // Filling the screen crops the picture. That's fine when the shapes match, but a wide
  // picture on a tall phone screen would lose half the image and look zoomed in and
  // blurry, so then we show it whole. Tapping the video switches between the two.
  const [remoteSize, setRemoteSize] = useState<{ w: number; h: number } | null>(null);
  const [screen, setScreen] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [fitChoice, setFitChoice] = useState<'cover' | 'contain' | null>(null);
  useEffect(() => {
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // A new shape from the other side (they rotated their phone): go back to automatic.
  const shape = remoteSize ? (remoteSize.w >= remoteSize.h ? 'wide' : 'tall') : null;
  useEffect(() => setFitChoice(null), [shape]);
  const autoFit: 'cover' | 'contain' = (() => {
    if (!remoteSize) return 'contain'; // until we know the shape, never risk a zoomed-in crop
    const video = remoteSize.w / remoteSize.h;
    const box = screen.w / screen.h;
    const kept = Math.min(video, box) / Math.max(video, box); // share of the picture left after cropping
    return kept < 0.75 ? 'contain' : 'cover';
  })();
  const remoteFit = fitChoice ?? autoFit;

  const hasRemote = Boolean(call.remoteStream) && call.status !== 'waiting';
  const otherName = outgoingTo?.displayName ?? call.remoteName;
  const title = call.remoteName ?? otherName ?? 'Your call';
  const ended = Boolean(direct) && call.status === 'waiting' && (wasConnected.current || answerExpired);
  const directText =
    ended
      ? 'Call ended'
      : ring.state === 'ringing'
        ? 'Ringing…'
        : ring.state === 'answered'
          ? 'Connecting…'
          : ring.state === 'declined'
            ? 'Declined'
            : ring.state === 'noanswer'
              ? 'No answer'
              : ring.state === 'failed'
                ? 'Couldn’t ring'
                : direct?.kind === 'incoming'
                  ? 'Connecting…'
                  : 'Calling…';
  const subtitle = connected
    ? `${formatDuration(seconds)} · Connected`
    : direct && (call.status === 'waiting' || call.status === 'joining')
      ? directText
      : STATUS_TEXT[call.status];

  return (
    <main className="call" data-status={call.status}>
      {hasRemote ? (
        <>
          {remoteFit === 'contain' && (
            // Fills the empty sides with a soft, blurred copy of the video (like WhatsApp / FaceTime).
            <VideoView stream={call.remoteStream} muted className="call__backdrop" label="" />
          )}
          <VideoView
            stream={call.remoteStream}
            className="call__remote"
            label={`${title}'s video`}
            fit={remoteFit}
            onSize={(w, h) => setRemoteSize((s) => (s?.w === w && s?.h === h ? s : { w, h }))}
          />
          <button
            type="button"
            className="call__fit-toggle"
            onClick={() => setFitChoice(remoteFit === 'cover' ? 'contain' : 'cover')}
            aria-label={remoteFit === 'cover' ? 'Show the whole picture' : 'Fill the screen'}
            data-testid="fit-toggle"
            data-fit={remoteFit}
          />
        </>
      ) : (
        <div className="call__empty">
          {call.status === 'full' ? (
            <div className="call__notice" role="alert">
              <h2>This call already has two people</h2>
              <p>For now, calls are one-to-one. Start a new call from the home screen.</p>
              <button type="button" className="btn btn--light btn--lg" onClick={hangUp}>Back to home</button>
            </div>
          ) : call.status === 'error' ? (
            <div className="call__notice" role="alert">
              <h2>{STATUS_TEXT.error}</h2>
              <p>{call.error}</p>
              <button type="button" className="btn btn--light btn--lg" onClick={() => window.location.reload()}>Try again</button>
            </div>
          ) : (
            <>
              {/* Like a phone's calling screen: your own camera fills the background while you wait. */}
              <VideoView stream={media.previewStream} muted mirrored={media.facing === 'user'} className={`call__bg${media.camOn ? '' : ' is-off'}`} label="Your camera" />
              {direct ? (
                <div className="call__calling" data-testid="calling-panel">
                  <Avatar name={otherName ?? '?'} seed={outgoingTo?.username || otherName || roomId} size={112} />
                  <h2>{otherName ?? 'Family member'}</h2>
                  <p role="status">
                    {ended
                      ? 'The call has ended.'
                      : ring.state === 'declined'
                        ? `${otherName} can’t talk right now.`
                        : ring.state === 'noanswer'
                          ? `${otherName} didn’t answer.`
                          : ring.state === 'failed'
                            ? ring.error
                            : directText}
                  </p>
                  {(ended || ring.state === 'declined' || ring.state === 'noanswer' || ring.state === 'failed') && (
                    <div className="call__calling-actions">
                      {outgoingTo && (
                        <button type="button" className="btn btn--light btn--lg" onClick={callAgain}>
                          <Icon name="video" size={22} />
                          Call again
                        </button>
                      )}
                      <button type="button" className="btn btn--secondary btn--lg" onClick={hangUp}>Back home</button>
                    </div>
                  )}
                </div>
              ) : (
              <div className="call__waiting">
                {testMode && (
                  <p className="call__warning" role="alert">
                    Test mode: this site is missing its call-server settings, so calls only connect between tabs of this browser.
                  </p>
                )}
                <p>Send this link, or let them scan the QR code.</p>
                <InvitePanel roomId={roomId} compact />
              </div>
              )}
            </>
          )}
        </div>
      )}

      <header className="call__top">
        <div>
          <h1 className="call__title">{title}</h1>
          <p className="call__subtitle" role="status" data-testid="call-status">{subtitle}</p>
          {DEBUG_VIDEO && hasRemote && <VideoSizes local={media.previewStream} remote={remoteSize} />}
          <div className="call__pills">
          <ShapeButton media={media} />
          {hasRemote && (
            <button
              type="button"
              className="call__fit-btn"
              onClick={() => setFitChoice(remoteFit === 'cover' ? 'contain' : 'cover')}
              aria-pressed={remoteFit === 'cover'}
              data-testid="fit-button"
            >
              <Icon name={remoteFit === 'cover' ? 'shrink' : 'expand'} size={18} />
              {remoteFit === 'cover' ? 'Fit' : 'Fill'}
            </button>
          )}
          </div>
        </div>
      </header>

      {hasRemote && (
        <div className={`call__self${media.camOn ? '' : ' is-off'}`}>
          <VideoView stream={media.previewStream} muted mirrored={media.facing === 'user'} className="call__self-video" label="Your camera" />
          {!media.camOn && <span className="call__self-off"><Icon name="videoOff" size={22} /></span>}
          <span className="call__self-label">You</span>
        </div>
      )}

      <nav className="call__controls" aria-label="Call controls">
        <button
          type="button"
          className={`round-btn${media.micOn ? '' : ' is-off'}`}
          onClick={media.toggleMic}
          aria-pressed={!media.micOn}
          aria-label={media.micOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          <Icon name={media.micOn ? 'mic' : 'micOff'} />
        </button>
        <button
          type="button"
          className={`round-btn${media.camOn ? '' : ' is-off'}`}
          onClick={media.toggleCam}
          aria-pressed={!media.camOn}
          aria-label={media.camOn ? 'Turn camera off' : 'Turn camera on'}
        >
          <Icon name={media.camOn ? 'video' : 'videoOff'} />
        </button>
        {media.canSwitchCamera && (
          <button type="button" className="round-btn" onClick={() => void media.switchCamera()} aria-label="Switch camera">
            <Icon name="flip" />
          </button>
        )}
        <button
          type="button"
          className={`round-btn${effectsActive(media) ? ' is-active' : ''}`}
          onClick={() => setShowEffects(true)}
          aria-label="Effects: background, beautify and filters"
        >
          <Icon name="sparkles" />
        </button>
        <button type="button" className="round-btn round-btn--danger" onClick={hangUp} aria-label="End call">
          <Icon name="phone" className="icon-hangup" />
        </button>
      </nav>

      {showEffects && <EffectsSheet media={media} onClose={() => setShowEffects(false)} />}
    </main>
  );
}
