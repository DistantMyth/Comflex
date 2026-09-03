/**
 * ThemeToggle.jsx — 21st.dev inspired Morphing Sun/Moon Theme Toggle
 *
 * Features:
 * - Animated SVG icon morphing sun rays into a crescent moon with spring physics.
 * - Smooth 90deg rotation, ray scaling (1 -> 0), and center disc expansion.
 * - Dynamic light/dark ambient radial glow matching Comflex palette:
 *   Tea Rose (#efc7c2), Sage Teal (#68a691), and English Violet (#694f5d).
 * - Multi-variant support: icon-only button, or pill with "Light" / "Dark" label.
 */

import { useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';

export default function ThemeToggle({
  theme: controlledTheme,
  onToggle: controlledOnToggle,
  size = 'md',
  variant = 'icon',
  showLabel = false,
  className = '',
  ...props
}) {
  const context = useTheme();
  const currentTheme = controlledTheme ?? context?.theme ?? 'dark';
  const toggleTheme = controlledOnToggle ?? context?.toggleTheme ?? (() => {});

  const isDark = currentTheme === 'dark';
  const maskId = useId();

  const sizeMap = {
    sm: {
      btn: showLabel ? 'h-8 px-2.5 text-xs gap-1.5' : 'w-8 h-8',
      svg: 16,
      halo: 'w-7 h-7',
    },
    md: {
      btn: showLabel ? 'h-9 px-3.5 text-xs gap-2' : 'w-10 h-10',
      svg: 20,
      halo: 'w-9 h-9',
    },
    lg: {
      btn: showLabel ? 'h-11 px-4 text-sm gap-2.5' : 'w-12 h-12',
      svg: 24,
      halo: 'w-11 h-11',
    },
  }[size] || {
    btn: showLabel ? 'h-9 px-3.5 text-xs gap-2' : 'w-10 h-10',
    svg: 20,
    halo: 'w-9 h-9',
  };

  const springPhysics = {
    type: 'spring',
    stiffness: 350,
    damping: 24,
  };

  const variantStyles = {
    icon: 'rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-sm hover:border-[var(--color-border-hover)]',
    pill: 'rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-sm hover:border-[var(--color-border-hover)]',
    ghost: 'rounded-full hover:bg-[var(--color-bg-secondary)] border border-transparent',
  }[variant] || '';

  return (
    <motion.button
      type="button"
      onClick={toggleTheme}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.92 }}
      transition={springPhysics}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`relative inline-flex items-center justify-center select-none overflow-hidden cursor-pointer transition-colors backdrop-blur-md ${sizeMap.btn} ${variantStyles} ${className}`}
      {...props}
    >
      {/* Dynamic Background Halo Glow matching Comflex palette */}
      <motion.div
        aria-hidden="true"
        className={`absolute rounded-full pointer-events-none ${sizeMap.halo}`}
        initial={false}
        animate={{
          background: isDark
            ? 'radial-gradient(circle, rgba(104, 166, 145, 0.45) 0%, rgba(105, 79, 93, 0.25) 55%, transparent 75%)'
            : 'radial-gradient(circle, rgba(239, 199, 194, 0.6) 0%, rgba(255, 229, 212, 0.35) 55%, transparent 75%)',
          scale: [0.9, 1.25, 1],
          opacity: [0.6, 1, 0.85],
        }}
        key={currentTheme}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />

      {/* Morphing Sun/Moon SVG */}
      <motion.svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={sizeMap.svg}
        height={sizeMap.svg}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{
          rotate: isDark ? 90 : 0,
          color: isDark ? '#78b8a3' : '#c97f32',
        }}
        transition={springPhysics}
        className="relative z-10 flex-shrink-0"
      >
        <mask id={maskId}>
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <motion.circle
            initial={false}
            animate={{
              cx: isDark ? 17 : 24,
              cy: isDark ? 7 : 0,
              r: isDark ? 7.5 : 0,
            }}
            transition={springPhysics}
            fill="black"
          />
        </mask>

        {/* Central Sun Disc / Moon Body */}
        <motion.circle
          cx="12"
          cy="12"
          initial={false}
          animate={{
            r: isDark ? 8.5 : 5,
          }}
          transition={springPhysics}
          fill="currentColor"
          mask={`url(#${maskId})`}
        />

        {/* 8 Sun Rays */}
        <motion.g
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          initial={false}
          animate={{
            scale: isDark ? 0 : 1,
            opacity: isDark ? 0 : 1,
            rotate: isDark ? 90 : 0,
          }}
          transition={springPhysics}
          style={{ transformOrigin: '12px 12px' }}
        >
          <line x1="12" y1="2" x2="12" y2="4.5" />
          <line x1="12" y1="19.5" x2="12" y2="22" />
          <line x1="2" y1="12" x2="4.5" y2="12" />
          <line x1="19.5" y1="12" x2="22" y2="12" />
          <line x1="4.93" y1="4.93" x2="6.7" y2="6.7" />
          <line x1="17.3" y1="17.3" x2="19.07" y2="19.07" />
          <line x1="4.93" y1="19.07" x2="6.7" y2="17.3" />
          <line x1="17.3" y1="6.7" x2="19.07" y2="4.93" />
        </motion.g>
      </motion.svg>

      {/* Optional Animated Text Label */}
      {showLabel && (
        <span className="relative z-10 font-semibold text-[var(--color-text-primary)]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={currentTheme}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.15 }}
            >
              {isDark ? 'Light' : 'Dark'}
            </motion.span>
          </AnimatePresence>
        </span>
      )}
    </motion.button>
  );
}
