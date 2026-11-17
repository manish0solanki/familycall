import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { FamilyHome } from './FamilyHome';
import { loadName, saveName } from '../lib/name';
import { newRoomId, parseRoomInput } from '../lib/roomId';

// Loaded only when someone taps "Scan QR code" (the QR decoder is fairly large).
const QrScanner = lazy(() => import('../components/QrScanner').then((m) => ({ default: m.QrScanner })));

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Home() {
  const navigate = useNavigate();
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const { profile } = useAuth();

  const start = () => {
    saveName(name);
    navigate(`/room/${newRoomId()}`);
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const roomId = parseRoomInput(code);
    if (!roomId) {
      setCodeError('That code doesn’t look right. Paste the whole link or type the code, e.g. k7d-mq3x-p9a.');
      return;
    }
    saveName(name);
    navigate(`/room/${roomId}`);
  };

  if (profile) return <FamilyHome />;

  return (
    <main className="home">
      <header className="home__header">
        <span className="brand">
          <span className="brand__mark"><Icon name="video" size={20} /></span>
          FamilyCall
        </span>
      </header>

      <section className="home__intro">
        <span className="eyebrow">{greeting()}</span>
        <h1>Video call your family, free.</h1>
        <p className="muted">Start a call, send the link or QR code, and talk face to face. No sign-up needed.</p>
      </section>

      {supabase && (
        <section className="card signin-card">
          <div>
            <h2>Let family call you directly</h2>
            <p className="muted">Get a username, save your family, and tap a name to ring them, like WhatsApp.</p>
          </div>
          <div className="signin-card__actions">
            <Link to="/login?mode=signup" className="btn btn--primary btn--lg">Create account</Link>
            <Link to="/login" className="btn btn--secondary btn--lg">Sign in</Link>
          </div>
        </section>
      )}

      <div className="field">
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mom, Nani, Riya"
          autoComplete="given-name"
          maxLength={40}
        />
      </div>

      <section className="hero-card">
        <div>
          <h2>Start a video call</h2>
          <p>You’ll get a link and QR code to share with family.</p>
        </div>
        <button type="button" className="btn btn--light btn--lg" onClick={start}>
          <Icon name="video" size={22} />
          Start video call
        </button>
      </section>

      <form className="card join" onSubmit={join} noValidate>
        <h2>Join a call</h2>
        <div className="field">
          <label htmlFor="code">Room code or invite link</label>
          <input
            id="code"
            className="input"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeError(null);
            }}
            placeholder="k7d-mq3x-p9a"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? 'code-error' : undefined}
          />
          {codeError && <span id="code-error" className="field__error">{codeError}</span>}
        </div>
        <button type="submit" className="btn btn--primary btn--lg">Join</button>
        <div className="divider"><span>or</span></div>
        <button type="button" className="btn btn--secondary btn--lg" onClick={() => setScanning(true)}>
          <Icon name="qr" size={22} />
          Scan QR code
        </button>
      </form>

      {scanning && (
        <Suspense fallback={<div className="scanner" aria-busy="true" />}>
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            const add = text.match(/\/add\/([a-z0-9]+)/i);
            if (add) {
              setScanning(false);
              navigate(`/add/${add[1].toLowerCase()}`);
              return null;
            }
            const roomId = parseRoomInput(text);
            if (!roomId) return 'That QR code isn’t a FamilyCall invite. Try the one shown on the call screen.';
            saveName(name);
            setScanning(false);
            navigate(`/room/${roomId}`);
            return null;
          }}
        />
        </Suspense>
      )}
    </main>
  );
}
