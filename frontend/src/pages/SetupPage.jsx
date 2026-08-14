/**
 * SetupPage — First-boot wizard for the Seed Admin.
 * Guides: Institution details → Email parsing rules → Done.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, Braces, ArrowRight, CheckCircle2, FlaskConical, Loader2, ShieldAlert, PartyPopper } from 'lucide-react';
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
      await adminApi.setupInstitution(institution);
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
      setError(err.response?.data?.error?.message || 'Preview failed.');
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
      <AuthShell title="Admin access required">
        <div className="text-center py-4 space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 flex items-center justify-center">
            <ShieldAlert size={30} className="text-[var(--color-danger)]" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">Only the Seed Admin can configure the platform.</p>
        </div>
      </AuthShell>
    );
  }

  const stepMeta = [
    { icon: Building2, label: 'Institution' },
    { icon: Braces, label: 'Email Rules' },
    { icon: PartyPopper, label: 'Done' },
  ];

  return (
    <AuthShell
      title="Comflex Setup"
      subtitle={`Step ${step} of 3 — ${step === 1 ? 'Institution Details' : step === 2 ? 'Email Parsing Rules' : 'Complete!'}`}
    >
      {/* Stepper */}
      <div className="flex items-center justify-center gap-2 mb-7">
        {stepMeta.map((s, i) => {
          const idx = i + 1;
          const done = idx < step;
          const active = idx === step;
          return (
            <div key={s.label} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  done
                    ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/25'
                    : active
                    ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                    : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]'
                }`}
              >
                {done ? <CheckCircle2 size={13} /> : <s.icon size={13} />}
                {s.label}
              </div>
              {idx < 3 && <div className={`w-8 h-0.5 rounded ${idx < step ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`} />}
            </div>
          );
        })}
      </div>

      {error && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="alert alert-danger mb-4">
          {error}
        </motion.div>
      )}

      {step === 1 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <p className="text-[var(--color-text-secondary)] text-sm">
            Set your institution name and email domain. This can be changed later from the Admin Dashboard.
          </p>
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1.5">Institution Name</label>
            <input type="text" value={institution.name} onChange={(e) => setInstitution({ ...institution, name: e.target.value })} placeholder="Acme University" required />
          </div>
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1.5">Email Domain</label>
            <input type="text" value={institution.domain} onChange={(e) => setInstitution({ ...institution, domain: e.target.value })} placeholder="acme.edu" required />
          </div>
          <button onClick={handleSetupInstitution} disabled={loading || !institution.name || !institution.domain} className="btn btn-primary w-full">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            Next
          </button>
        </motion.div>
      )}

      {step === 2 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <p className="text-[var(--color-text-secondary)] text-sm">
            Configure the regex that extracts the graduation year from student emails.
          </p>
          <div>
            <label className="block text-sm text-[var(--color-text-secondary)] mb-1.5">Regex Pattern</label>
            <input type="text" value={parsing.pattern} onChange={(e) => setParsing({ ...parsing, pattern: e.target.value })} placeholder="(\d{2})bcs\d+" className="font-mono text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--color-text-secondary)] mb-1.5">Capture Group</label>
              <input type="number" value={parsing.captureGroup} min={0} onChange={(e) => setParsing({ ...parsing, captureGroup: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-sm text-[var(--color-text-secondary)] mb-1.5">Year Offset</label>
              <input type="number" value={parsing.yearOffset} onChange={(e) => setParsing({ ...parsing, yearOffset: parseInt(e.target.value) || 0 })} />
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] pt-4">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <FlaskConical size={14} className="text-[var(--color-accent)]" /> Test Your Pattern
            </h4>
            <div className="flex gap-2">
              <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="28bcs045@acme.edu" className="flex-1" />
              <button onClick={handlePreview} disabled={!testEmail} className="btn btn-secondary text-sm">
                Test
              </button>
            </div>

            {previewResult && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-3 p-3 rounded-xl text-sm ${previewResult.matched ? 'alert-success' : 'alert-warning'}`}
              >
                {previewResult.matched ? (
                  <>
                    <p className="font-semibold">Match! Extracted year: {previewResult.extractedYear}</p>
                    <p className="mt-1">Tags: {previewResult.predictedTags.join(', ')}</p>
                  </>
                ) : (
                  <p>No match — email didn&apos;t match the pattern.</p>
                )}
              </motion.div>
            )}
          </div>

          <button onClick={handleSaveParsing} disabled={loading} className="btn btn-primary w-full">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            Save & Finish
          </button>
        </motion.div>
      )}

      {step === 3 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-4 py-2">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/25 flex items-center justify-center">
            <PartyPopper size={30} className="text-[var(--color-success)]" />
          </div>
          <h3 className="text-lg font-bold font-display">Setup Complete!</h3>
          <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed">
            The platform is now configured. Students can register using their institutional email.
          </p>
          <button onClick={() => navigate('/admin')} className="btn btn-primary w-full">
            Go to Admin Dashboard <ArrowRight size={16} />
          </button>
        </motion.div>
      )}
    </AuthShell>
  );
}
