import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';

/**
 * Signaling = the small messages two phones exchange before (and during) a call
 * so WebRTC can connect them. The video itself never goes through here.
 *
 * In production this uses Supabase Realtime "broadcast" channels (no database needed).
 * Without Supabase settings it falls back to BroadcastChannel, which only connects
 * tabs of the same browser: handy for local development and automated tests.
 */

export type SignalType = 'hello' | 'welcome' | 'description' | 'candidate' | 'bye' | 'full';

export interface SignalMessage {
  type: SignalType;
  /** Sender's peer id (random per browser tab). */
  from: string;
  /** Recipient's peer id; missing means "everyone in the room". */
  to?: string;
  /** Sender's display name. */
  name?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface Signaling {
  readonly kind: 'supabase' | 'local';
  /** Resolves once messages can be sent and received. */
  readonly ready: Promise<void>;
  send(message: SignalMessage): void;
  onMessage(handler: (message: SignalMessage) => void): void;
  close(): void;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const signalingMode: Signaling['kind'] = supabaseUrl && supabaseKey ? 'supabase' : 'local';

class SupabaseSignaling implements Signaling {
  readonly kind = 'supabase' as const;
  readonly ready: Promise<void>;
  /**
   * One realtime connection per call. The client reuses channels by name and removes
   * them asynchronously, so sharing one client would let a quick leave-and-rejoin pick
   * up the half-closed channel.
   */
  private readonly client: RealtimeClient;
  private readonly channel: RealtimeChannel;
  private readonly handlers: Array<(message: SignalMessage) => void> = [];

  constructor(roomId: string) {
    const endpoint = `${supabaseUrl!.replace(/\/$/, '')}/realtime/v1`;
    this.client = new RealtimeClient(endpoint, { params: { apikey: supabaseKey! } });
    this.channel = this.client.channel(`room:${roomId}`, {
      config: { broadcast: { self: false, ack: false } },
    });
    this.channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      for (const handler of this.handlers) handler(payload as SignalMessage);
    });
    this.ready = new Promise((resolve, reject) => {
      this.channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Realtime channel ${status}`));
        }
      });
    });
  }

  send(message: SignalMessage) {
    void this.channel.send({ type: 'broadcast', event: 'signal', payload: message });
  }

  onMessage(handler: (message: SignalMessage) => void) {
    this.handlers.push(handler);
  }

  close() {
    void this.client.removeChannel(this.channel).finally(() => this.client.disconnect());
  }
}

class LocalSignaling implements Signaling {
  readonly kind = 'local' as const;
  readonly ready = Promise.resolve();
  private readonly channel: BroadcastChannel;

  constructor(roomId: string) {
    this.channel = new BroadcastChannel(`familycall:${roomId}`);
  }

  send(message: SignalMessage) {
    this.channel.postMessage(message);
  }

  onMessage(handler: (message: SignalMessage) => void) {
    this.channel.addEventListener('message', (event: MessageEvent<SignalMessage>) => handler(event.data));
  }

  close() {
    this.channel.close();
  }
}

export function createSignaling(roomId: string): Signaling {
  return signalingMode === 'supabase' ? new SupabaseSignaling(roomId) : new LocalSignaling(roomId);
}
