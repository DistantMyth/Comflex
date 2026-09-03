import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, Braces, ArrowRight, CheckCircle2, FlaskConical, Loader2, ShieldAlert, PartyPopper, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { adminApi } from '../api/adminApi';
import AuthShell from '../components/AuthShell';

export default function SetupPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [institution, setInstitution] = useState({ name: '', domain: '' });
  const [parsing, setParsing] = useState({ pattern: '(\\d{2})bcs\\d+', captureGroup: 1, yearOffset: 0 });
  const [testEmail, setTestEmail] = useState('');
  const [previewResult, setPreviewResult] = useState(null);

  const handleSetupInstitution = async () => {
    setError('');
    setLoading(true);
    try {
      const sanitizedDomain = institution.domain.trim().toLowerCase().replace(/^@/, '');
      await adminApi.setupInstitution({ ...institution, domain: sanitizedDomain });
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save institution settings.');
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    setError('');
    setPreviewResult(null);
    try {
      const res = await adminApi.previewCohortConfig({
        email: testEmail,
        pattern: parsing.pattern,
        captureGroup: parsing.captureGroup,
        yearOffset: parsing.yearOffset,
      });
      setPreviewResult(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Pattern test failed.');
    }
  };

  const handleSaveParsing = async () => {
    setError('');
    setLoading(true);
    try {
      await adminApi.updateCohortConfig({
        emailParsingRules: {
          pattern: parsing.pattern,
          captureGroup: parsing.captureGroup,
          yearOffset: parsing.yearOffset,
        },
        cohortConfig: { seniorOffset: -1, juniorOffset: 1, seniorAutoElevate: true },
      });
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save parsing rules.');
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <AuthShell title="Privileged Access">
        <div className="text-center py-6 space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-danger)]/15 border border-[var(--color-danger)]/30 flex items-center justify-center text-[var(--color-danger)]">
            <ShieldAlert size={32} />
          </div>
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">Admin Access Required</h3>
          <p className="text-xs text-[var(--color-text-secondary)]">Only the Seed Admin can configure initial campus settings.</p>
        </div>
      </AuthShell>
    );
  }

  const stepMeta = [
    { icon: Building2, label: 'Institution' },
    { icon: Braces, label: 'Cohort Rules' },
    { icon: PartyPopper, label: 'Ready' },
  ];

  return (
    <AuthShell
      title="Comflex Setup"
      subtitle={`Step ${step} of 3 — ${step === 1 ? 'Institution Profile' : step === 2 ? 'Cohort Regex Detection' : 'Ready to Launch'}`}
    >
      {/* Stepper */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {stepMeta.map((s, i) => {
          const idx = i + 1;
          const done = idx < step;
          const active = idx === step;
          return (
            <div key={s.label} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  done
                    ? 'bg-[var(--color-success)]/15 text-[var(--color-success)] border border-[var(--color-success)]/30'
                    : active
                    ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30 font-bold'
                    : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
                }`}
              >
                {done ? <CheckCircle2 size={13} /> : <s.icon size={13} />}
                <span>{s.label}</span>
              </div>
              {idx < 3 && <div className={`w-6 h-0.5 rounded ${idx < step ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`} />}
            </div>
          );
        })}
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 p-3.5 rounded-2xl bg-[var(--color-danger)]/12 border border-[var(--color-danger)]/25 text-[var(--color-danger)] text-xs font-semibold flex items-center gap-2"
        >
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      {step === 1 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <p className="text-[var(--color-text-secondary)] text-xs leading-relaxed">
            Specify your university name and official email domain. These can be adjusted anytime from the Admin Dashboard.
          </p>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
              Institution Name
            </label>
            <input
              type="text"
              value={institution.name}
              onChange={(e) => setInstitution({ ...institution, name: e.target.value })}
              placeholder="e.g. State University"
              className="matte-input"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
              Allowed Domain
            </label>
            <input
              type="text"
              value={institution.domain}
              onChange={(e) => setInstitution({ ...institution, domain: e.target.value })}
              placeholder="e.g. campus.edu"
              className="matte-input"
              required
            />
          </div>
          <button
            onClick={handleSetupInstitution}
            disabled={loading || !institution.name || !institution.domain}
            className="btn btn-primary w-full py-3 mt-2 shadow-md"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            <span>Next: Configure Cohort Rules</span>
          </button>
        </motion.div>
      )}

      {step === 2 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <p className="text-[var(--color-text-secondary)] text-xs leading-relaxed">
            Configure regex pattern to extract academic cohort batch year from incoming student emails.
          </p>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
              Regex Pattern
            </label>
            <input
              type="text"
              value={parsing.pattern}
              onChange={(e) => setParsing({ ...parsing, pattern: e.target.value })}
              placeholder="(\d{2})bcs\d+"
              className="matte-input font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                Capture Group
              </label>
              <input
                type="number"
                value={parsing.captureGroup}
                min={0}
                onChange={(e) => setParsing({ ...parsing, captureGroup: parseInt(e.target.value) || 0 })}
                className="matte-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">
                Year Offset
              </label>
              <input
                type="number"
                value={parsing.yearOffset}
                onChange={(e) => setParsing({ ...parsing, yearOffset: parseInt(e.target.value) || 0 })}
                className="matte-input"
              />
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-4 mt-2">
            <h4 className="text-xs font-bold text-[var(--color-text-primary)] mb-2 flex items-center gap-1.5">
              <FlaskConical size={14} className="text-[var(--color-accent)]" /> Live Pattern Simulator
            </h4>
            <div className="flex gap-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="e.g. student2026@campus.edu"
                className="matte-input flex-1 text-xs"
              />
              <button onClick={handlePreview} disabled={!testEmail} className="btn btn-secondary text-xs px-4">
                Test
              </button>
            </div>

            {previewResult && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-3 p-3 rounded-2xl text-xs font-medium ${
                  previewResult.matched
                    ? 'bg-[var(--color-success)]/15 border border-[var(--color-success)]/30 text-[var(--color-success)]'
                    : 'bg-[var(--color-warning)]/15 border border-[var(--color-warning)]/30 text-[var(--color-warning)]'
                }`}
              >
                {previewResult.matched ? (
                  <>
                    <p className="font-bold">Match verified! Extracted year: {previewResult.extractedYear}</p>
                    <p className="mt-1 opacity-90">Auto tags: {previewResult.predictedTags?.join(', ') || 'None'}</p>
                  </>
                ) : (
                  <p>No match. Ensure regex pattern and capture group correspond to sample input.</p>
                )}
              </motion.div>
            )}
          </div>

          <button onClick={handleSaveParsing} disabled={loading} className="btn btn-primary w-full py-3 mt-2 shadow-md">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            <span>Save & Finalize</span>
          </button>
        </motion.div>
      )}

      {step === 3 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-4 py-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-success)]/15 border border-[var(--color-success)]/30 flex items-center justify-center text-[var(--color-success)]">
            <PartyPopper size={32} />
          </div>
          <h3 className="text-xl font-bold font-display text-[var(--color-text-primary)]">Setup Complete!</h3>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed max-w-sm mx-auto">
            Your university platform is configured. Students can now sign up using their institutional emails and join their automated cohort channels.
          </p>
          <button onClick={() => navigate('/admin')} className="btn btn-primary w-full py-3 shadow-md flex items-center justify-center gap-2">
            <span>Enter Admin Dashboard</span>
            <ArrowRight size={16} />
          </button>
        </motion.div>
      )}
    </AuthShell>
  );
}
