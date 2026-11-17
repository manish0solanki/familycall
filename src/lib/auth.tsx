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
  signUp: (input: { firstName: string; lastName: string; username: string; password: string }) => Promise<void>;
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
      .select('id, username, display_name, last_seen')
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
      await api('signup', input);
      await signIn(input.username, input.password);
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ ready, session, profile, signIn, signUp, signOut }),
    [ready, session, profile, signIn, signUp, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
