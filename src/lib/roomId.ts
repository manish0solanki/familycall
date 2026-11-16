// No 0/o, 1/l/i: easier to read out loud to grandparents.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A room code like "k7d-mq3x-p9a". ~50 bits of randomness, so codes can't be guessed. */
export function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 3)}-${chars.slice(3, 7)}-${chars.slice(7, 10)}`;
}

const ROOM_PATTERN = /^[a-z0-9-]{4,40}$/;

export function isValidRoomId(value: string): boolean {
  return ROOM_PATTERN.test(value);
}

/** Accepts a bare code ("k7d-mq3x-p9a") or a full invite link and returns the code. */
export function parseRoomInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const match = trimmed.match(/\/room\/([a-z0-9-]+)/);
  const code = match ? match[1] : trimmed.replace(/\s+/g, '');
  return isValidRoomId(code) ? code : null;
}

export function roomLink(roomId: string): string {
  return `${window.location.origin}/room/${roomId}`;
}
