/**
 * STUN lets each device discover its public address so most calls connect directly.
 * TURN relays the video when a direct path is blocked (strict Wi-Fi, some mobile networks).
 * A self-hosted TURN server (coturn) is planned for Phase 4; until then it's optional.
 */
export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  const turnUrls = import.meta.env.VITE_TURN_URLS as string | undefined;
  if (turnUrls) {
    servers.push({
      urls: turnUrls.split(',').map((url) => url.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
    });
  }

  return servers;
}
