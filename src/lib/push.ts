import { api } from './supabase';

/**
 * Call alerts: a Web Push subscription lets the server ring this device even when
 * FamilyCall isn't open. On iPhone this only works once the app is added to the
 * Home Screen (iOS 16.4+).
 */
export type PushState = 'unsupported' | 'needs-install' | 'off' | 'blocked' | 'on';

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('[push] service worker registration failed', err);
    return null;
  }
}

export function pushState(): PushState {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted') return 'on';
  return 'off';
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Subscribes this device and tells the server, so calls ring here.
 * `ask` shows the browser's permission prompt (must come from a tap).
 */
export async function enablePush(ask: boolean): Promise<PushState> {
  const state = pushState();
  if (state === 'unsupported' || state === 'needs-install' || state === 'blocked') return state;
  if (state === 'off') {
    if (!ask) return 'off';
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  }
  const registration = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!registration) return 'unsupported';
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { publicKey } = await api<{ publicKey: string }>('vapidPublicKey');
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    });
  }
  const json = subscription.toJSON();
  await api('savePush', { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth });
  return 'on';
}
