import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/supabase';

/** /add/:username: the link inside someone's "My QR code". Adds them, then goes home. */
export function AddContact() {
  const { username = '' } = useParams();
  const { ready, profile } = useAuth();
  const [state, setState] = useState<{ status: 'adding' | 'done' | 'error'; message?: string; name?: string }>({ status: 'adding' });

  useEffect(() => {
    if (!profile) return;
    api<{ contact: { display_name: string } }>('addContact', { username })
      .then((res) => setState({ status: 'done', name: res.contact.display_name }))
      .catch((err) => setState({ status: 'error', message: (err as Error).message }));
  }, [profile, username]);

  if (!ready) return <main className="center-page"><p className="muted">Loading…</p></main>;
  if (!profile) return <Navigate to={`/login?mode=signup&next=${encodeURIComponent(`/add/${username}`)}`} replace />;

  return (
    <main className="center-page">
      {state.status === 'adding' && <p className="muted">Adding {username}…</p>}
      {state.status === 'done' && (
        <>
          <h1>{state.name} is in your family list</h1>
          <p className="muted">Tap their name on the home screen to call them.</p>
          <Link className="btn btn--primary btn--lg" to="/">Go to my family</Link>
        </>
      )}
      {state.status === 'error' && (
        <>
          <h1>Couldn’t add {username}</h1>
          <p className="muted">{state.message}</p>
          <Link className="btn btn--primary btn--lg" to="/">Go home</Link>
        </>
      )}
    </main>
  );
}
