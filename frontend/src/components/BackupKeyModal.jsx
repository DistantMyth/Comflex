/**
 * BackupKeyModal — Shown when a user claims an anonymous identity.
 *
 * Displays the cryptographic key (`identityId.secret`), which is
 * the ONLY proof of that identity in the group. The server never stores
 * it — only a one-way hash. Users are strongly advised to save it.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  KeyRound,
  Copy,
  Check,
  Download,
  AlertTriangle,
  ShieldCheck,
  ArrowRight,
  Lock
} from 'lucide-react';

export default function BackupKeyModal({ groupName, identity, onDone }) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const key = identity?.identityId && identity?.secret
    ? `${identity.identityId}.${identity.secret}`
    : '';

  const aliasFull = identity?.alias
    ? `${identity.alias}${identity.aliasTag ? `#${identity.aliasTag}` : ''}`
    : 'Anonymous';

  const handleCopy = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback for older browsers or restricted environments
      try {
        const textarea = document.createElement('textarea');
        textarea.value = key;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      } catch {
        /* ignore */
      }
    }
  };

  const handleDownloadBackup = () => {
    if (!key) return;
    try {
      const fileContent = [
        '==================================================',
        '        COMFLEX ANONYMOUS GROUP BACKUP KEY        ',
        '==================================================',
        '',
        `Group:      ${groupName || 'Anonymous Group'}`,
        `Alias:      ${aliasFull}`,
        `Key:        ${key}`,
        `Created At: ${new Date().toLocaleString()}`,
        '',
        'WARNING: Keep this cryptographic key strictly confidential.',
        'The server only stores a one-way hash. If you lose this key,',
        'you permanently lose ownership of this anonymous alias and its history.',
        '==================================================',
      ].join('\n');

      const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `comflex-key-${(identity?.alias || 'anon').toLowerCase().replace(/[^a-z0-9]/gi, '_')}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2200);
    } catch {
      /* ignore */
    }
  };

  // Keyboard shortcut: Enter to submit if acknowledged
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && acknowledged && key) {
        onDone?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [acknowledged, key, onDone]);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-[60] p-4 sm:p-6 overflow-y-auto">
        {/* Soft atmospheric glow */}
        <div className="fixed w-96 h-96 rounded-full bg-[var(--palette-teal)]/15 blur-3xl pointer-events-none -top-12 -left-12" />
        <div className="fixed w-80 h-80 rounded-full bg-[var(--palette-rose)]/15 blur-3xl pointer-events-none -bottom-10 -right-10" />

        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 14 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="glass-card w-full max-w-lg p-6 sm:p-8 relative border border-[var(--color-border)] shadow-2xl overflow-hidden my-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top accent gradient bar */}
          <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-[var(--palette-teal)] via-[var(--palette-sage)] to-[var(--palette-rose)]" />

          {/* Header Icon + Title */}
          <div className="flex items-start gap-3.5 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--palette-teal)]/20 to-[var(--palette-plum)]/20 border border-[var(--palette-teal)]/30 flex items-center justify-center text-[var(--palette-teal)] shadow-sm flex-shrink-0">
              <KeyRound size={24} className="text-[var(--color-accent)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-bold font-display text-[var(--color-text-primary)]">
                  Save your anonymous key
                </h2>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Zero-knowledge cryptographic credential
              </p>
            </div>
          </div>

          {/* Identity Context */}
          <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-4">
            You are now{' '}
            <span className="font-semibold text-[var(--color-text-primary)] px-1.5 py-0.5 rounded-md bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
              {aliasFull}
            </span>{' '}
            in{' '}
            <span className="font-semibold text-[var(--color-text-primary)]">
              {groupName || 'this group'}
            </span>
            . This key is the only way to prove your identity and recover your messages.
          </p>

          {/* Warning Banner */}
          <div className="p-3.5 rounded-xl bg-[var(--palette-rose)]/10 border border-[var(--palette-rose)]/30 mb-5 flex items-start gap-3">
            <AlertTriangle size={18} className="text-[var(--color-danger)] flex-shrink-0 mt-0.5" />
            <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              <strong className="text-[var(--color-danger)] block font-semibold mb-0.5">
                Shown once and NEVER stored on the server!
              </strong>
              The backend stores only a one-way hash. If you lose or delete this key, you permanently lose this alias and can never post as it again.
            </div>
          </div>

          {/* Key Code Display */}
          <div className="relative bg-[var(--color-bg-input)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 rounded-xl p-3.5 sm:p-4 mb-4 transition-colors group">
            <div className="flex items-center justify-between text-[11px] font-medium text-[var(--color-text-muted)] mb-2">
              <span className="flex items-center gap-1.5 text-[var(--palette-teal)]">
                <Lock size={12} /> Cryptographic Key Token
              </span>
              <span className="text-[10px] uppercase tracking-wider opacity-70 font-mono">
                {key.length > 0 ? `${key.length} chars` : 'Empty'}
              </span>
            </div>

            <code className="block text-xs sm:text-sm font-mono break-all select-all text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)] p-2.5 rounded-lg border border-[var(--color-border)] leading-relaxed">
              {key || 'No key generated'}
            </code>

            {/* Quick Action Buttons */}
            <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-[var(--color-border)]">
              <button
                type="button"
                onClick={handleDownloadBackup}
                disabled={!key}
                className="btn btn-secondary text-xs py-1.5 px-3 rounded-lg"
                title="Download key as a text file"
              >
                {downloaded ? (
                  <>
                    <Check size={13} className="text-[var(--color-success)]" />
                    <span className="text-[var(--color-success)] font-medium">Downloaded!</span>
                  </>
                ) : (
                  <>
                    <Download size={13} />
                    <span>Download .txt</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleCopy}
                disabled={!key}
                className={`btn text-xs py-1.5 px-3 rounded-lg transition-colors ${
                  copied
                    ? 'bg-[var(--color-success)]/15 border border-[var(--color-success)]/30 text-[var(--color-success)]'
                    : 'btn-primary'
                }`}
                title="Copy key to clipboard"
              >
                {copied ? (
                  <>
                    <Check size={13} className="text-[var(--color-success)]" />
                    <span className="font-semibold text-[var(--color-success)]">Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy Key</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Acknowledgment Checkbox */}
          <label className="flex items-start gap-3 text-xs text-[var(--color-text-secondary)] mb-6 cursor-pointer p-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-hover)] transition-colors select-none">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)] cursor-pointer accent-[var(--palette-teal)]"
            />
            <span className="leading-relaxed">
              I have safely backed up this cryptographic key (e.g. in a password manager, notes app, or file). I understand the Comflex team cannot recover it for me.
            </span>
          </label>

          {/* Continue Button */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              onClick={onDone}
              disabled={!acknowledged || !key}
              className="btn btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ShieldCheck size={16} />
              <span>I've saved my key — Continue</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
