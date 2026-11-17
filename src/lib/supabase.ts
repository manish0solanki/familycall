import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Signed-in features (accounts, contacts, ringing) need Supabase; link calls work without it. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/**
 * Accounts are username + password. Supabase Auth needs an email address, so each
 * username maps to one on a domain that is never mailed (must match the "family" function).
 */
export const LOGIN_EMAIL_DOMAIN = 'users.familycall.app';
export const loginEmail = (username: string) => `${username.trim().toLowerCase()}@${LOGIN_EMAIL_DOMAIN}`;

export const USERNAME_PATTERN = /^[a-z]{3,20}[0-9]{0,3}$/;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Calls the "family" Edge Function (accounts, contacts, ringing). */
export async function api<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  if (!supabase || !url || !key) throw new ApiError(0, 'This site isn’t connected to its server.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, '')}/functions/v1/family`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your internet connection.');
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'Something went wrong. Please try again.');
  return json;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  last_seen?: string | null;
  /** When the account last saved a recovery code (only visible on your own profile). */
  recovery_set_at?: string | null;
}

/** "Online" if the app was open in the last 2 minutes (it checks in every minute). */
export function isOnline(lastSeen?: string | null): boolean {
  return Boolean(lastSeen) && Date.now() - new Date(lastSeen!).getTime() < 2 * 60_000;
}

export function lastSeenText(lastSeen?: string | null): string {
  if (!lastSeen) return 'Not seen yet';
  if (isOnline(lastSeen)) return 'Online';
  const mins = Math.round((Date.now() - new Date(lastSeen).getTime()) / 60_000);
  if (mins < 60) return `Last seen ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Last seen ${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Last seen yesterday' : `Last seen ${days} days ago`;
}
