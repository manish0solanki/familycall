import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { RecoveryCodeCard } from '../components/RecoveryCodeCard';
import { useAuth } from '../lib/auth';
import { api, USERNAME_PATTERN } from '../lib/supabase';

type Mode = 'signin' | 'signup' | 'reset';
type Check = { state: 'idle' | 'checking' | 'ok' | 'bad'; message?: string };

export function Login() {
  const { signIn, signUp, resetPassword, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const next = new URLSearchParams(location.search).get('next') || '/';
  const [mode, setMode] = useState<Mode>(new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'signin');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  /** A recovery code to show (after sign-up, or after resetting a password). */
  const [recovery, setRecovery] = useState<{ code: string; reset: boolean } | null>(null);
  const holdNavigation = useRef(false);
  const checkSeq = useRef(0);

  useEffect(() => {
    if (profile && !holdNavigation.current) navigate(next, { replace: true });
  }, [profile, next, navigate]);

  // Suggest a username from the name (e.g. Manish Solanki → masolanki), or check the typed one.
  useEffect(() => {
    if (mode !== 'signup' || !firstName.trim()) {
      setCheck({ state: 'idle' });
      return;
    }
    if (usernameEdited && !USERNAME_PATTERN.test(username)) {
      setCheck({ state: 'bad', message: 'Use 3–20 small letters (a–z), like “masolanki”.' });
      return;
    }
    const seq = ++checkSeq.current;
    setCheck({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ username: string | null; available: boolean; reason?: string; suggestion?: string }>('suggestUsername', {
          firstName,
          lastName,
          username: usernameEdited ? username : undefined,
        });
        if (seq !== checkSeq.current) return;
        if (!usernameEdited && res.username) setUsername(res.username);
        setCheck(
          res.available
            ? { state: 'ok', message: 'Available' }
            : { state: 'bad', message: `${res.reason ?? 'Not available.'}${res.suggestion ? ` Try “${res.suggestion}”.` : ''}` },
        );
      } catch (err) {
        if (seq === checkSeq.current) setCheck({ state: 'bad', message: (err as Error).message });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [mode, firstName, lastName, username, usernameEdited]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(username, password);
      } else if (mode === 'signup') {
        if (password.length < 6) throw new Error('Choose a password with at least 6 characters.');
        holdNavigation.current = true; // show the recovery code first
        const recoveryCode = await signUp({ firstName: firstName.trim(), lastName: lastName.trim(), username, password });
        setRecovery({ code: recoveryCode, reset: false });
      } else {
        if (password.length < 6) throw new Error('Choose a new password with at least 6 characters.');
        holdNavigation.current = true;
        const recoveryCode = await resetPassword(username, code, password);
        setRecovery({ code: recoveryCode, reset: true });
      }
      setBusy(false);
    } catch (err) {
      holdNavigation.current = false;
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (recovery) {
    return (
      <main className="auth">
        {recovery.reset && (
          <p className="banner banner--ok" role="status">Your password has been changed. Your old recovery code no longer works; here’s your new one.</p>
        )}
        <RecoveryCodeCard
          code={recovery.code}
          username={username}
          doneLabel={recovery.reset ? 'Continue to my family' : 'Continue'}
          onDone={() => {
            holdNavigation.current = false;
            navigate(next, { replace: true });
          }}
        />
      </main>
    );
  }

  return (
    <main className="auth">
      <Link to="/" className="back-link"><Icon name="arrowLeft" size={20} />Home</Link>
      <span className="brand">
        <span className="brand__mark"><Icon name="video" size={20} /></span>
        FamilyCall
      </span>

      <div className="tabs" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={mode !== 'signup'} className={`tabs__tab${mode !== 'signup' ? ' is-active' : ''}`} onClick={() => { setMode('signin'); setError(null); }}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} className={`tabs__tab${mode === 'signup' ? ' is-active' : ''}`} onClick={() => { setMode('signup'); setError(null); setUsername(''); setUsernameEdited(false); }}>
          Create account
        </button>
      </div>

      <form className="card auth__form" onSubmit={submit} noValidate>
        {mode === 'signup' ? (
          <>
            <h1>Create your account</h1>
            <p className="muted">Your username is how family finds and calls you, like a phone number.</p>
            <div className="auth__row">
              <div className="field">
                <label htmlFor="first">First name</label>
                <input id="first" className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={40} required />
              </div>
              <div className="field">
                <label htmlFor="last">Last name</label>
                <input id="last" className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" maxLength={40} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                className="input"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''));
                  setUsernameEdited(true);
                }}
                placeholder="Filled in from your name"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={23}
                aria-describedby="username-check"
                aria-invalid={check.state === 'bad' ? true : undefined}
              />
              <span id="username-check" className={`field__hint field__hint--${check.state}`} role="status">
                {check.state === 'checking' ? 'Checking…' : check.message ?? 'Small letters only, e.g. first 2 letters of your first name + last name.'}
              </span>
            </div>
          </>
        ) : mode === 'reset' ? (
          <>
            <h1>Reset your password</h1>
            <p className="muted">Use the recovery code you saved when you made your account.</p>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                placeholder="e.g. masolanki"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label htmlFor="code">Recovery code</label>
              <input
                id="code"
                className="input input--code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="one-time-code"
              />
            </div>
          </>
        ) : (
          <>
            <h1>Welcome back</h1>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
                placeholder="e.g. masolanki"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="password">{mode === 'reset' ? 'New password' : 'Password'}</label>
          <div className="input-wrap">
            <input
              id="password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
            />
            <button type="button" className="input-wrap__btn" onClick={() => setShowPassword((s) => !s)}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {mode !== 'signin' && <span className="field__hint">At least 6 characters. Write it down somewhere safe.</span>}
        </div>

        {error && <p className="field__error" role="alert">{error}</p>}

        <button
          type="submit"
          className="btn btn--primary btn--lg btn--block"
          disabled={busy || !username || !password || (mode === 'signup' && (!firstName.trim() || check.state !== 'ok')) || (mode === 'reset' && code.replace(/[^0-9A-Z]/gi, '').length < 16)}
        >
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Set new password'}
        </button>
        {mode === 'signin' && (
          <button type="button" className="link-btn" onClick={() => { setMode('reset'); setError(null); setPassword(''); }}>
            Forgot password?
          </button>
        )}
        {mode === 'reset' && (
          <button type="button" className="link-btn" onClick={() => { setMode('signin'); setError(null); setPassword(''); }}>
            Back to sign in
          </button>
        )}
      </form>
    </main>
  );
}
