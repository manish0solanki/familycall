import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EffectsSheet } from '../components/LazyEffectsSheet';
import { Icon } from '../components/Icon';
import { effectsActive } from '../effects/active';
import { InvitePanel } from '../components/InvitePanel';
import { VideoView } from '../components/VideoView';
import { PeerCall, type CallState } from '../lib/peerCall';
import { signalingMode } from '../lib/signaling';
import type { LocalMedia } from '../lib/useLocalMedia';

interface Props {
  roomId: string;
  name: string;
  media: LocalMedia;
  onLeave: () => void;
}

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

const STATUS_TEXT: Record<CallState['status'], string> = {
  joining: 'Joining…',
  waiting: 'Waiting for family to join',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  full: 'This call is full',
  error: 'Something went wrong',
};

export function CallScreen({ roomId, name, media, onLeave }: Props) {
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

  const hangUp = () => {
    callRef.current?.leave();
    onLeave();
    navigate('/');
  };

  // Effects switched on/off or camera flipped: send the new video track without redialling.
  const { videoVersion } = media;
  useEffect(() => {
    const track = stream.getVideoTracks()[0];
    if (track) void callRef.current?.replaceVideoTrack(track);
  }, [videoVersion, stream]);

  const [showEffects, setShowEffects] = useState(false);

  const hasRemote = Boolean(call.remoteStream) && call.status !== 'waiting';
  const title = call.remoteName ?? 'Your call';
  const subtitle = connected ? `${formatDuration(seconds)} · Connected` : STATUS_TEXT[call.status];

  return (
    <main className="call" data-status={call.status}>
      {hasRemote ? (
        <VideoView stream={call.remoteStream} className="call__remote" label={`${title}'s video`} />
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
              <div className="call__waiting">
                {testMode && (
                  <p className="call__warning" role="alert">
                    Test mode: this site is missing its call-server settings, so calls only connect between tabs of this browser.
                  </p>
                )}
                <p>Send this link, or let them scan the QR code.</p>
                <InvitePanel roomId={roomId} compact />
              </div>
            </>
          )}
        </div>
      )}

      <header className="call__top">
        <div>
          <h1 className="call__title">{title}</h1>
          <p className="call__subtitle" role="status" data-testid="call-status">{subtitle}</p>
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
