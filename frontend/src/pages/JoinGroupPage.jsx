import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight, Users, KeyRound } from 'lucide-react';
import { setAnonSession } from '../api/client';
import { groupApi } from '../api/groupApi';
import BackupKeyModal from '../components/BackupKeyModal';

export default function JoinGroupPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('joining');
  const [errorMsg, setErrorMsg] = useState('');
  const [alias, setAlias] = useState('');
  const [anonResult, setAnonResult] = useState(null);

  const handleJoinSuccess = useCallback((data) => {
    const payload = data.data;
    if (payload?.identityId && payload?.secret) {
      setAnonSession(payload.groupId, {
        identityId: payload.identityId,
        secret: payload.secret,
        alias: payload.alias,
        aliasTag: payload.aliasTag,
        avatarUrl: payload.avatarUrl,
      });
      setAnonResult({ groupId: payload.groupId, identity: payload });
      setStatus('backup');
      return;
    }
    setStatus('success');
    setTimeout(() => navigate(`/groups/${payload?.group?.id || payload?.groupId}`), 1400);
  }, [navigate]);

  useEffect(() => {
    const joinGroup = async () => {
      try {
        const { data } = await groupApi.joinGroup(token);
        handleJoinSuccess(data);
      } catch (err) {
        const apiErr = err.response?.data?.error;
        if (apiErr?.code === 'ALIAS_REQUIRED' || apiErr?.statusCode === 400) {
          setStatus('alias');
          return;
        }
        setStatus('error');
        setErrorMsg(apiErr?.message || 'Failed to join group. Link may be invalid or expired.');
      }
    };
    joinGroup();
  }, [token, handleJoinSuccess]);

  const handleAliasJoin = async () => {
    if (!alias.trim()) return;
    setStatus('joining');
    try {
      const { data } = await groupApi.joinGroup(token, alias.trim());
      handleJoinSuccess(data);
    } catch (err) {
      setStatus('alias');
      setErrorMsg(err.response?.data?.error?.message || 'Failed to join group with alias.');
    }
  };

  const handleKeyDone = () => {
    if (!anonResult) return;
    setAnonSession(anonResult.groupId, {
      identityId: anonResult.identity.identityId,
      secret: anonResult.identity.secret,
      alias: anonResult.identity.alias,
      aliasTag: anonResult.identity.aliasTag,
      avatarUrl: anonResult.identity.avatarUrl,
    });
    setStatus('success');
    setTimeout(() => navigate(`/groups/${anonResult.groupId}`), 1400);
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-4 bg-[var(--color-bg-primary)]">
      {/* Ambient background glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-[var(--palette-teal)]/15 blur-[120px] rounded-full" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[var(--palette-rose)]/12 blur-[100px] rounded-full" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        className="glass-card p-8 sm:p-10 max-w-md w-full text-center relative z-10 border border-[var(--color-border)] shadow-2xl"
      >
        {status === 'joining' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-3xl bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30 flex items-center justify-center mb-5 text-[var(--color-accent)]">
              <Loader2 size={30} className="animate-spin" />
            </div>
            <h2 className="text-xl font-bold font-display text-[var(--color-text-primary)]">Joining Community...</h2>
            <p className="text-xs text-[var(--color-text-secondary)] mt-2">Authenticating token credentials with group server</p>
          </div>
        )}

        {status === 'alias' && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-3xl bg-[var(--palette-rose)]/20 border border-[var(--palette-rose)]/30 flex items-center justify-center mb-5 text-[var(--palette-plum)]">
              <KeyRound size={30} />
            </div>
            <h2 className="text-xl font-bold font-display text-[var(--color-text-primary)]">Anonymous Channel</h2>
            <p className="text-xs text-[var(--color-text-secondary)] mt-2 leading-relaxed">
              This space requires zero-knowledge alias separation. Enter a handle for this channel.
            </p>
            <input
              type="text"
              className="matte-input w-full mt-5 text-center text-sm font-semibold"
              placeholder="e.g. StealthNomad"
              value={alias}
              maxLength={32}
              onChange={(e) => setAlias(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAliasJoin(); }}
              autoFocus
            />
            {errorMsg && (
              <p className="text-xs text-[var(--color-danger)] font-medium mt-3 bg-[var(--color-danger)]/10 p-2.5 rounded-2xl w-full border border-[var(--color-danger)]/25">
                {errorMsg}
              </p>
            )}
            <button onClick={handleAliasJoin} disabled={!alias.trim()} className="mt-5 btn btn-primary w-full py-3 shadow-md">
              <span>Join Anonymously</span>
              <ArrowRight size={16} />
            </button>
          </motion.div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-3xl bg-[var(--color-success)]/15 border border-[var(--color-success)]/30 flex items-center justify-center mb-5 text-[var(--color-success)]">
              <CheckCircle2 size={32} />
            </div>
            <h2 className="text-xl font-bold font-display text-[var(--color-text-primary)]">Successfully Joined!</h2>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1.5">Redirecting to channel feed...</p>
            <div className="mt-5 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] font-medium">
              <Users size={14} /> Welcome to the channel
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-3xl bg-[var(--color-danger)]/15 border border-[var(--color-danger)]/30 flex items-center justify-center mb-5 text-[var(--color-danger)]">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-bold font-display text-[var(--color-text-primary)]">Unable to Join</h2>
            <p className="text-xs text-[var(--color-danger)] font-medium mt-3 bg-[var(--color-danger)]/10 p-3 rounded-2xl w-full border border-[var(--color-danger)]/25">
              {errorMsg}
            </p>
            <button onClick={() => navigate('/groups')} className="mt-6 btn btn-primary w-full py-3 shadow-md">
              <span>Return to Groups</span>
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </motion.div>

      {status === 'backup' && anonResult && (
        <BackupKeyModal
          groupName="this channel"
          identity={anonResult.identity}
          onDone={handleKeyDone}
        />
      )}
    </div>
  );
}
