import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EffectsSheet } from '../components/LazyEffectsSheet';
import { Icon } from '../components/Icon';
import { effectsActive } from '../effects/active';
import { InvitePanel } from '../components/InvitePanel';
import { VideoView } from '../components/VideoView';
import { loadName, saveName } from '../lib/name';
import { isValidRoomId } from '../lib/roomId';
import { useLocalMedia } from '../lib/useLocalMedia';
import { useAuth } from '../lib/auth';
import { CallScreen, type DirectCall } from './CallScreen';

export function Room() {
  const { roomId = '' } = useParams();
  const media = useLocalMedia();
  const [name, setName] = useState(loadName);
  const [joined, setJoined] = useState(false);
  const [showEffects, setShowEffects] = useState(false);
  const { profile } = useAuth();
  const [params] = useSearchParams();

  // Calls placed by tapping a contact, or answered from the incoming-call screen,
  // skip the lobby and join as soon as the camera is ready.
  const to = params.get('to');
  const answeredCall = params.get('answer') ? params.get('call') : null;
  const direct: DirectCall | undefined = to
    ? { kind: 'outgoing', to: { id: to, username: params.get('toUser') ?? '', displayName: params.get('toName') ?? 'Family member' } }
    : answeredCall
      ? { kind: 'incoming', callId: answeredCall }
      : undefined;
  const autoJoin = Boolean(direct);
  useEffect(() => {
    if (autoJoin && media.stream) setJoined(true);
  }, [autoJoin, media.stream]);
  const myName = profile?.display_name ?? (name.trim() || 'Family member');

  if (!isValidRoomId(roomId)) {
    return (
      <main className="center-page">
        <h1>This link doesn’t work</h1>
        <p className="muted">Ask the person who invited you to send the link again.</p>
        <Link className="btn btn--primary btn--lg" to="/">Go to home</Link>
      </main>
    );
  }

  if (joined && media.stream) {
    return <CallScreen roomId={roomId} name={myName} media={media} direct={direct} onLeave={() => setJoined(false)} />;
  }

  return (
    <main className="lobby">
      <Link to="/" className="back-link"><Icon name="arrowLeft" size={20} />Home</Link>

      <div className="lobby__grid">
        <section className="lobby__preview">
          <div className="preview">
            {media.error ? (
              <div className="preview__message" role="alert">{media.error}</div>
            ) : !media.stream ? (
              <div className="preview__message">Starting camera…</div>
            ) : !media.camOn ? (
              <div className="preview__message">Camera is off</div>
            ) : null}
            <VideoView stream={media.previewStream} muted mirrored={media.facing === 'user'} className="preview__video" label="Your camera preview" />
          </div>
          <div className="lobby__toggles">
            <button
              type="button"
              className={`round-btn round-btn--light${media.micOn ? '' : ' is-off'}`}
              onClick={media.toggleMic}
              aria-pressed={!media.micOn}
              aria-label={media.micOn ? 'Mute microphone' : 'Unmute microphone'}
              disabled={!media.stream}
            >
              <Icon name={media.micOn ? 'mic' : 'micOff'} />
            </button>
            <button
              type="button"
              className={`round-btn round-btn--light${media.camOn ? '' : ' is-off'}`}
              onClick={media.toggleCam}
              aria-pressed={!media.camOn}
              aria-label={media.camOn ? 'Turn camera off' : 'Turn camera on'}
              disabled={!media.stream}
            >
              <Icon name={media.camOn ? 'video' : 'videoOff'} />
            </button>
            <button
              type="button"
              className={`round-btn round-btn--light${effectsActive(media) ? ' is-active' : ''}`}
              onClick={() => setShowEffects(true)}
              aria-label="Effects: background, beautify and filters"
              disabled={!media.stream}
            >
              <Icon name="sparkles" />
            </button>
          </div>
        </section>
        {showEffects && <EffectsSheet media={media} onClose={() => setShowEffects(false)} />}

        <section className="lobby__side">
          <h1>Ready to join?</h1>
          <div className="field">
            <label htmlFor="lobby-name">Your name</label>
            <input
              id="lobby-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mom, Nani, Riya"
              autoComplete="given-name"
              maxLength={40}
            />
          </div>
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            disabled={!media.stream}
            onClick={() => {
              saveName(name);
              setJoined(true);
            }}
          >
            <Icon name="video" size={22} />
            Join call
          </button>
          <InvitePanel roomId={roomId} compact />
        </section>
      </div>
    </main>
  );
}
