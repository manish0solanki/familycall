import { newRoomId } from './roomId';
import type { Profile } from './supabase';

/** The link inside "My QR code": opening it adds that person as a contact. */
export function addLink(username: string): string {
  return `${window.location.origin}/add/${username}`;
}

/** Opens a new room and rings the contact. */
export function callPath(contact: Pick<Profile, 'id' | 'username' | 'display_name'>): string {
  const q = new URLSearchParams({ to: contact.id, toUser: contact.username, toName: contact.display_name });
  return `/room/${newRoomId()}?${q}`;
}
