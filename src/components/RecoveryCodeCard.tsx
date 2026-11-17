import { useState } from 'react';
import { Icon } from './Icon';

/**
 * Shows a recovery code once, with copy / save buttons, and asks the person to confirm
 * they've kept it before continuing. Without email, this code is the only way to reset
 * a forgotten password.
 */
export function RecoveryCodeCard({ code, username, onDone, doneLabel = 'Continue' }: { code: string; username: string; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const text = `FamilyCall recovery code\n\nUsername: ${username}\nRecovery code: ${code}\n\nUse this on the sign-in screen (“Forgot password?”) to set a new password.\nEach code works once; you’ll get a new one after using it.\n`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy your recovery code:', code);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `familycall-recovery-${username}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="card recovery" aria-labelledby="recovery-title">
      <h2 id="recovery-title">Save your recovery code</h2>
      <p className="muted">
        If you ever forget your password, this code lets you set a new one. Write it down or save it somewhere safe.
        It’s shown only now.
      </p>
      <p className="recovery__code" data-testid="recovery-code">{code}</p>
      <div className="recovery__actions">
        <button type="button" className="btn btn--secondary" onClick={() => void copy()}>
          <Icon name={copied ? 'check' : 'link'} size={20} />
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={download}>
          <Icon name="share" size={20} />
          Save as file
        </button>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I’ve saved my recovery code
      </label>
      <button type="button" className="btn btn--primary btn--lg btn--block" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </button>
    </section>
  );
}
