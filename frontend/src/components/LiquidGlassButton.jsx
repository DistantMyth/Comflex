/**
 * LiquidGlassButton.jsx — Official 21st.dev (@designali-in) Liquid Glass Button
 * Enhanced for Comflex with our custom matte + glassy theme & palette.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import LiquidGlassFilter from './LiquidGlassFilter';

export default function LiquidGlassButton({
  children,
  to,
  href,
  onClick,
  variant = 'primary',
  size = 'md',
  className = '',
  icon: Icon,
  disabled = false,
  type = 'button',
  ...props
}) {
  const [isPressed, setIsPressed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  const sizeClasses = {
    sm: 'h-9 px-4 text-xs gap-1.5',
    md: 'h-11 px-6 text-sm gap-2',
    lg: 'h-13 px-8 text-base gap-2.5',
  }[size] || 'h-11 px-6 text-sm gap-2';

  const variantGlow = {
    primary: 'hover:border-[var(--palette-teal)]/60 text-[var(--color-text-primary)]',
    secondary: 'hover:border-[var(--palette-rose)]/50 text-[var(--color-text-primary)]',
    ghost: 'hover:bg-white/10 text-[var(--color-text-primary)]',
  }[variant] || 'hover:border-[var(--palette-teal)]/60 text-[var(--color-text-primary)]';

  const innerContent = (
    <>
      {/* Liquid Glass Multi-Layered Specular Bevel Shadow from 21st.dev */}
      <div
        className="absolute inset-0 z-0 rounded-full transition-all duration-300 pointer-events-none
          shadow-[0_0_6px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.08),inset_3px_3px_0.5px_-3px_rgba(66,45,57,0.85),inset_-3px_-3px_0.5px_-3px_rgba(255,255,255,0.9),inset_1px_1px_1px_-0.5px_rgba(104,166,145,0.7),inset_-1px_-1px_1px_-0.5px_rgba(239,199,194,0.6),inset_0_0_8px_4px_rgba(104,166,145,0.12),0_0_14px_rgba(255,255,255,0.2)]
          dark:shadow-[0_0_8px_rgba(0,0,0,0.25),0_3px_8px_rgba(0,0,0,0.35),inset_3px_3px_0.5px_-3.5px_rgba(255,255,255,0.12),inset_-3px_-3px_0.5px_-3.5px_rgba(255,255,255,0.8),inset_1px_1px_1px_-0.5px_rgba(104,166,145,0.6),inset_-1px_-1px_1px_-0.5px_rgba(239,199,194,0.6),inset_0_0_8px_4px_rgba(104,166,145,0.15),0_0_16px_rgba(104,166,145,0.25)]"
      />

      {/* SVG Displacement Refraction Filter Layer */}
      <div
        className="absolute inset-0 isolate -z-10 rounded-full overflow-hidden pointer-events-none"
        style={{
          backdropFilter: 'url("#container-glass")',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      />

      {/* Specular Radial Sheen on hover */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 rounded-full overflow-hidden transition-opacity duration-300 ${
          isHovered && !isPressed ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/10 to-white/20" />
      </div>

      {/* Active click shine wave */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-full transition-opacity duration-300 ${
          isPressed ? 'opacity-30' : 'opacity-0'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent" />
      </div>

      {/* Label and Icon */}
      <span className="relative z-10 font-display font-bold tracking-tight inline-flex items-center gap-2">
        {Icon && <Icon size={16} className="text-[var(--palette-teal)] transition-transform group-hover:scale-110" />}
        {children}
      </span>

      <LiquidGlassFilter />
    </>
  );

  const baseClasses = `relative inline-flex items-center justify-center rounded-full font-medium select-none overflow-hidden cursor-pointer transition-all duration-300 group ${sizeClasses} ${variantGlow} ${className}`;

  if (to) {
    return (
      <Link
        to={to}
        className={baseClasses}
        onMouseEnter={() => !isTouch && setIsHovered(true)}
        onMouseLeave={() => { setIsHovered(false); setIsPressed(false); }}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onTouchStart={() => setIsPressed(true)}
        onTouchEnd={() => setIsPressed(false)}
        {...props}
      >
        {innerContent}
      </Link>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        className={baseClasses}
        onMouseEnter={() => !isTouch && setIsHovered(true)}
        onMouseLeave={() => { setIsHovered(false); setIsPressed(false); }}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onTouchStart={() => setIsPressed(true)}
        onTouchEnd={() => setIsPressed(false)}
        {...props}
      >
        {innerContent}
      </a>
    );
  }

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={baseClasses}
      onMouseEnter={() => !isTouch && setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setIsPressed(false); }}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onTouchStart={() => setIsPressed(true)}
      onTouchEnd={() => setIsPressed(false)}
      {...props}
    >
      {innerContent}
    </button>
  );
}
