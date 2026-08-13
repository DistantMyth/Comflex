/**
 * BackupKeyModal — Shown exactly once when a user claims an anonymous
 * identity. Displays the cryptographic key (`identityId.secret`), which is
 * the ONLY thing proving that identity in the group. The server never stores
 * it — only a one-way hash. Users are strongly advised to save it.
 */

import { useState } from 'react';

export default function BackupKeyModal({ groupName, identity, onDone }) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const key = identity?.identityId && identity?.secret
    ? `${identity.identityId}.${identity.secret}`
    : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="glass-card w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">🔑</span>
          <h2 className="text-xl font-bold">Save your anonymous key</h2>
        </div>

        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          You are now <strong>{identity?.alias}{identity?.aliasTag ? `#${identity.aliasTag}` : ''}</strong> in{' '}
          <strong>{groupName}</strong>. This key is the only way to prove it's you.
          <span className="block mt-2 font-semibold text-[var(--color-warning)]">
            It is shown once and NEVER stored on the server. If you lose it, you
            permanently lose this identity and its message history.
          </span>
        </p>

        <div className="relative bg-[var(--color-bg-primary)] border border-[var(--color-accent)]/30 rounded-xl p-4 mb-4">
          <code className="block text-xs break-all select-all">{key}</code>
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 text-xs btn btn-secondary px-2.5 py-1"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        <label className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)] mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={e => setAcknowledged(e.target.checked)}
            className="mt-0.5 rounded text-[var(--color-accent)]"
          />
          <span>
            I have saved this key somewhere safe (password manager, notes app,
            or paper). I understand the server cannot recover it for me.
          </span>
        </label>

        <button
          onClick={onDone}
          disabled={!acknowledged || !key}
          className="btn btn-primary w-full"
        >
          I've saved my key — Continue
        </button>
      </div>
    </div>
  );
}