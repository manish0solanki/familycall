import { getIceServers } from './iceServers';
import { createSignaling, type Signaling, type SignalMessage } from './signaling';

export type CallStatus =
  | 'joining' // connecting to the signaling server
  | 'waiting' // in the room, nobody else here yet
  | 'connecting' // found the other person, setting up video
  | 'connected'
  | 'reconnecting'
  | 'full' // two people are already in this room
  | 'error';

export interface CallState {
  status: CallStatus;
  remoteStream: MediaStream | null;
  remoteName: string | null;
  error?: string;
}

export interface PeerCallOptions {
  roomId: string;
  name: string;
  localStream: MediaStream;
  onChange: (state: CallState) => void;
}

/** Add ?debug to the URL to log every signaling message and connection state change. */
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
function debug(...args: unknown[]) {
  if (DEBUG) console.info('[call]', ...args);
}
function describe(m: Pick<SignalMessage, 'type' | 'description' | 'candidate'>): string {
  if (m.description) return `${m.type}:${m.description.type}`;
  if (m.candidate) return `${m.type}:${m.candidate.candidate?.split(' ')[7] ?? 'end'}`;
  return m.type;
}

/** How often to re-announce ourselves while waiting alone in the room. */
const HELLO_INTERVAL_MS = 3_000;
/** If a call hasn't connected (or a dropped one hasn't recovered) after this long, start over. */
const RECOVERY_TIMEOUT_MS = 15_000;

/**
 * A 1-to-1 WebRTC call in a room.
 *
 * Uses the "perfect negotiation" pattern
 * (https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation)
 * for renegotiation (e.g. ICE restarts). The first offer always comes from whoever
 * was in the room first, so the initial setup never collides.
 */
export class PeerCall {
  readonly id = crypto.randomUUID();

  private readonly opts: PeerCallOptions;
  private signaling: Signaling | null = null;
  private pc: RTCPeerConnection | null = null;
  private remoteId: string | null = null;
  private makingOffer = false;
  private ignoreOffer = false;
  /** Whether our camera/mic tracks are on the current peer connection yet. */
  private tracksAttached = false;
  /** ICE candidates that arrived before the description they belong to. */
  private pendingCandidates: RTCIceCandidateInit[] = [];
  /** Candidates from a peer we haven't paired with yet (their welcome/offer is still in flight). */
  private readonly unpairedCandidates = new Map<string, RTCIceCandidateInit[]>();
  private initiator = false;
  private control: RTCDataChannel | null = null;
  /** When we joined the room; see joinedBefore(). */
  private since = 0;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Messages are handled one at a time so ICE candidates never overtake descriptions. */
  private queue: Promise<void> = Promise.resolve();
  private state: CallState = { status: 'joining', remoteStream: null, remoteName: null };

  constructor(opts: PeerCallOptions) {
    this.opts = opts;
  }

  async start() {
    const signaling = createSignaling(this.opts.roomId);
    this.signaling = signaling;
    signaling.onMessage((message) => {
      this.queue = this.queue.then(() => this.handle(message)).catch((err) => console.error('[call]', err));
    });

    try {
      await signaling.ready;
    } catch (err) {
      console.error('[call] signaling failed', err);
      this.update({ status: 'error', error: 'Could not reach the call server. Check your internet connection and try again.' });
      return;
    }
    if (this.closed) return;

    this.since = Date.now();
    this.update({ status: 'waiting' });
    this.send({ type: 'hello' });
    // Broadcast messages can be dropped, so keep announcing ourselves while alone.
    this.helloTimer = setInterval(() => {
      if (this.state.status === 'waiting') this.send({ type: 'hello' });
    }, HELLO_INTERVAL_MS);
  }

  /** Swap the camera track being sent (e.g. after switching front/back camera). */
  async replaceVideoTrack(track: MediaStreamTrack) {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
    await sender?.replaceTrack(track);
  }

  leave() {
    if (this.closed) return;
    if (this.remoteId) this.send({ type: 'bye', to: this.remoteId });
    if (this.control?.readyState === 'open') this.control.send('bye');
    this.closed = true;
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.teardownPeer();
    this.signaling?.close();
  }

  // ---------------------------------------------------------------------------

  private update(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    if (!this.closed) this.opts.onChange(this.state);
  }

  private send(message: Omit<SignalMessage, 'from' | 'name'>) {
    debug('send', describe(message));
    this.signaling?.send({ ...message, from: this.id, name: this.opts.name, since: this.since });
  }

  /** Whether we joined before the sender of `m` (ties broken by id). The earlier one sends the offer. */
  private joinedBefore(m: SignalMessage): boolean {
    const theirs = m.since ?? Number.MAX_SAFE_INTEGER;
    return this.since < theirs || (this.since === theirs && this.id < m.from);
  }

  /** The "polite" peer backs down when both send an offer at the same time. */
  private get polite() {
    return this.remoteId !== null && this.id < this.remoteId;
  }

  private async handle(m: SignalMessage) {
    if (this.closed || m.from === this.id) return;
    if (m.to && m.to !== this.id) return;
    debug('recv', describe(m));

    switch (m.type) {
      case 'hello': {
        if (this.remoteId === m.from) {
          // They're still announcing, so our welcome or offer was probably lost: resend.
          if (this.initiator && this.state.status === 'connecting') {
            this.send({ type: 'welcome', to: m.from });
            const offer = this.pc?.localDescription;
            if (offer?.type === 'offer') this.send({ type: 'description', to: m.from, description: offer.toJSON() });
          }
          return;
        }
        if (this.remoteId) {
          // Already in a call with someone else. Phase 1 supports two people per room.
          this.send({ type: 'full', to: m.from });
          return;
        }
        if (this.joinedBefore(m)) {
          // We were here first, so we send the offer.
          this.connectTo(m.from, m.name, true);
          this.send({ type: 'welcome', to: m.from });
        } else {
          // They were here first; make sure they've heard from us so they send the offer.
          this.send({ type: 'hello', to: m.from });
        }
        return;
      }
      case 'welcome': {
        if (this.remoteId && this.remoteId !== m.from) {
          // We paired with someone else first; tell this peer to go back to waiting.
          this.send({ type: 'bye', to: m.from });
          return;
        }
        // We joined, so we wait for their offer and answer it.
        if (!this.remoteId) this.connectTo(m.from, m.name, false);
        return;
      }
      case 'full': {
        if (!this.remoteId) this.update({ status: 'full' });
        return;
      }
      case 'bye': {
        if (m.from === this.remoteId) this.resetToWaiting(false);
        return;
      }
      case 'description': {
        if (!m.description) return;
        // An offer can overtake the "welcome" sent just before it; it implies the same thing.
        if (!this.remoteId && m.description.type === 'offer' && this.state.status === 'waiting') {
          this.connectTo(m.from, m.name, false);
        }
        if (m.from === this.remoteId) await this.onDescription(m.description);
        return;
      }
      case 'candidate': {
        if (!m.candidate) return;
        if (!this.remoteId && this.state.status === 'waiting') {
          // May belong to a peer whose welcome/offer hasn't arrived yet.
          const early = this.unpairedCandidates.get(m.from) ?? [];
          early.push(m.candidate);
          this.unpairedCandidates.set(m.from, early);
          return;
        }
        if (m.from !== this.remoteId || !this.pc) return;
        // Supabase Realtime doesn't guarantee ordering: a candidate can arrive before the
        // offer/answer it belongs to. Hold it until the remote description is set.
        if (!this.pc.remoteDescription) {
          this.pendingCandidates.push(m.candidate);
          return;
        }
        await this.addCandidate(m.candidate);
        return;
      }
    }
  }

  /**
   * @param initiator Whether we send the first offer. Only one side does: if both
   *   offer at the same moment, Chrome can stall after rolling back its own offer
   *   (it stops sending ICE candidates), leaving both people stuck on "Connecting…".
   */
  private connectTo(peerId: string, name: string | undefined, initiator: boolean) {
    this.remoteId = peerId;
    this.initiator = initiator;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.tracksAttached = false;
    this.pendingCandidates = this.unpairedCandidates.get(peerId) ?? [];
    this.unpairedCandidates.clear();

    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    this.pc = pc;

    // Adding tracks triggers negotiationneeded → offer. The answering side attaches
    // its tracks to the offered transceivers instead (see attachTracksToOffer).
    if (initiator) {
      // Direct device-to-device control channel (the answerer gets it via ondatachannel).
      this.setupControl(pc, pc.createDataChannel('control'));
      const { localStream } = this.opts;
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
      this.tracksAttached = true;
    }

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? this.state.remoteStream ?? new MediaStream();
      if (!stream.getTracks().includes(track)) stream.addTrack(track);
      this.update({ remoteStream: stream });
    };

    pc.ondatachannel = ({ channel }) => {
      if (channel.label === 'control') this.setupControl(pc, channel);
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: 'candidate', to: peerId, candidate: candidate.toJSON() });
    };

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ type: 'description', to: peerId, description: pc.localDescription!.toJSON() });
      } catch (err) {
        console.error('[call] negotiation failed', err);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      debug('connection', pc.connectionState, 'ice', pc.iceConnectionState);
      switch (pc.connectionState) {
        case 'connected':
          this.clearRecoveryTimer();
          this.update({ status: 'connected' });
          break;
        case 'disconnected':
          this.update({ status: 'reconnecting' });
          this.startRecoveryTimer();
          break;
        case 'failed':
          this.update({ status: 'reconnecting' });
          pc.restartIce();
          this.startRecoveryTimer();
          break;
      }
    };

    this.update({ status: 'connecting', remoteName: name || 'Family member' });
    // If setup stalls (lost messages, blocked network), start over instead of hanging.
    this.startRecoveryTimer();
  }

  private async onDescription(description: RTCSessionDescriptionInit) {
    const pc = this.pc;
    if (!pc) return;

    const offerCollision =
      description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    await pc.setRemoteDescription(description);
    const early = this.pendingCandidates.splice(0);
    for (const candidate of early) await this.addCandidate(candidate);
    if (description.type === 'offer') {
      if (!this.tracksAttached) await this.attachTracksToOffer(pc);
      await pc.setLocalDescription();
      this.send({ type: 'description', to: this.remoteId!, description: pc.localDescription!.toJSON() });
    }
  }

  /**
   * Hang-ups sent through Supabase can be lost when a tab closes, so the "bye" also goes
   * device-to-device, and the channel closing (the other side's connection went away)
   * counts as a hang-up too. Both arrive within a moment instead of ~20 s of timeouts.
   */
  private setupControl(pc: RTCPeerConnection, channel: RTCDataChannel) {
    this.control = channel;
    const hungUp = () => {
      if (pc === this.pc && !this.closed) {
        debug('remote hung up (control channel)');
        this.resetToWaiting(false);
      }
    };
    channel.onmessage = ({ data }) => {
      if (data === 'bye') hungUp();
    };
    channel.onclose = hungUp;
  }

  private async addCandidate(candidate: RTCIceCandidateInit) {
    try {
      await this.pc?.addIceCandidate(candidate);
    } catch (err) {
      if (!this.ignoreOffer) console.warn('[call] could not add ICE candidate', err);
    }
  }

  /** Send our camera and mic on the transceivers the other side offered, so the answer carries them. */
  private async attachTracksToOffer(pc: RTCPeerConnection) {
    const { localStream } = this.opts;
    const unused = [...localStream.getTracks()];
    for (const transceiver of pc.getTransceivers()) {
      const kind = transceiver.receiver.track.kind;
      const index = unused.findIndex((t) => t.kind === kind);
      if (index === -1) continue;
      const [track] = unused.splice(index, 1);
      await transceiver.sender.replaceTrack(track);
      transceiver.sender.setStreams(localStream);
      transceiver.direction = 'sendrecv';
    }
    // Anything the offer had no slot for (unusual) gets added and renegotiated.
    for (const track of unused) pc.addTrack(track, localStream);
    this.tracksAttached = true;
  }

  private startRecoveryTimer() {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (this.pc && this.pc.connectionState !== 'connected') this.resetToWaiting(true);
    }, RECOVERY_TIMEOUT_MS);
  }

  private clearRecoveryTimer() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  /** Drop the current peer and wait for someone to (re)join. */
  private resetToWaiting(announce: boolean) {
    this.teardownPeer();
    this.update({ status: 'waiting', remoteStream: null, remoteName: null });
    if (announce) this.send({ type: 'hello' });
  }

  private teardownPeer() {
    this.clearRecoveryTimer();
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onnegotiationneeded = null;
      this.pc.onconnectionstatechange = null;
      this.pc.ondatachannel = null;
      this.pc.close();
    }
    this.pc = null;
    this.control = null;
    this.remoteId = null;
  }
}
