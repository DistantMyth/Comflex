/**
 * LiquidGlassBackground.jsx — Atmospheric Fluid Liquid Glass Ambient Background
 * Inspired by 21st.dev @designali-in/liquid-glass-button
 *
 * Implements fluid liquid gradients using Comflex custom palette:
 * #68a691 (Zomp/Teal), #efc7c2 (Tea Rose), #bfd3c1 (Sage), #694f5d (Plum), #ffe5d4 (Bisque)
 * Overlaid with liquid refraction and subtle satin matte texture.
 */

import { motion } from 'framer-motion';
import LiquidGlassFilter from './LiquidGlassFilter';

export default function LiquidGlassBackground({ className = '' }) {
  return (
    <div
      className={`pointer-events-none fixed inset-0 overflow-hidden z-0 select-none ${className}`}
      aria-hidden="true"
    >
      <LiquidGlassFilter />

      {/* 1. Fluid Liquid Gradient Blobs with Palette Tones */}
      <motion.div
        animate={{
          x: [0, 45, -35, 0],
          y: [0, -30, 25, 0],
          scale: [1, 1.08, 0.95, 1],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        className="absolute -top-32 left-1/2 -translate-x-1/2 w-[720px] h-[480px] rounded-full bg-gradient-to-br from-[var(--palette-teal)]/22 via-[var(--palette-sage)]/16 to-transparent blur-[110px]"
      />

      <motion.div
        animate={{
          x: [0, -50, 40, 0],
          y: [0, 40, -35, 0],
          scale: [1, 0.92, 1.12, 1],
        }}
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 2,
        }}
        className="absolute top-1/4 -left-48 w-[580px] h-[580px] rounded-full bg-gradient-to-tr from-[var(--palette-rose)]/20 via-[var(--palette-bisque)]/18 to-transparent blur-[130px]"
      />

      <motion.div
        animate={{
          x: [0, 60, -45, 0],
          y: [0, -45, 30, 0],
          scale: [1, 1.14, 0.94, 1],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 4,
        }}
        className="absolute bottom-1/4 -right-48 w-[620px] h-[620px] rounded-full bg-gradient-to-bl from-[var(--palette-plum)]/18 via-[var(--palette-rose)]/14 to-transparent blur-[130px]"
      />

      <motion.div
        animate={{
          x: [0, -30, 35, 0],
          y: [0, 35, -25, 0],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 1,
        }}
        className="absolute top-2/3 left-1/4 w-[460px] h-[460px] rounded-full bg-gradient-to-r from-[var(--palette-teal)]/14 via-[var(--palette-sage)]/10 to-transparent blur-[120px]"
      />

      {/* 2. Liquid Glass Refractive Sheet */}
      <div
        className="absolute inset-0 opacity-40 dark:opacity-25"
        style={{
          backdropFilter: 'url("#liquid-glass-ambient")',
          WebkitBackdropFilter: 'blur(30px)',
        }}
      />

      {/* 3. Subtle Satin Matte Vignette / Noise Mesh Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(105,79,93,0.06),transparent_70%)]" />
    </div>
  );
}
