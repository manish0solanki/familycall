import { useEffect } from 'react';
import type { IncomingCall } from '../lib/calls';
import { playRingtone } from '../lib/tones';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

/** Full-screen "Mom is calling…" with Accept / Decline, ringtone and vibration. */
export function IncomingCallScreen({ call, onAccept, onDecline }: { call: IncomingCall; onAccept: () => void; onDecline: () => void }) {
  useEffect(() => playRingtone(), [call.callId]);

  return (
    <div className="incoming" role="alertdialog" aria-modal="true" aria-labelledby="incoming-name" aria-describedby="incoming-desc">
      <div className="incoming__top">
        <span className="incoming__label">FamilyCall · Video call</span>
        <div className="incoming__rings">
          <Avatar name={call.from.displayName} seed={call.from.username} size={120} />
        </div>
        <h1 id="incoming-name">{call.from.displayName}</h1>
        <p id="incoming-desc">is calling you…</p>
      </div>
      <div className="incoming__actions">
        <button type="button" className="incoming__btn" onClick={onDecline}>
          <span className="incoming__circle incoming__circle--decline"><Icon name="phone" size={32} className="icon-hangup" /></span>
          Decline
        </button>
        <button type="button" className="incoming__btn" onClick={onAccept} autoFocus>
          <span className="incoming__circle incoming__circle--accept"><Icon name="video" size={32} /></span>
          Accept
        </button>
      </div>
    </div>
  );
}
