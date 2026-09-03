import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { MessagesSquare, CalendarDays, Award, ShieldCheck } from 'lucide-react';
import ComflexLogo from './ComflexLogo';
import ThemeToggle from './ThemeToggle';

const FEATURES = [
  { icon: MessagesSquare, text: 'Real-time cohort groups & anonymous channels' },
  { icon: CalendarDays, text: 'College events, team tasks & leaderboards' },
  { icon: Award, text: 'Peer medals, credits & achievements' },
  { icon: ShieldCheck, text: 'Institutional identity & verified roles' },
];

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-svh flex relative overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Ambient Theme Toggle at Top Right */}
      <div className="absolute top-5 right-5 z-30">
        <ThemeToggle size="sm" variant="icon" />
      </div>

      {/* Decorative matte glow orbs with our palette */}
      <div className="absolute w-[520px] h-[520px] -top-32 -left-32 rounded-full bg-[var(--palette-teal)]/12 blur-3xl pointer-events-none" />
      <div className="absolute w-[440px] h-[440px] -bottom-24 -right-24 rounded-full bg-[var(--palette-rose)]/15 blur-3xl pointer-events-none" />
      <div className="absolute w-[360px] h-[360px] top-1/3 right-1/4 rounded-full bg-[var(--palette-plum)]/10 blur-3xl pointer-events-none" />

      {/* Brand panel (desktop) */}
      <div className="hidden lg:flex w-[46%] flex-col justify-between p-12 relative z-10 border-r border-[var(--color-border)]">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Link to="/" className="inline-flex items-center gap-3 group">
            <ComflexLogo variant="fullWithWordmark" size="md" animated={true} />
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
        >
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] border border-[var(--palette-teal)]/30 mb-4">
            Campus Collaboration Platform
          </span>
          <h2 className="text-4xl font-bold font-display leading-tight mb-4 text-[var(--color-text-primary)]">
            Your college campus,
            <br />
            <span className="text-gradient">one connected space.</span>
          </h2>
          <p className="text-[var(--color-text-secondary)] max-w-md leading-relaxed text-sm">
            Collaborate in cohort channels, share academic resources, compete in campus hackathons, and flex verified achievement medals.
          </p>

          <div className="mt-8 space-y-3.5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.text}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
                className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]"
              >
                <span className="w-8 h-8 rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)] shadow-sm">
                  <f.icon size={16} />
                </span>
                <span>{f.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-xs text-[var(--color-text-muted)]"
        >
          © {new Date().getFullYear()} Comflex Platform · Built with care
        </motion.p>
      </div>

      {/* Form Card side */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 relative z-10">
        <div className="w-full max-w-md my-auto py-2">
          {/* Mobile brand header */}
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-6">
            <Link to="/" className="flex items-center gap-2.5">
              <ComflexLogo variant="fullWithWordmark" size="sm" showSubtitle={false} />
            </Link>
          </div>

          <div className="glass-card p-7 sm:p-9 shadow-xl border border-[var(--color-border)]">
            <h2 className="text-2xl font-bold font-display mb-1.5 text-[var(--color-text-primary)]">{title}</h2>
            {subtitle && <p className="text-sm text-[var(--color-text-secondary)] mb-6 leading-relaxed">{subtitle}</p>}
            {children}
            {footer && <div className="mt-6 text-center text-sm text-[var(--color-text-muted)]">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
