// FamilyCall server API: accounts, contacts, push registration and call ringing.
//
// Everything that needs more than the signed-in user's own RLS access happens here,
// using the project's secret key. The browser calls it with
//   POST /functions/v1/family  { "action": "...", ... }
// and, for signed-in actions, its access token in the Authorization header.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import webpush from 'npm:web-push@3.6.7';

// ---------------------------------------------------------------------------
// Setup

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SECRET_KEY = (() => {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (keys.default) return keys.default as string;
  } catch {
    // fall through to the legacy key
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
})();

const admin: SupabaseClient = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Accounts use usernames; Supabase Auth needs an email, so we derive one that is never mailed. */
export const LOGIN_EMAIL_DOMAIN = 'users.familycall.app';
const USERNAME = /^[a-z]{3,20}[0-9]{0,3}$/;
const ROOM_ID = /^[a-z0-9-]{4,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RING_SECONDS = 45;
const VAPID_SUBJECT = 'https://familycall.vercel.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function str(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `Missing or invalid ${field}`);
  return value.trim();
}

// ---------------------------------------------------------------------------
// Request handling

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  try {
    switch (body.action) {
      // No sign-in needed
      case 'suggestUsername':
        return json(await suggestUsername(body));
      case 'signup':
        return json(await signup(body));
      case 'vapidPublicKey':
        return json({ publicKey: (await vapidKeys()).publicKey });
    }

    const me = await requireUser(req);
    switch (body.action) {
      case 'addContact':
        return json(await addContact(me, body));
      case 'savePush':
        return json(await savePush(me, body));
      case 'ring':
        return json(await ring(me, body));
      case 'cancel':
        return json(await endRinging(me, body, 'caller'));
      case 'decline':
        return json(await endRinging(me, body, 'decline'));
      case 'answer':
        return json(await endRinging(me, body, 'answer'));
      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});

async function requireUser(req: Request): Promise<string> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please sign in');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Please sign in again');
  return data.user.id;
}

// ---------------------------------------------------------------------------
// Accounts

/** Lowercase letters only, accents removed ("José" → "jose"). */
function letters(name: string): string {
  return name.normalize('NFKD').replace(/[^a-zA-Z]/g, '').toLowerCase();
}

/** "Manish Solanki" → masolanki, mansolanki, manisolanki, manishsolanki, masolanki2, … */
function usernameCandidates(firstName: string, lastName: string): string[] {
  const first = letters(firstName);
  const last = letters(lastName);
  const out: string[] = [];
  const add = (u: string) => {
    if (USERNAME.test(u) && !out.includes(u)) out.push(u);
  };
  if (first && last) {
    for (let n = 2; n <= first.length; n++) add((first.slice(0, n) + last).slice(0, 20));
    for (let i = 2; i <= 99; i++) add((first.slice(0, 2) + last).slice(0, 20) + i);
  } else {
    const only = (first || last).slice(0, 20);
    add(only);
    for (let i = 2; i <= 99; i++) add(only + i);
  }
  return out;
}

async function firstFreeUsername(candidates: string[]): Promise<string | null> {
  if (!candidates.length) return null;
  const { data, error } = await admin.from('profiles').select('username').in('username', candidates.slice(0, 60));
  if (error) throw error;
  const taken = new Set((data ?? []).map((r) => r.username));
  return candidates.find((c) => !taken.has(c)) ?? null;
}

async function suggestUsername(body: Record<string, unknown>) {
  const firstName = str(body.firstName, 'first name', 40);
  const lastName = typeof body.lastName === 'string' ? body.lastName.slice(0, 40) : '';
  const wanted = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (wanted) {
    if (!USERNAME.test(wanted)) {
      return { username: wanted, available: false, reason: 'Use 3–20 small letters (a–z), optionally ending in up to 3 digits.' };
    }
    const { data } = await admin.from('profiles').select('id').eq('username', wanted).maybeSingle();
    if (!data) return { username: wanted, available: true };
    return { username: wanted, available: false, reason: 'That username is taken.', suggestion: await firstFreeUsername(usernameCandidates(firstName, lastName)) };
  }
  return { username: await firstFreeUsername(usernameCandidates(firstName, lastName)), available: true };
}

async function signup(body: Record<string, unknown>) {
  const firstName = str(body.firstName, 'first name', 40);
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim().slice(0, 40) : '';
  const username = str(body.username, 'username', 23).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!USERNAME.test(username)) throw new HttpError(400, 'Use 3–20 small letters (a–z) for your username.');
  if (password.length < 6 || password.length > 72) throw new HttpError(400, 'Password must be at least 6 characters.');
  const displayName = `${firstName} ${lastName}`.trim().slice(0, 60);

  const { data: existing } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
  if (existing) throw new HttpError(409, 'That username is taken. Try another one.');

  const { data: created, error } = await admin.auth.admin.createUser({
    email: `${username}@${LOGIN_EMAIL_DOMAIN}`,
    password,
    email_confirm: true, // no emails are ever sent to these addresses
    app_metadata: { username },
    user_metadata: { display_name: displayName },
  });
  if (error || !created.user) {
    if (/already/i.test(error?.message ?? '')) throw new HttpError(409, 'That username is taken. Try another one.');
    throw error ?? new Error('createUser returned no user');
  }

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: created.user.id, username, display_name: displayName });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (profileError.code === '23505') throw new HttpError(409, 'That username is taken. Try another one.');
    throw profileError;
  }
  return { username, displayName };
}

// ---------------------------------------------------------------------------
// Contacts and devices

async function addContact(me: string, body: Record<string, unknown>) {
  const username = str(body.username, 'username', 23).toLowerCase().replace(/^@/, '');
  const { data: target, error } = await admin
    .from('profiles')
    .select('id, username, display_name')
    .eq('username', username)
    .maybeSingle();
  if (error) throw error;
  if (!target) throw new HttpError(404, `No one has the username “${username}”.`);
  if (target.id === me) throw new HttpError(400, 'That’s your own username.');
  const { error: insertError } = await admin
    .from('contacts')
    .upsert({ owner_id: me, contact_id: target.id }, { onConflict: 'owner_id,contact_id', ignoreDuplicates: true });
  if (insertError) throw insertError;
  return { contact: target };
}

async function savePush(me: string, body: Record<string, unknown>) {
  const endpoint = str(body.endpoint, 'endpoint', 1000);
  const p256dh = str(body.p256dh, 'p256dh', 200);
  const auth = str(body.auth, 'auth', 100);
  if (!endpoint.startsWith('https://')) throw new HttpError(400, 'Invalid push endpoint');
  const { error } = await admin
    .from('push_subscriptions')
    .upsert({ user_id: me, endpoint, p256dh, auth, created_at: new Date().toISOString() }, { onConflict: 'endpoint' });
  if (error) throw error;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Calls

type Profile = { id: string; username: string; display_name: string };

async function profile(id: string): Promise<Profile> {
  const { data, error } = await admin.from('profiles').select('id, username, display_name').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'That person’s account no longer exists.');
  return data;
}

async function ring(me: string, body: Record<string, unknown>) {
  const calleeId = str(body.calleeId, 'calleeId', 40);
  const roomId = str(body.roomId, 'roomId', 40);
  if (!UUID.test(calleeId)) throw new HttpError(400, 'Invalid calleeId');
  if (!ROOM_ID.test(roomId)) throw new HttpError(400, 'Invalid roomId');
  if (calleeId === me) throw new HttpError(400, 'You can’t call yourself.');

  const [caller, callee] = await Promise.all([profile(me), profile(calleeId)]);
  const { data: call, error } = await admin
    .from('calls')
    .insert({ caller_id: me, callee_id: callee.id, room_id: roomId })
    .select('id, created_at')
    .single();
  if (error) throw error;

  const event = {
    type: 'ring',
    callId: call.id,
    roomId,
    from: { id: caller.id, username: caller.username, displayName: caller.display_name },
    expiresAt: Date.now() + RING_SECONDS * 1000,
  };
  const [, devices] = await Promise.all([notify(callee.id, event), push(callee.id, event, call.id)]);
  return { callId: call.id, callee: { id: callee.id, username: callee.username, displayName: callee.display_name }, devices };
}

/** Stop a ringing call: the caller cancels (or gives up), or the callee declines or answers. */
async function endRinging(me: string, body: Record<string, unknown>, kind: 'caller' | 'decline' | 'answer') {
  const callId = str(body.callId, 'callId', 40);
  if (!UUID.test(callId)) throw new HttpError(400, 'Invalid callId');
  const { data: call, error } = await admin
    .from('calls')
    .select('id, caller_id, callee_id, status')
    .eq('id', callId)
    .maybeSingle();
  if (error) throw error;
  const allowed = kind === 'caller' ? call?.caller_id === me : call?.callee_id === me;
  if (!call || !allowed) throw new HttpError(404, 'Call not found');

  const status =
    kind === 'answer' ? 'answered' : kind === 'decline' ? 'declined' : body.reason === 'timeout' ? 'missed' : 'cancelled';
  if (call.status === 'ringing') {
    const { error: updateError } = await admin
      .from('calls')
      .update({ status, ended_at: new Date().toISOString() })
      .eq('id', callId)
      .eq('status', 'ringing');
    if (updateError) throw updateError;
  }

  // Stop the ringing on all of the callee's devices (a missed call names the caller)…
  const caller = await profile(call.caller_id);
  const stop = {
    type: 'stop',
    callId,
    reason: status,
    from: { id: caller.id, username: caller.username, displayName: caller.display_name },
  };
  await Promise.all([notify(call.callee_id, stop), push(call.callee_id, stop, callId)]);
  // …and tell the caller what happened.
  if (kind !== 'caller') await notify(call.caller_id, { type: status, callId });
  return { status };
}

// ---------------------------------------------------------------------------
// Delivery: in-app (Realtime) and Web Push

/** Sends an event to the user's private Realtime channel (reaches any open app). */
async function notify(userId: string, payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: `user:${userId}`, event: 'call', payload, private: true }] }),
  });
  if (!res.ok) console.error('[notify] realtime broadcast failed', res.status, await res.text());
}

type VapidKeys = { publicKey: string; privateKey: string };
let vapidCache: VapidKeys | null = null;

/** The Web Push signing keys, created on first use and kept in the server-only table. */
async function vapidKeys(): Promise<VapidKeys> {
  if (vapidCache) return vapidCache;
  const read = async () => {
    const { data, error } = await admin.from('server_config').select('value').eq('key', 'vapid').maybeSingle();
    if (error) throw error;
    return data?.value as VapidKeys | undefined;
  };
  let keys = await read();
  if (!keys) {
    const fresh = webpush.generateVAPIDKeys();
    await admin.from('server_config').upsert({ key: 'vapid', value: fresh }, { onConflict: 'key', ignoreDuplicates: true });
    keys = await read(); // another request may have won the race
  }
  if (!keys) throw new Error('Could not create VAPID keys');
  vapidCache = keys;
  return keys;
}

/** Sends a push notification to every device the user registered. Returns how many were reached. */
async function push(userId: string, payload: Record<string, unknown>, callId: string): Promise<number> {
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (error) throw error;
  if (!subs?.length) return 0;

  const keys = await vapidKeys();
  const results = await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          {
            vapidDetails: { subject: VAPID_SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey },
            TTL: RING_SECONDS,
            urgency: 'high',
            topic: callId.replace(/-/g, ''), // a later "stop" replaces an undelivered "ring"
          },
        );
        return true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('id', s.id); // device unsubscribed
        } else {
          console.error('[push] failed', status, (err as Error).message);
        }
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}
