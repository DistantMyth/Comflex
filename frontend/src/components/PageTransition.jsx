/**
 * PageTransition — Animated wrapper for routed pages with reduced motion support.
 * Fades content in on mount / route change.
 */

import { motion, useReducedMotion } from 'framer-motion';

export default function PageTransition({ children }) {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return <div style={{ height: '100%' }}>{children}</div>;
  }

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