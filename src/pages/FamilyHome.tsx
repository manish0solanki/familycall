import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/auth';
import { useCalls } from '../lib/calls';
import { enablePush, isIos, pushState, type PushState } from '../lib/push';
import { addLink, callPath } from '../lib/links';
import { newRoomId } from '../lib/roomId';
import { api, isOnline, lastSeenText, supabase, type Profile } from '../lib/supabase';

const QrScanner = lazy(() => import('../components/QrScanner').then((m) => ({ default: m.QrScanner })));

interface RecentCall {
  id: string;
  status: string;
  created_at: string;
  caller: Profile | null;
  callee: Profile | null;
}

const REFRESH_MS = 30_000;

export function FamilyHome() {
  const { profile, signOut } = useAuth();
  const calls = useCalls();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Profile[] | null>(null);
  const [recent, setRecent] = useState<RecentCall[]>([]);
  const [adding, setAdding] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [editing, setEditing] = useState(false);
  const [push, setPush] = useState<PushState>(pushState);
  const [pushBusy, setPushBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const me = profile!;

  const load = useCallback(async () => {
    if (!supabase) return;
    const [c, r] = await Promise.all([
      supabase
        .from('contacts')
        .select('created_at, contact:profiles!contacts_contact_id_fkey(id, username, display_name, last_seen)')
        .eq('owner_id', me.id)
        .order('created_at'),
      supabase
        .from('calls')
        .select(
          'id, status, created_at, caller:profiles!calls_caller_id_fkey(id, username, display_name), callee:profiles!calls_callee_id_fkey(id, username, display_name)',
        )
        .order('created_at', { ascending: false })
        .limit(8),
    ]);
    if (c.data) {
      const list = c.data.map((row) => row.contact as unknown as Profile).filter(Boolean);
      list.sort((a, b) => Number(isOnline(b.last_seen)) - Number(isOnline(a.last_seen)) || a.display_name.localeCompare(b.display_name));
      setContacts(list);
    }
    if (r.data) setRecent(r.data as unknown as RecentCall[]);
  }, [me.id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Refresh recent calls after a missed call.
  const missed = calls?.missedFrom;
  useEffect(() => {
    if (missed) void load();
  }, [missed, load]);

  const add = async (username: string) => {
    setAddError(null);
    setAddBusy(true);
    try {
      await api('addContact', { username });
      setAdding('');
      await load();
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAddBusy(false);
    }
  };

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (adding.trim()) void add(adding.trim().replace(/^@/, ''));
  };

  const remove = async (contact: Profile) => {
    if (!supabase || !window.confirm(`Remove ${contact.display_name} from your family list?`)) return;
    await supabase.from('contacts').delete().eq('owner_id', me.id).eq('contact_id', contact.id);
    await load();
  };

  const turnOnAlerts = async () => {
    setPushBusy(true);
    try {
      setPush(await enablePush(true));
    } catch (err) {
      console.warn('[push]', err);
      setPush(pushState());
    } finally {
      setPushBusy(false);
    }
  };

  const share = async () => {
    const link = addLink(me.username);
    const text = `Add me on FamilyCall so we can video call: my username is ${me.username}`;
    try {
      if (navigator.share) await navigator.share({ title: 'FamilyCall', text, url: link });
      else {
        await navigator.clipboard.writeText(`${text}\n${link}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // share sheet closed
    }
  };

  const firstName = me.display_name.split(' ')[0];

  return (
    <main className="home family">
      <header className="home__header family__header">
        <span className="brand">
          <span className="brand__mark"><Icon name="video" size={20} /></span>
          FamilyCall
        </span>
        <button type="button" className="btn btn--secondary" onClick={() => void signOut()}>Sign out</button>
      </header>

      <section className="home__intro">
        <span className="eyebrow">Hi, {firstName}</span>
        <h1>Your family</h1>
      </section>

      {calls?.missedFrom && (
        <div className="banner banner--missed" role="status">
          <span>Missed call from <strong>{calls.missedFrom.displayName}</strong></span>
          <div className="banner__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                const from = calls.missedFrom!;
                calls.dismissMissed();
                navigate(callPath({ id: from.id, username: from.username, display_name: from.displayName }));
              }}
            >
              Call back
            </button>
            <button type="button" className="btn btn--secondary" onClick={calls.dismissMissed} aria-label="Dismiss">✕</button>
          </div>
        </div>
      )}

      {push !== 'on' && (
        <section className="card alerts">
          <div>
            <h2>Turn on call alerts</h2>
            {push === 'off' && <p className="muted">So your phone rings when family calls, even when FamilyCall is closed.</p>}
            {push === 'blocked' && <p className="muted">Notifications are blocked for this site. Allow them in your browser’s site settings, then reload.</p>}
            {push === 'needs-install' && (
              <p className="muted">On iPhone: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, open FamilyCall from your home screen, then turn on alerts.</p>
            )}
            {push === 'unsupported' && <p className="muted">This browser can’t ring when FamilyCall is closed. Keep it open, or use Chrome.</p>}
          </div>
          {push === 'off' && (
            <button type="button" className="btn btn--primary btn--lg" onClick={() => void turnOnAlerts()} disabled={pushBusy}>
              {pushBusy ? 'Turning on…' : 'Turn on'}
            </button>
          )}
        </section>
      )}

      <section className="card me-card">
        <div className="me-card__row">
          <Avatar name={me.display_name} seed={me.username} size={52} />
          <div className="me-card__text">
            <span className="me-card__label">Your username</span>
            <span className="me-card__username" data-testid="my-username">{me.username}</span>
          </div>
        </div>
        <p className="muted">Family can add you with this username, or by scanning your QR code.</p>
        <div className="me-card__actions">
          <button type="button" className="btn btn--secondary" onClick={() => void share()}>
            <Icon name="share" size={20} />
            {copied ? 'Copied' : 'Share'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setShowQr((s) => !s)} aria-expanded={showQr}>
            <Icon name="qr" size={20} />
            {showQr ? 'Hide QR' : 'My QR code'}
          </button>
        </div>
        {showQr && (
          <div className="me-card__qr">
            <QRCodeSVG value={addLink(me.username)} size={180} marginSize={2} title={`QR code to add ${me.display_name}`} />
          </div>
        )}
      </section>

      <section className="contacts" aria-labelledby="contacts-title">
        <div className="section-head">
          <h2 id="contacts-title">Family members</h2>
          {contacts && contacts.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Edit'}</button>
          )}
        </div>
        {contacts === null ? (
          <p className="muted">Loading…</p>
        ) : contacts.length === 0 ? (
          <p className="muted">No one yet. Add family by their username below, or scan their QR code.</p>
        ) : (
          <ul className="contact-list">
            {contacts.map((c) => (
              <li key={c.id} className="contact">
                <Avatar name={c.display_name} seed={c.username} online={isOnline(c.last_seen)} />
                <div className="contact__text">
                  <span className="contact__name">{c.display_name}</span>
                  <span className={`contact__status${isOnline(c.last_seen) ? ' is-online' : ''}`}>
                    @{c.username} · {lastSeenText(c.last_seen)}
                  </span>
                </div>
                {editing ? (
                  <button type="button" className="btn btn--secondary" onClick={() => void remove(c)}>Remove</button>
                ) : (
                  <Link to={callPath(c)} className="contact__call" aria-label={`Video call ${c.display_name}`}>
                    <Icon name="video" size={22} />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}

        <form className="card add-contact" onSubmit={onAdd} noValidate>
          <label htmlFor="add-username" className="add-contact__label">Add a family member</label>
          <div className="add-contact__row">
            <input
              id="add-username"
              className="input"
              value={adding}
              onChange={(e) => {
                setAdding(e.target.value.toLowerCase().replace(/\s/g, ''));
                setAddError(null);
              }}
              placeholder="Their username, e.g. nasolanki"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={addError ? true : undefined}
              aria-describedby={addError ? 'add-error' : undefined}
            />
            <button type="submit" className="btn btn--primary" disabled={addBusy || !adding.trim()}>{addBusy ? 'Adding…' : 'Add'}</button>
          </div>
          {addError && <span id="add-error" className="field__error" role="alert">{addError}</span>}
          <button type="button" className="btn btn--secondary btn--block" onClick={() => setScanning(true)}>
            <Icon name="qr" size={20} />
            Scan their QR code
          </button>
        </form>
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent-title" className="recent">
          <h2 id="recent-title">Recent calls</h2>
          <ul className="recent-list">
            {recent.map((r) => {
              const incoming = r.callee?.id === me.id;
              const other = incoming ? r.caller : r.callee;
              const missedCall = incoming && (r.status === 'missed' || r.status === 'cancelled');
              const label = missedCall
                ? 'Missed'
                : incoming
                  ? r.status === 'declined' ? 'Declined' : 'Incoming'
                  : r.status === 'answered' ? 'Outgoing' : r.status === 'declined' ? 'Declined' : 'No answer';
              return (
                <li key={r.id} className="recent__item">
                  <Avatar name={other?.display_name ?? '?'} seed={other?.username ?? r.id} size={40} />
                  <div className="contact__text">
                    <span className="contact__name">{other?.display_name ?? 'Unknown'}</span>
                    <span className={`contact__status${missedCall ? ' is-missed' : ''}`}>
                      {label} · {new Date(r.created_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  {other && (
                    <Link to={callPath(other)} className="contact__call contact__call--soft" aria-label={`Call ${other.display_name} back`}>
                      <Icon name="video" size={20} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card link-call">
        <h2>Call someone without an account</h2>
        <p className="muted">Start a call and share the link or QR code.</p>
        <Link to={`/room/${newRoomId()}`} className="btn btn--secondary btn--lg">
          <Icon name="link" size={20} />
          Start a link call
        </Link>
      </section>

      {isIos() && <p className="muted small">Tip: add FamilyCall to your Home Screen so it opens like an app.</p>}

      {scanning && (
        <Suspense fallback={<div className="scanner" aria-busy="true" />}>
          <QrScanner
            onClose={() => setScanning(false)}
            onResult={(text) => {
              const match = text.match(/\/add\/([a-z0-9]+)/i);
              const username = match ? match[1].toLowerCase() : /^[a-z]{3,20}[0-9]{0,3}$/.test(text.trim()) ? text.trim() : null;
              if (!username) return 'That isn’t a FamilyCall contact QR code. Ask them to show “My QR code”.';
              setScanning(false);
              void add(username);
              return null;
            }}
          />
        </Suspense>
      )}
    </main>
  );
}
