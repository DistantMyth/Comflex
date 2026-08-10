/**
 * PageTransition — Animated wrapper for routed pages.
 * Fades content in on mount / route change.
 * No exit animation — AnimatePresence swaps instantly, avoiding the
 * visible delay ("tab glitch") that exit + wait mode caused.
 */

import { motion } from 'framer-motion';

export default function PageTransition({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
      style={{ height: '100%' }}
    >
      {children}
    </motion.div>
  );
}