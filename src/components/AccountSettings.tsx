import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { getRingtone, previewRingtone, RINGTONES, setRingtone, type RingtoneId } from '../lib/tones';
import { Icon } from './Icon';
import { RecoveryCodeCard } from './RecoveryCodeCard';

type Panel = null | 'password' | 'recovery';

/** Ringtone, password and recovery code. */
export function AccountSettings({ openRecovery = false }: { openRecovery?: boolean }) {
  const { profile, changePassword, newRecoveryCode } = useAuth();
  const [panel, setPanel] = useState<Panel>(openRecovery ? 'recovery' : null);
  const [ringtone, setRingtoneState] = useState<RingtoneId>(getRingtone);
  const [playing, setPlaying] = useState<RingtoneId | null>(null);
  const stopPreview = useRef<(() => void) | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => () => stopPreview.current?.(), []);
  useEffect(() => {
    if (openRecovery) setPanel('recovery');
  }, [openRecovery]);

  const pick = (id: RingtoneId) => {
    setRingtone(id);
    setRingtoneState(id);
    stopPreview.current?.();
    stopPreview.current = previewRingtone(id);
    setPlaying(id);
    setTimeout(() => setPlaying((p) => (p === id ? null : p)), 3000);
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (next.length < 6) {
      setMessage({ ok: false, text: 'Choose a new password with at least 6 characters.' });
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setMessage({ ok: true, text: 'Password changed. Other phones signed in to your account will need the new password.' });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const makeCode = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setCode(await newRecoveryCode());
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card account" aria-labelledby="account-title" id="account">
      <h2 id="account-title">Settings</h2>

      <div className="account__group">
        <h3>Ringtone</h3>
        <div className="ringtones" role="radiogroup" aria-label="Ringtone">
          {RINGTONES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={ringtone === r.id}
              className={`ringtone${ringtone === r.id ? ' is-selected' : ''}`}
              onClick={() => pick(r.id)}
            >
              <span className="ringtone__icon" aria-hidden="true">{playing === r.id ? '♪' : ringtone === r.id ? '✓' : '▶'}</span>
              {r.name}
            </button>
          ))}
        </div>
      </div>

      <div className="account__group">
        <div className="account__row">
          <h3>Password</h3>
          <button type="button" className="link-btn" onClick={() => { setPanel(panel === 'password' ? null : 'password'); setMessage(null); }} aria-expanded={panel === 'password'}>
            {panel === 'password' ? 'Close' : 'Change'}
          </button>
        </div>
        {panel === 'password' && (
          <form className="account__form" onSubmit={submitPassword} noValidate>
            <div className="field">
              <label htmlFor="current-password">Current password</label>
              <input id="current-password" className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </div>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input id="new-password" className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={6} />
            </div>
            <button type="submit" className="btn btn--primary" disabled={busy || !current || !next}>{busy ? 'Saving…' : 'Change password'}</button>
          </form>
        )}
      </div>

      <div className="account__group">
        <div className="account__row">
          <h3>Recovery code</h3>
          <button type="button" className="link-btn" onClick={() => { setPanel(panel === 'recovery' ? null : 'recovery'); setCode(null); setMessage(null); }} aria-expanded={panel === 'recovery'}>
            {panel === 'recovery' ? 'Close' : 'New code'}
          </button>
        </div>
        <p className="muted small">
          {profile?.recovery_set_at
            ? `Saved ${new Date(profile.recovery_set_at).toLocaleDateString()}. It lets you reset a forgotten password.`
            : 'Not saved yet. Without it, a forgotten password can’t be reset.'}
        </p>
        {panel === 'recovery' &&
          (code ? (
            <RecoveryCodeCard code={code} username={profile?.username ?? ''} doneLabel="Done" onDone={() => { setCode(null); setPanel(null); }} />
          ) : (
            <div className="account__form">
              <p className="muted small">Making a new code replaces your old one, which stops working.</p>
              <button type="button" className="btn btn--primary" onClick={() => void makeCode()} disabled={busy}>
                <Icon name="check" size={20} />
                {busy ? 'Making…' : 'Make a new recovery code'}
              </button>
            </div>
          ))}
      </div>

      {message && <p className={message.ok ? 'field__hint field__hint--ok' : 'field__error'} role="status">{message.text}</p>}
    </section>
  );
}
