import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { api, ApiError, loginEmail, supabase, type Profile } from './supabase';
import { saveName } from './name';

interface AuthState {
  /** False until the saved session (if any) has been checked. */
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  signIn: (username: string, password: string) => Promise<void>;
  /** Creates the account, signs in, and returns its recovery code (show it once!). */
  signUp: (input: { firstName: string; lastName: string; username: string; password: string }) => Promise<string>;
  /** Forgot password: sets a new one with the recovery code; returns the next recovery code. */
  resetPassword: (username: string, code: string, password: string) => Promise<string>;
  /** Signed in: change password (other devices are signed out). */
  changePassword: (currentPassword: string, password: string) => Promise<void>;
  /** Signed in: replace the recovery code; returns the new one. */
  newRecoveryCode: () => Promise<string>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!supabase);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfile(null);
        setReady(true);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('id, username, display_name, last_seen, recovery_set_at')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setProfile(data);
        if (data) saveName(data.display_name.split(' ')[0]);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signIn = useCallback(async (username: string, password: string) => {
    if (!supabase) throw new ApiError(0, 'This site isn’t connected to its server.');
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(username), password });
    if (error) {
      throw new ApiError(
        error.status ?? 400,
        /invalid/i.test(error.message) ? 'Wrong username or password.' : error.message,
      );
    }
  }, []);

  const signUp = useCallback(
    async (input: { firstName: string; lastName: string; username: string; password: string }) => {
      const { recoveryCode } = await api<{ recoveryCode: string }>('signup', input);
      await signIn(input.username, input.password);
      return recoveryCode;
    },
    [signIn],
  );

  const resetPassword = useCallback(
    async (username: string, code: string, password: string) => {
      const { recoveryCode } = await api<{ recoveryCode: string }>('resetPassword', { username: username.trim().toLowerCase(), code, password });
      await signIn(username, password);
      return recoveryCode;
    },
    [signIn],
  );

  const username = profile?.username;
  const changePassword = useCallback(
    async (currentPassword: string, password: string) => {
      await api('changePassword', { currentPassword, password });
      // Changing the password signs the account out everywhere; sign back in here.
      if (username) await signIn(username, password);
    },
    [signIn, username],
  );

  const newRecoveryCode = useCallback(async () => {
    const { recoveryCode } = await api<{ recoveryCode: string }>('createRecoveryCode');
    setProfile((p) => (p ? { ...p, recovery_set_at: new Date().toISOString() } : p));
    return recoveryCode;
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ ready, session, profile, signIn, signUp, resetPassword, changePassword, newRecoveryCode, signOut }),
    [ready, session, profile, signIn, signUp, resetPassword, changePassword, newRecoveryCode, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
