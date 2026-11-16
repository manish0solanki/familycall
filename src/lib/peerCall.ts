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

/** If a dropped connection hasn't recovered after this long, start over. */
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

    this.update({ status: 'waiting' });
    this.send({ type: 'hello' });
  }

  /** Swap the camera track being sent (e.g. after switching front/back camera). */
  async replaceVideoTrack(track: MediaStreamTrack) {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
    await sender?.replaceTrack(track);
  }

  leave() {
    if (this.closed) return;
    if (this.remoteId) this.send({ type: 'bye', to: this.remoteId });
    this.closed = true;
    this.teardownPeer();
    this.signaling?.close();
  }

  // ---------------------------------------------------------------------------

  private update(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    if (!this.closed) this.opts.onChange(this.state);
  }

  private send(message: Omit<SignalMessage, 'from' | 'name'>) {
    this.signaling?.send({ ...message, from: this.id, name: this.opts.name });
  }

  /** The "polite" peer backs down when both send an offer at the same time. */
  private get polite() {
    return this.remoteId !== null && this.id < this.remoteId;
  }

  private async handle(m: SignalMessage) {
    if (this.closed || m.from === this.id) return;
    if (m.to && m.to !== this.id) return;

    switch (m.type) {
      case 'hello': {
        if (this.remoteId === m.from) return;
        if (this.remoteId) {
          // Already in a call with someone else. Phase 1 supports two people per room.
          this.send({ type: 'full', to: m.from });
          return;
        }
        // We were here first, so we send the offer.
        this.connectTo(m.from, m.name, true);
        this.send({ type: 'welcome', to: m.from });
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
        if (m.from === this.remoteId && m.description) await this.onDescription(m.description);
        return;
      }
      case 'candidate': {
        if (m.from !== this.remoteId || !m.candidate || !this.pc) return;
        try {
          await this.pc.addIceCandidate(m.candidate);
        } catch (err) {
          if (!this.ignoreOffer) console.warn('[call] could not add ICE candidate', err);
        }
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
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.tracksAttached = false;

    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    this.pc = pc;

    // Adding tracks triggers negotiationneeded → offer. The answering side attaches
    // its tracks to the offered transceivers instead (see attachTracksToOffer).
    if (initiator) {
      const { localStream } = this.opts;
      for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
      this.tracksAttached = true;
    }

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? this.state.remoteStream ?? new MediaStream();
      if (!stream.getTracks().includes(track)) stream.addTrack(track);
      this.update({ remoteStream: stream });
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
  }

  private async onDescription(description: RTCSessionDescriptionInit) {
    const pc = this.pc;
    if (!pc) return;

    const offerCollision =
      description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      if (!this.tracksAttached) await this.attachTracksToOffer(pc);
      await pc.setLocalDescription();
      this.send({ type: 'description', to: this.remoteId!, description: pc.localDescription!.toJSON() });
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
      this.pc.close();
    }
    this.pc = null;
    this.remoteId = null;
  }
}
