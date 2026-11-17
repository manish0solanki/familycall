/* FamilyCall service worker: rings the phone for incoming calls via Web Push. */
/* global self, clients */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const ICON = '/icons/icon-192.png';
const BADGE = '/icons/badge-96.png';

async function windows() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    return;
  }
  event.waitUntil(handlePush(data));
});

async function handlePush(data) {
  const open = await windows();
  // Let any open app show its own incoming-call screen.
  for (const client of open) client.postMessage({ source: 'familycall-sw', event: data });
  const visible = open.some((c) => c.visibilityState === 'visible');

  if (data.type === 'ring') {
    if (visible) return; // the app is on screen and is ringing already
    if (data.expiresAt && data.expiresAt < Date.now()) return;
    const name = (data.from && data.from.displayName) || 'Someone';
    await self.registration.showNotification(`${name} is calling`, {
      body: 'FamilyCall video call · Tap to answer',
      tag: data.callId,
      renotify: true,
      requireInteraction: true,
      icon: ICON,
      badge: BADGE,
      vibrate: [800, 400, 800, 400, 800, 400, 800],
      data: { url: `/room/${data.roomId}?call=${data.callId}&answer=1`, callId: data.callId },
      actions: [{ action: 'answer', title: 'Answer' }],
    });
    return;
  }

  if (data.type === 'stop') {
    const shown = await self.registration.getNotifications({ tag: data.callId });
    shown.forEach((n) => n.close());
    const missed = data.reason === 'missed' || data.reason === 'cancelled';
    if (missed && shown.length && !visible) {
      const name = (data.from && data.from.displayName) || 'someone';
      await self.registration.showNotification(`Missed call from ${name}`, {
        body: 'Tap to open FamilyCall',
        tag: `missed-${data.callId}`,
        icon: ICON,
        badge: BADGE,
        data: { url: '/' },
      });
    }
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const open = await windows();
      for (const client of open) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(url);
              return;
            } catch {
              // fall through to opening a new window
            }
          }
        }
      }
      await clients.openWindow(url);
    })(),
  );
});
