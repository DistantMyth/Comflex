/**
 * ScrollProgressBar.jsx — 21st.dev inspired Sleek Gradient Scroll Progress Bar
 *
 * Features:
 * - Anchored at the top of the viewport during page scrolling.
 * - Smooth spring-damped progress physics via Framer Motion useScroll + useSpring.
 * - Comflex palette gradient: Zomp Teal (#68a691) -> Tea Rose (#efc7c2) -> English Violet (#694f5d).
 * - Radiant ambient glow reflection blur directly beneath the bar.
 * - Specular sparkle bead that glides along the leading edge of the progress line.
 */

import { motion, useScroll, useSpring } from 'framer-motion';

export default function ScrollProgressBar({
  targetRef = null,
  height = 3,
  showGlow = true,
  showLeadingBead = true,
  className = '',
}) {
  const { scrollYProgress } = useScroll(
    targetRef ? { target: targetRef } : {}
  );

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 280,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <div
      aria-hidden="true"
      className={`fixed top-0 inset-x-0 z-[100] pointer-events-none ${className}`}
      style={{ height: `${height}px` }}
    >
      {/* Underlying Ambient Luminous Glow Bloom */}
      {showGlow && (
        <motion.div
          className="absolute inset-0 blur-[4px] opacity-70 origin-left"
          style={{
            scaleX,
            background: 'linear-gradient(90deg, #68a691 0%, #efc7c2 50%, #694f5d 100%)',
            height: `${height * 2.2}px`,
          }}
        />
      )}

      {/* Main Crisp Progress Line */}
      <motion.div
        className="relative w-full h-full origin-left"
        style={{
          scaleX,
          background: 'linear-gradient(90deg, #68a691 0%, #efc7c2 50%, #694f5d 100%)',
        }}
      >
        {/* Specular Leading Head / Sparkle Bead */}
        {showLeadingBead && (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 flex items-center justify-center">
            <div className="w-3.5 h-3.5 rounded-full bg-[#efc7c2] blur-[2px] opacity-80 animate-pulse" />
            <div className="absolute w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#efc7c2]" />
          </div>
        )}
      </motion.div>
    </div>
  );
}
