/**
 * AuthShell — Shared layout for all public auth pages.
 * Left: animated brand panel (hidden on mobile).
 * Right: glass form card with entrance animation.
 */

import { motion } from 'framer-motion';
import { Zap, MessagesSquare, CalendarDays, Award, ShieldCheck } from 'lucide-react';

const FEATURES = [
  { icon: MessagesSquare, text: 'Real-time cohort groups & chat' },
  { icon: CalendarDays, text: 'Events, teams & live leaderboards' },
  { icon: Award, text: 'Badges, credits & achievements' },
  { icon: ShieldCheck, text: 'Institutional email verification' },
];

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-svh flex relative overflow-hidden">
      {/* Decorative orbs */}
      <div className="bg-orb w-[500px] h-[500px] -top-32 -left-32 bg-[var(--color-accent)]/25 animate-float-slow" />
      <div className="bg-orb w-[420px] h-[420px] bottom-[-10%] right-[-5%] bg-[#2563eb]/20 animate-float" />
      <div className="bg-orb w-[260px] h-[260px] top-1/3 right-1/4 bg-[var(--color-secondary)]/15 animate-float-slow" />

      {/* Brand panel */}
      <div className="hidden lg:flex w-[44%] flex-col justify-between p-12 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center gap-3"
        >
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[var(--color-accent-light)] via-[var(--color-accent)] to-[#2563eb] flex items-center justify-center text-white shadow-[0_8px_28px_-6px_rgba(124,58,237,0.6)]">
            <Zap size={22} strokeWidth={2.5} className="animate-pulse-glow" />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-display gradient-text leading-none">Comflex</h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">College Community Platform</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
        >
          <h2 className="text-4xl font-bold font-display leading-tight mb-4">
            Your campus,
            <br />
            <span className="gradient-text">one community.</span>
          </h2>
          <p className="text-[var(--color-text-secondary)] max-w-md leading-relaxed">
            Connect with your cohort, share resources, compete in events, and earn badges —
            all in one beautifully simple place.
          </p>

          <div className="mt-8 space-y-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.text}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.3 + i * 0.1 }}
                className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]"
              >
                <span className="w-8 h-8 rounded-lg bg-[var(--color-bg-card)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-accent)]">
                  <f.icon size={16} />
                </span>
                {f.text}
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="text-xs text-[var(--color-text-muted)]"
        >
          © {new Date().getFullYear()} Comflex · Built for students
        </motion.p>
      </div>

      {/* Form side */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 relative z-10">
        <div className="w-full max-w-md my-auto py-2">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-accent-light)] via-[var(--color-accent)] to-[#2563eb] flex items-center justify-center text-white">
              <Zap size={20} strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-bold font-display gradient-text">Comflex</h1>
          </div>

          <div className="glass-card p-7 sm:p-9">
            <h2 className="text-2xl font-bold font-display mb-1.5">{title}</h2>
            {subtitle && <p className="text-sm text-[var(--color-text-secondary)] mb-6">{subtitle}</p>}
            {children}
            {footer && <div className="mt-6 text-center text-sm text-[var(--color-text-muted)]">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
