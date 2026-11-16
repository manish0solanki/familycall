import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Icon } from './Icon';
import { roomLink } from '../lib/roomId';

/** Room code, copyable link and a QR code family members can scan to join. */
export function InvitePanel({ roomId, compact = false }: { roomId: string; compact?: boolean }) {
  const link = roomLink(roomId);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', link);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'Join my FamilyCall', text: 'Tap to join my video call', url: link });
    } catch {
      // User closed the share sheet.
    }
  };

  const canShare = typeof navigator.share === 'function';

  return (
    <div className={`invite${compact ? ' invite--compact' : ''}`}>
      <div className="invite__qr">
        <QRCodeSVG value={link} size={compact ? 132 : 168} marginSize={2} title="QR code to join this call" />
      </div>
      <div className="invite__body">
        <span className="invite__label">Room code</span>
        <span className="invite__code" data-testid="room-code">{roomId}</span>
        <div className="invite__actions">
          <button type="button" className="btn btn--secondary" onClick={copy}>
            <Icon name={copied ? 'check' : 'link'} size={20} />
            {copied ? 'Link copied' : 'Copy invite link'}
          </button>
          {canShare && (
            <button type="button" className="btn btn--secondary" onClick={share}>
              <Icon name="share" size={20} />
              Share
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
