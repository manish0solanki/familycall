import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { IncomingCallScreen } from '../components/IncomingCallScreen';
import { useAuth } from './auth';
import { enablePush, registerServiceWorker } from './push';
import { api, supabase } from './supabase';

export interface CallParty {
  id: string;
  username: string;
  displayName: string;
}

export interface IncomingCall {
  callId: string;
  roomId: string;
  from: CallParty;
  expiresAt: number;
}

/** Events on a user's private channel (sent by the "family" Edge Function). */
export type CallEvent =
  | ({ type: 'ring' } & IncomingCall)
  | { type: 'stop'; callId: string; reason: string; from?: CallParty }
  | { type: 'answered' | 'declined' | 'missed' | 'cancelled'; callId: string };

type Listener = (event: CallEvent) => void;

interface CallsState {
  incoming: IncomingCall | null;
  /** Ring someone. The caller then joins `roomId` and waits for them. */
  ring: (calleeId: string, roomId: string) => Promise<{ callId: string; devices: number }>;
  /** Caller hung up before an answer, or gave up (`timeout`). */
  cancel: (callId: string, reason?: 'timeout') => Promise<void>;
  /** Hear about answered / declined calls you placed. Returns an unsubscribe function. */
  listen: (listener: Listener) => () => void;
  missedFrom: CallParty | null;
  dismissMissed: () => void;
}

const CallsContext = createContext<CallsState | null>(null);

const HEARTBEAT_MS = 60_000;

/**
 * Signed-in calling: listens on the user's private Realtime channel (and to the
 * service worker, which receives Web Push) for incoming calls, shows the incoming-call
 * screen, and keeps "last seen" fresh so contacts can see who's online.
 */
export function CallsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [missedFrom, setMissedFrom] = useState<CallParty | null>(null);
  const listeners = useRef(new Set<Listener>());
  const seen = useRef(new Set<string>());
  const incomingRef = useRef<IncomingCall | null>(null);
  incomingRef.current = incoming;

  const handle = useCallback((event: CallEvent) => {
    if (!event?.callId) return;
    if (event.type === 'ring') {
      if (seen.current.has(event.callId) || event.expiresAt < Date.now()) return;
      seen.current.add(event.callId);
      setIncoming({ callId: event.callId, roomId: event.roomId, from: event.from, expiresAt: event.expiresAt });
      return;
    }
    if (event.type === 'stop') {
      seen.current.add(event.callId);
      if (incomingRef.current?.callId === event.callId) {
        setIncoming(null);
        if ((event.reason === 'missed' || event.reason === 'cancelled') && event.from) setMissedFrom(event.from);
      }
      void closeNotifications(event.callId);
      return;
    }
    for (const listener of listeners.current) listener(event);
  }, []);

  const userId = profile?.id;

  // Private channel "user:<id>" (only this user may listen: see the realtime.messages policy).
  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    let channel: ReturnType<typeof client.channel> | null = null;
    let cancelled = false;
    void (async () => {
      await client.realtime.setAuth();
      if (cancelled) return;
      channel = client
        .channel(`user:${userId}`, { config: { private: true } })
        .on('broadcast', { event: 'call' }, ({ payload }) => handle(payload as CallEvent))
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('[calls] channel', status, err);
        });
    })();
    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [userId, handle]);

  // Rings delivered by Web Push while the app is open arrive via the service worker.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.source === 'familycall-sw' && e.data.event) handle(e.data.event as CallEvent);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [handle]);

  // Register the service worker, and keep this device subscribed for call alerts
  // if the person already allowed notifications.
  useEffect(() => {
    if (!userId) return;
    void registerServiceWorker().then(() => enablePush(false).catch((err) => console.warn('[push]', err)));
  }, [userId]);

  // "Last seen" heartbeat while the app is visible.
  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      // (Supabase queries only run once awaited/then-ed.)
      client
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', userId)
        .then(({ error }) => error && console.warn('[calls] heartbeat', error.message));
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [userId]);

  // Stop ringing when the call expires.
  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(() => {
      setIncoming((current) => (current?.callId === incoming.callId ? null : current));
      setMissedFrom(incoming.from);
    }, Math.max(0, incoming.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [incoming]);

  const ring = useCallback(
    (calleeId: string, roomId: string) => api<{ callId: string; devices: number }>('ring', { calleeId, roomId }),
    [],
  );
  const cancel = useCallback(async (callId: string, reason?: 'timeout') => {
    await api('cancel', { callId, reason });
  }, []);
  const listen = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const accept = () => {
    if (!incoming) return;
    const call = incoming;
    setIncoming(null);
    void closeNotifications(call.callId);
    void api('answer', { callId: call.callId }).catch((err) => console.warn('[calls] answer', err));
    navigate(`/room/${call.roomId}?call=${call.callId}&answer=1`);
  };
  const decline = () => {
    if (!incoming) return;
    const call = incoming;
    setIncoming(null);
    void closeNotifications(call.callId);
    void api('decline', { callId: call.callId }).catch((err) => console.warn('[calls] decline', err));
  };

  const value = useMemo(
    () => ({ incoming, ring, cancel, listen, missedFrom, dismissMissed: () => setMissedFrom(null) }),
    [incoming, ring, cancel, listen, missedFrom],
  );

  return (
    <CallsContext.Provider value={value}>
      {children}
      {incoming && <IncomingCallScreen call={incoming} onAccept={accept} onDecline={decline} />}
    </CallsContext.Provider>
  );
}

async function closeNotifications(callId: string) {
  const registration = await navigator.serviceWorker?.getRegistration();
  const notifications = await registration?.getNotifications({ tag: callId });
  notifications?.forEach((n) => n.close());
}

export function useCalls(): CallsState | null {
  return useContext(CallsContext);
}
