/**
 * ComflexLogo.jsx — Official Brand Mark & Wordmark Component
 * Enhanced with crisp contrast borders for Light & Dark modes.
 */

import { useId } from 'react';
import { motion } from 'framer-motion';

export default function ComflexLogo({
  variant = 'fullWithWordmark',
  size = 'md',
  animated = false,
  className = '',
  showSubtitle = true,
  onClick,
}) {
  const uniqueId = useId().replace(/:/g, '_');

  const sizeMap = {
    sm: { icon: 26, text: 'text-sm', sub: 'text-[8px]', gap: 'gap-2' },
    md: { icon: 36, text: 'text-lg', sub: 'text-[9.5px]', gap: 'gap-2.5' },
    lg: { icon: 48, text: 'text-2xl', sub: 'text-[11px]', gap: 'gap-3' },
    xl: { icon: 72, text: 'text-4xl', sub: 'text-xs', gap: 'gap-4' },
  };

  const currentSize = sizeMap[size] || sizeMap.md;
  const iconPixel = typeof size === 'number' ? size : currentSize.icon;

  const IconGraphic = (
    <svg
      viewBox="0 0 200 200"
      width={iconPixel}
      height={iconPixel}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <filter id={`matte_sh_${uniqueId}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="5" stdDeviation="8" floodColor="#422d39" floodOpacity="0.22" />
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#68a691" floodOpacity="0.16" />
        </filter>

        <filter id={`core_glow_${uniqueId}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <radialGradient id={`aura_${uniqueId}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#68a691" stopOpacity="0.35" />
          <stop offset="50%" stopColor="#efc7c2" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#68a691" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={`arch_grad_${uniqueId}`} x1="15%" y1="10%" x2="85%" y2="90%">
          <stop offset="0%" stopColor="#68a691" />
          <stop offset="50%" stopColor="#bfd3c1" />
          <stop offset="100%" stopColor="#568d7b" />
        </linearGradient>

        <linearGradient id={`ascend_grad_${uniqueId}`} x1="100%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#694f5d" />
          <stop offset="45%" stopColor="#efc7c2" />
          <stop offset="100%" stopColor="#68a691" />
        </linearGradient>

        <linearGradient id={`descend_grad_${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#efc7c2" />
          <stop offset="48%" stopColor="#ffe5d4" />
          <stop offset="100%" stopColor="#694f5d" />
        </linearGradient>

        <radialGradient id={`core_grad_${uniqueId}`} cx="38%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="30%" stopColor="#ffe5d4" />
          <stop offset="70%" stopColor="#68a691" />
          <stop offset="100%" stopColor="#694f5d" />
        </radialGradient>

        <linearGradient id={`specular_grad_${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="35%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="70%" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Ambient Aura Background */}
      <circle cx="102" cy="100" r="74" fill={`url(#aura_${uniqueId})`} opacity="0.8" />

      {/* 1. Primary Arch ('C' Backbone) — With Subtle Contrast Border */}
      <path
        d="M 148 52 C 102 24, 38 52, 38 100 C 38 148, 102 176, 148 148"
        stroke="rgba(66, 45, 57, 0.28)"
        strokeWidth="17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 148 52 C 102 24, 38 52, 38 100 C 38 148, 102 176, 148 148"
        stroke={`url(#arch_grad_${uniqueId})`}
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#matte_sh_${uniqueId})`}
      />

      {/* 2. Ascending Infinity Strand — With Contrast Border */}
      <path
        d="M 146 148 C 112 146, 88 122, 102 100 C 116 78, 148 66, 162 84 C 174 98, 160 118, 138 114"
        stroke="rgba(66, 45, 57, 0.28)"
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 146 148 C 112 146, 88 122, 102 100 C 116 78, 148 66, 162 84 C 174 98, 160 118, 138 114"
        stroke={`url(#ascend_grad_${uniqueId})`}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 3. Descending Infinity Strand — With Contrast Border */}
      <path
        d="M 146 52 C 112 54, 88 78, 102 100 C 116 122, 148 134, 162 116 C 174 102, 160 82, 138 86"
        stroke="rgba(66, 45, 57, 0.28)"
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 146 52 C 112 54, 88 78, 102 100 C 116 122, 148 134, 162 116 C 174 102, 160 82, 138 86"
        stroke={`url(#descend_grad_${uniqueId})`}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 4. Core Reputation Node */}
      <g filter={`url(#core_glow_${uniqueId})`}>
        <circle
          cx="102"
          cy="100"
          r="10.5"
          fill={`url(#core_grad_${uniqueId})`}
          stroke="rgba(66, 45, 57, 0.4)"
          strokeWidth="2.8"
        />
        <circle
          cx="102"
          cy="100"
          r="9"
          stroke="rgba(255, 255, 255, 0.9)"
          strokeWidth="1.5"
          fill="none"
        />
        <circle cx="99" cy="97" r="3.2" fill="#ffffff" opacity="0.95" />
      </g>

      {/* 5. Specular Glass Arc */}
      <path
        d="M 134 44 C 98 28, 48 50, 44 86"
        stroke={`url(#specular_grad_${uniqueId})`}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );

  return (
    <div
      onClick={onClick}
      className={`inline-flex items-center ${currentSize.gap} select-none ${className}`}
      role="img"
      aria-label="Comflex — Community + Flexibility"
    >
      {variant !== 'wordmarkOnly' && (
        animated ? (
          <motion.div
            whileHover={{ scale: 1.06, rotate: 2 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            className="relative flex items-center justify-center"
          >
            {IconGraphic}
          </motion.div>
        ) : (
          <div className="relative flex items-center justify-center">
            {IconGraphic}
          </div>
        )
      )}

      {variant !== 'iconOnly' && (
        <div className="flex flex-col justify-center leading-none">
          <div
            className={`font-display font-extrabold tracking-tight ${currentSize.text} flex items-baseline`}
          >
            <span className="text-[var(--palette-plum)] dark:text-[var(--color-text-primary)] transition-colors drop-shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
              COM
            </span>
            <span className="bg-gradient-to-r from-[var(--palette-teal)] via-[#568d7b] to-[var(--palette-rose)] bg-clip-text text-transparent drop-shadow-[0_1px_2px_rgba(104,166,145,0.25)]">
              FLEX
            </span>
          </div>

          {showSubtitle && (
            <span
              className={`font-sans font-bold uppercase tracking-[0.28em] text-[var(--color-text-muted)] mt-0.5 ${currentSize.sub}`}
            >
              Campus Ecosystem
            </span>
          )}
        </div>
      )}
    </div>
  );
}
