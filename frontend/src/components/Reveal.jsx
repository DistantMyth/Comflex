/**
 * Reveal — Scroll-triggered entrance animation.
 * Wraps content and animates it in when it enters the viewport.
 *
 * <Reveal delay={0.1}><Card /></Reveal>
 */

import { motion } from 'framer-motion';

export default function Reveal({ children, delay = 0, y = 24, className, once = true }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
