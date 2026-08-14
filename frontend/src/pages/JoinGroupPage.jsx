import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle2, AlertTriangle, ArrowRight, Users, KeyRound } from 'lucide-react';
import client from '../api/client';
import { setAnonSession } from '../api/client';
import BackupKeyModal from '../components/BackupKeyModal';

export default function JoinGroupPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('joining');
  const [errorMsg, setErrorMsg] = useState('');
  const [alias, setAlias] = useState('');
  const [anonResult, setAnonResult] = useState(null); // { group, identity } waiting on key ack

  useEffect(() => {
    const joinGroup = async () => {
      try {
        const { data } = await client.post(`/groups/join/${token}`, { alias: undefined, avatarUrl: undefined });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleJoinSuccess = (data) => {
    const payload = data.data;
    if (payload?.identityId && payload?.secret) {
      // Anonymous group: hold until the user backs up their key.
      setAnonResult({ groupId: payload.groupId, identity: payload });
      setStatus('backup');
      return;
    }
    setStatus('success');
    setTimeout(() => navigate(`/groups/${payload.group.id}`), 1600);
  };

  const handleAliasJoin = async () => {
    if (!alias.trim()) return;
    setStatus('joining');
    try {
      const { data } = await client.post(`/groups/join/${token}`, { alias: alias.trim(), avatarUrl: undefined });
      handleJoinSuccess(data);
    } catch (err) {
      setStatus('alias');
      setErrorMsg(err.response?.data?.error?.message || 'Failed to join group.');
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
    setTimeout(() => navigate(`/groups/${anonResult.groupId}`), 1600);
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden px-4">
      <div className="bg-orb w-[420px] h-[420px] -top-24 -right-24 bg-[var(--color-accent)]/20 animate-float-slow" />
      <div className="bg-orb w-[360px] h-[360px] bottom-[-10%] left-[-8%] bg-[#2563eb]/15 animate-float" />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="glass-card p-9 max-w-md w-full text-center relative z-10"
      >
        {status === 'joining' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 flex items-center justify-center mb-5">
              <Loader2 size={30} className="text-[var(--color-accent)] animate-spin" />
            </div>
            <h2 className="text-xl font-bold font-display gradient-text">Joining group...</h2>
            <p className="text-[var(--color-text-secondary)] mt-2 text-sm">Please wait while we process your invite.</p>
          </motion.div>
        )}

        {status === 'alias' && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/25 flex items-center justify-center mb-5">
              <KeyRound size={30} className="text-[var(--color-accent)]" />
            </div>
            <h2 className="text-xl font-bold font-display">This is an anonymous group</h2>
            <p className="text-[var(--color-text-secondary)] mt-2 text-sm">
              Choose an alias. You'll get a one-time recovery key that no one else — not even the server — can see.
            </p>
            <input
              type="text"
              className="input w-full mt-5 text-center"
              placeholder="Choose your alias"
              value={alias}
              maxLength={32}
              onChange={e => setAlias(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAliasJoin(); }}
            />
            {errorMsg && (
              <p className="text-xs text-[var(--color-danger)] mt-3 bg-[var(--color-danger)]/10 p-2 rounded-lg w-full">{errorMsg}</p>
            )}
            <button onClick={handleAliasJoin} className="mt-5 px-6 py-2.5 btn btn-primary w-full">
              Join anonymously <ArrowRight size={16} />
            </button>
          </motion.div>
        )}

        {status === 'success' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/25 flex items-center justify-center mb-5">
              <CheckCircle2 size={30} className="text-[var(--color-success)]" />
            </div>
            <h2 className="text-2xl font-bold font-display">Successfully joined!</h2>
            <p className="text-[var(--color-text-secondary)] mt-2 text-sm">Redirecting to the group chat...</p>
            <div className="mt-5 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Users size={14} /> Welcome to your new community
            </div>
          </motion.div>
        )}

        {status === 'error' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 flex items-center justify-center mb-5">
              <AlertTriangle size={30} className="text-[var(--color-danger)]" />
            </div>
            <h2 className="text-xl font-bold font-display">Oops, something went wrong</h2>
            <p className="text-[var(--color-danger)] mt-3 text-sm font-medium bg-[var(--color-danger)]/10 p-2.5 rounded-xl w-full border border-[var(--color-danger)]/20">{errorMsg}</p>
            <button
              onClick={() => navigate('/groups')}
              className="mt-6 px-6 py-2.5 btn btn-primary w-full"
            >
              Go to My Groups <ArrowRight size={16} />
            </button>
          </motion.div>
        )}
      </motion.div>

      {status === 'backup' && anonResult && (
        <BackupKeyModal
          groupName="this group"
          identity={anonResult.identity}
          onDone={handleKeyDone}
        />
      )}
    </div>
  );
}