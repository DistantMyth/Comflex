/**
 * GoogleAuthButton.jsx — 21st.dev inspired Premium "Continue with Google" Button
 *
 * Features:
 * - Official multi-color Google "G" SVG icon with high-fidelity path rendering.
 * - Matte frosted glass container with inner specular reflection border.
 * - Smooth Framer Motion spring physics on hover and active tap.
 * - Integrated animated loading spinner state (dual-tone Comflex accent).
 */

import { motion } from 'framer-motion';

export function GoogleIcon({ className = 'w-5 h-5', ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.25 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.26C.46 8.16 0 9.94 0 12s.46 3.84 1.26 5.42l4.02-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.25 2.64 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

function GoogleButtonSpinner() {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
      className="w-5 h-5 rounded-full border-2 border-[var(--palette-teal)]/30 border-t-[var(--palette-teal)] border-r-[var(--palette-rose)] flex-shrink-0"
    />
  );
}

export default function GoogleAuthButton({
  onClick,
  isLoading = false,
  disabled = false,
  text = 'Continue with Google',
  loadingText = 'Connecting to Google...',
  fullWidth = true,
  className = '',
  ...props
}) {
  const isDisabled = disabled || isLoading;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      whileHover={isDisabled ? {} : { scale: 1.012, y: -1 }}
      whileTap={isDisabled ? {} : { scale: 0.985, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
      className={`relative inline-flex items-center justify-center gap-3 px-5 py-3 rounded-2xl font-semibold text-sm select-none transition-all duration-200 cursor-pointer overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg-card)]/80 text-[var(--color-text-primary)] hover:border-[var(--color-border-hover)] backdrop-blur-xl shadow-[var(--inner-specular),0_4px_16px_-4px_rgba(105,79,93,0.08)] hover:shadow-[var(--inner-specular),0_8px_24px_-6px_rgba(105,79,93,0.14)] ${fullWidth ? 'w-full' : ''} ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''} ${className}`}
      {...props}
    >
      <div
        aria-hidden="true"
        className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/40 dark:via-white/15 to-transparent pointer-events-none"
      />

      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none bg-radial from-[var(--palette-teal)]/10 via-transparent to-transparent"
      />

      {isLoading ? <GoogleButtonSpinner /> : <GoogleIcon className="w-5 h-5 flex-shrink-0" />}

      <span className="tracking-tight text-sm font-medium">
        {isLoading ? loadingText : text}
      </span>
    </motion.button>
  );
}
