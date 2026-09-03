/**
 * GlowButton.jsx — 21st.dev inspired Tactile Glow & Shimmer Button
 *
 * Features:
 * - Animated continuous specular border shimmer via rotating conic gradient.
 * - Interactive mouse-hover radial glow tracking cursor coordinates.
 * - Tactile spring physics (whileHover scale/lift, whileTap active press).
 * - Polymorphic API: renders as <button>, <Link to="..." />, or <a href="..." />.
 */

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

export default function GlowButton({
  children,
  to,
  href,
  onClick,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconPosition = 'left',
  className = '',
  disabled = false,
  shimmer = true,
  ...props
}) {
  const buttonRef = useRef(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0, opacity: 0 });

  const handleMouseMove = (e) => {
    if (disabled || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      opacity: 1,
    });
  };

  const handleMouseLeave = () => {
    setMousePos((prev) => ({ ...prev, opacity: 0 }));
  };

  const sizeStyles = {
    sm: 'text-xs px-4 py-2 gap-1.5',
    md: 'text-sm px-6 py-2.5 gap-2',
    lg: 'text-base px-8 py-3.5 gap-2.5 font-semibold',
  }[size] || 'text-sm px-6 py-2.5 gap-2';

  const variantStyles = {
    primary: {
      inner: 'bg-gradient-to-r from-[#68a691] via-[#569480] to-[#457c6b] text-white shadow-md shadow-[#68a691]/25',
      glow: 'rgba(104, 166, 145, 0.45)',
      shimmerConic: 'conic-gradient(from 0deg at 50% 50%, transparent 0deg, transparent 260deg, #68a691 300deg, #efc7c2 340deg, #ffffff 360deg)',
    },
    secondary: {
      inner: 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)] backdrop-blur-xl border border-[var(--color-border)] shadow-sm hover:border-[var(--color-border-hover)]',
      glow: 'rgba(239, 199, 194, 0.35)',
      shimmerConic: 'conic-gradient(from 0deg at 50% 50%, transparent 0deg, transparent 260deg, #68a691 300deg, #efc7c2 340deg, #ffffff 360deg)',
    },
    glass: {
      inner: 'glass-card bg-[var(--color-bg-card)]/80 text-[var(--color-text-primary)] backdrop-blur-2xl border border-[var(--color-border)]',
      glow: 'rgba(104, 166, 145, 0.3)',
      shimmerConic: 'conic-gradient(from 0deg at 50% 50%, transparent 0deg, transparent 280deg, #bfd3c1 310deg, #efc7c2 345deg, #ffffff 360deg)',
    },
    blush: {
      inner: 'bg-gradient-to-r from-[#efc7c2] via-[#ffe5d4] to-[#efc7c2] text-[#291e24] shadow-md shadow-[#efc7c2]/30',
      glow: 'rgba(239, 199, 194, 0.5)',
      shimmerConic: 'conic-gradient(from 0deg at 50% 50%, transparent 0deg, transparent 260deg, #efc7c2 300deg, #68a691 340deg, #ffffff 360deg)',
    },
  }[variant] || variantStyles.primary;

  const springConfig = { type: 'spring', stiffness: 420, damping: 20 };

  const content = (
    <>
      {shimmer && !disabled && (
        <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none p-[1.5px]">
          <motion.div
            className="absolute inset-[-150%] pointer-events-none"
            style={{ background: variantStyles.shimmerConic }}
            animate={{ rotate: [0, 360] }}
            transition={{ repeat: Infinity, duration: 4.5, ease: 'linear' }}
          />
        </div>
      )}

      {!disabled && (
        <motion.div
          aria-hidden="true"
          className="absolute inset-0 rounded-full pointer-events-none z-0 transition-opacity duration-300"
          animate={{ opacity: mousePos.opacity }}
          style={{
            background: `radial-gradient(110px circle at ${mousePos.x}px ${mousePos.y}px, ${variantStyles.glow}, transparent 70%)`,
          }}
        />
      )}

      <div
        aria-hidden="true"
        className="absolute inset-1 rounded-full blur-md -z-10 opacity-60 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: variantStyles.glow }}
      />

      <span
        className={`relative z-10 inline-flex items-center justify-center w-full h-full rounded-full font-semibold select-none transition-all duration-200 ${sizeStyles} ${variantStyles.inner}`}
      >
        {Icon && iconPosition === 'left' && (
          <Icon className="w-4 h-4 flex-shrink-0 transition-transform duration-200 group-hover:scale-110" />
        )}
        <span>{children}</span>
        {Icon && iconPosition === 'right' && (
          <Icon className="w-4 h-4 flex-shrink-0 transition-transform duration-200 group-hover:translate-x-0.5" />
        )}
      </span>
    </>
  );

  const sharedMotionProps = {
    ref: buttonRef,
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    whileHover: disabled ? {} : { scale: 1.025, y: -1 },
    whileTap: disabled ? {} : { scale: 0.975, y: 1 },
    transition: springConfig,
    className: `group relative inline-flex items-center justify-center p-[1.5px] rounded-full overflow-visible cursor-pointer no-underline ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`,
  };

  if (to && !disabled) {
    return (
      <motion.div {...sharedMotionProps}>
        <Link to={to} className="w-full h-full no-underline" {...props}>
          {content}
        </Link>
      </motion.div>
    );
  }

  if (href && !disabled) {
    return (
      <motion.a href={href} {...sharedMotionProps} {...props}>
        {content}
      </motion.a>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...sharedMotionProps}
      {...props}
    >
      {content}
    </motion.button>
  );
}
