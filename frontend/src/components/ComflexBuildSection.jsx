/**
 * ComflexBuildSection.jsx — Scroll-Driven Self-Building Vector Logo Section
 *
 * Implements ScrollTrigger PINNING:
 * (scroll reaches section) -> (page pins, doesn't scroll down) ->
 * (vector logo builds itself: strokes draw -> exploded pieces converge ->
 *  core node blooms -> specular sheen & wordmark appear) ->
 * (logo fully assembled) -> (scroll resumes immediately into Features)
 *
 * Enhanced with contrast underlay borders for Light & Dark mode visibility.
 */

import { useRef, useEffect, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Sparkles, Layers, RefreshCw, Cpu, ShieldCheck } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

gsap.registerPlugin(ScrollTrigger);

export default function ComflexBuildSection() {
  const containerRef = useRef(null);
  const { theme } = useTheme();
  const [activeStage, setActiveStage] = useState(1);
  const [percentText, setPercentText] = useState(0);

  const stages = [
    {
      id: '01',
      title: 'Community Backbone Arc',
      desc: 'Verified campus perimeter and cryptographic trust boundary.',
      icon: Layers,
    },
    {
      id: '02',
      title: 'Flexibility Infinity Weave',
      desc: 'Dual peer ribbons interlock into an agile infinity nexus.',
      icon: RefreshCw,
    },
    {
      id: '03',
      title: 'Reputation Beacon Node',
      desc: 'Centralizing peer vouches, merit rings, and collegiate identity.',
      icon: Cpu,
    },
    {
      id: '04',
      title: 'Unified Campus Platform',
      desc: 'Fully assembled Comflex ecosystem for modern college life.',
      icon: ShieldCheck,
    },
  ];

  useEffect(() => {
    let isMounted = true;
    const target = containerRef.current;
    if (!target) return;

    const ctx = gsap.context(() => {
      // Elements
      const archPath = target.querySelector('.build-arch-path');
      const ascendPath = target.querySelector('.build-ascend-path');
      const descendPath = target.querySelector('.build-descend-path');

      const archGroup = target.querySelector('.build-arch-group');
      const ascendGroup = target.querySelector('.build-ascend-group');
      const descendGroup = target.querySelector('.build-descend-group');

      const coreGroup = target.querySelector('.build-core-group');
      const auraCircle = target.querySelector('.build-aura-circle');
      const specularArc = target.querySelector('.build-specular-arc');
      const wordmark = target.querySelector('.build-wordmark');
      const hudProgress = target.querySelector('.build-hud-progress');

      // Initial exploded coordinate setup
      gsap.set(archGroup, { x: -75, y: -45, rotation: -20, scale: 0.86, transformOrigin: '102px 100px' });
      gsap.set(ascendGroup, { x: 80, y: 55, rotation: 22, scale: 0.86, transformOrigin: '102px 100px' });
      gsap.set(descendGroup, { x: 70, y: -55, rotation: -18, scale: 0.86, transformOrigin: '102px 100px' });
      gsap.set(coreGroup, { scale: 0, opacity: 0, transformOrigin: '102px 100px' });
      gsap.set(auraCircle, { scale: 0.3, opacity: 0, transformOrigin: '102px 100px' });
      gsap.set(specularArc, { opacity: 0 });
      gsap.set(wordmark, { opacity: 0, y: 25, filter: 'blur(6px)' });

      // Path stroke length init
      const paths = [archPath, ascendPath, descendPath];
      paths.forEach((p) => {
        if (p) {
          const len = p.getTotalLength ? p.getTotalLength() : 400;
          gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
        }
      });

      // Pinned timeline:
      // (on scroll) -> (page doesn't go down, logo builds itself) -> (fully assembled) -> (scroll resumes)
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: target,
          start: 'top top',
          end: '+=450',
          pin: true,
          pinSpacing: true,
          scrub: 0.5,
          onUpdate: (self) => {
            const p = Math.round(self.progress * 100);
            if (isMounted) {
              setPercentText(p);
              if (p < 28) setActiveStage(1);
              else if (p < 58) setActiveStage(2);
              else if (p < 85) setActiveStage(3);
              else setActiveStage(4);
            }
          },
        },
      });

      // STAGE 1: Stroke drawing (0 -> 1.5s)
      tl.to(archPath, { strokeDashoffset: 0, duration: 1.2, ease: 'power1.out' }, 0)
        .to(ascendPath, { strokeDashoffset: 0, duration: 1.2, ease: 'power1.out' }, 0.2)
        .to(descendPath, { strokeDashoffset: 0, duration: 1.2, ease: 'power1.out' }, 0.3)

      // STAGE 2: Geometric convergence from exploded coordinates (0.8 -> 2.4s)
        .to(archGroup, { x: 0, y: 0, rotation: 0, scale: 1, duration: 1.6, ease: 'power2.out' }, 0.7)
        .to(ascendGroup, { x: 0, y: 0, rotation: 0, scale: 1, duration: 1.6, ease: 'power2.out' }, 0.8)
        .to(descendGroup, { x: 0, y: 0, rotation: 0, scale: 1, duration: 1.6, ease: 'power2.out' }, 0.9)

      // STAGE 3: Core node bloom & aura bloom (1.8 -> 2.8s)
        .to(coreGroup, { scale: 1, opacity: 1, duration: 0.9, ease: 'back.out(1.8)' }, 1.8)
        .to(auraCircle, { scale: 1.25, opacity: 0.9, duration: 1.0, ease: 'power1.out' }, 1.9)

      // STAGE 4: Specular sheen flash & Wordmark reveal (2.4 -> 3.2s)
        .to(specularArc, { opacity: 1, duration: 0.6, ease: 'power1.out' }, 2.3)
        .to(wordmark, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, ease: 'power2.out' }, 2.4)

      // HUD Progress bar linking
        .to(hudProgress, { width: '100%', duration: 3.2, ease: 'none' }, 0);
    }, target);

    return () => {
      isMounted = false;
      ctx.revert();
    };
  }, [theme]);

  return (
    <section
      id="architecture"
      ref={containerRef}
      className="relative min-h-screen w-full flex flex-col items-center justify-center py-16 bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] overflow-hidden border-t border-[var(--color-border)]/40"
    >
      {/* Ambient Radial Glow Background */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-0">
        <div className="w-[500px] h-[500px] md:w-[650px] md:h-[650px] rounded-full bg-gradient-to-br from-[var(--palette-teal)]/15 via-[var(--palette-rose)]/12 to-transparent blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 flex flex-col items-center my-auto">
        {/* Top Header Badge */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-card border border-[var(--color-border)] shadow-sm mb-2">
            <Sparkles size={14} className="text-[var(--palette-teal)] animate-pulse" />
            <span className="text-xs font-bold font-display uppercase tracking-widest text-[var(--color-text-secondary)]">
              Architecture • Scroll to Assemble
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold font-display tracking-tight text-[var(--color-text-primary)]">
            The Geometry of Campus Collaboration
          </h2>
          <p className="text-xs sm:text-sm text-[var(--color-text-secondary)] max-w-xl mx-auto mt-1 leading-relaxed">
            Scroll to synthesize the brand mark — uniting community trust with infinite academic flexibility.
          </p>
        </div>

        {/* Center Canvas: Assembling Vector Mark with Underlay Contrast Borders */}
        <div className="relative w-64 h-64 sm:w-76 sm:h-76 flex items-center justify-center my-2">
          <svg
            viewBox="0 0 200 200"
            className="w-full h-full overflow-visible drop-shadow-2xl"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <filter id="build-matte-sh" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#422d39" floodOpacity="0.22" />
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#68a691" floodOpacity="0.16" />
              </filter>
              <filter id="build-core-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="build-aura" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#68a691" stopOpacity="0.4" />
                <stop offset="50%" stopColor="#efc7c2" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#68a691" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="build-arch" x1="15%" y1="10%" x2="85%" y2="90%">
                <stop offset="0%" stopColor="#68a691" />
                <stop offset="50%" stopColor="#bfd3c1" />
                <stop offset="100%" stopColor="#568d7b" />
              </linearGradient>
              <linearGradient id="build-ascend" x1="100%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#694f5d" />
                <stop offset="45%" stopColor="#efc7c2" />
                <stop offset="100%" stopColor="#68a691" />
              </linearGradient>
              <linearGradient id="build-descend" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#efc7c2" />
                <stop offset="48%" stopColor="#ffe5d4" />
                <stop offset="100%" stopColor="#694f5d" />
              </linearGradient>
              <radialGradient id="build-core" cx="38%" cy="38%" r="62%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="30%" stopColor="#ffe5d4" />
                <stop offset="70%" stopColor="#68a691" />
                <stop offset="100%" stopColor="#694f5d" />
              </radialGradient>
              <linearGradient id="build-specular" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="35%" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="70%" stopColor="#ffffff" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Ambient Aura */}
            <circle
              className="build-aura-circle"
              cx="102"
              cy="100"
              r="74"
              fill="url(#build-aura)"
            />

            {/* SEGMENT 1: Primary Community Arc */}
            <g className="build-arch-group" filter="url(#build-matte-sh)">
              {/* Contrast underlay border for Light & Dark mode */}
              <path
                d="M 148 52 C 102 24, 38 52, 38 100 C 38 148, 102 176, 148 148"
                stroke="rgba(66, 45, 57, 0.3)"
                strokeWidth="17"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                className="build-arch-path"
                d="M 148 52 C 102 24, 38 52, 38 100 C 38 148, 102 176, 148 148"
                stroke="url(#build-arch)"
                strokeWidth="15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>

            {/* SEGMENT 2: Ascending Ribbon */}
            <g className="build-ascend-group">
              {/* Contrast underlay border */}
              <path
                d="M 146 148 C 112 146, 88 122, 102 100 C 116 78, 148 66, 162 84 C 174 98, 160 118, 138 114"
                stroke="rgba(66, 45, 57, 0.3)"
                strokeWidth="15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                className="build-ascend-path"
                d="M 146 148 C 112 146, 88 122, 102 100 C 116 78, 148 66, 162 84 C 174 98, 160 118, 138 114"
                stroke="url(#build-ascend)"
                strokeWidth="13"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>

            {/* SEGMENT 3: Descending Ribbon */}
            <g className="build-descend-group">
              {/* Contrast underlay border */}
              <path
                d="M 146 52 C 112 54, 88 78, 102 100 C 116 122, 148 134, 162 116 C 174 102, 160 82, 138 86"
                stroke="rgba(66, 45, 57, 0.3)"
                strokeWidth="15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                className="build-descend-path"
                d="M 146 52 C 112 54, 88 78, 102 100 C 116 122, 148 134, 162 116 C 174 102, 160 82, 138 86"
                stroke="url(#build-descend)"
                strokeWidth="13"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>

            {/* SEGMENT 4: Reputation Beacon Core Node */}
            <g className="build-core-group" filter="url(#build-core-glow)">
              <circle
                cx="102"
                cy="100"
                r="10.5"
                fill="url(#build-core)"
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

            {/* SEGMENT 5: Specular Sheen */}
            <g className="build-specular-arc">
              <path
                d="M 134 44 C 98 28, 48 50, 44 86"
                stroke="url(#build-specular)"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
            </g>
          </svg>
        </div>

        {/* Wordmark Assembly Reveal */}
        <div className="build-wordmark flex flex-col items-center text-center mt-2 mb-6">
          <div className="font-display font-black text-3xl sm:text-4xl md:text-5xl tracking-tight flex items-baseline">
            <span className="text-[var(--palette-plum)] dark:text-[var(--color-text-primary)] transition-colors drop-shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
              COM
            </span>
            <span className="bg-gradient-to-r from-[var(--palette-teal)] via-[#568d7b] to-[var(--palette-rose)] bg-clip-text text-transparent drop-shadow-[0_1px_2px_rgba(104,166,145,0.25)]">
              FLEX
            </span>
          </div>
          <p className="text-[11px] sm:text-xs font-bold uppercase tracking-[0.28em] text-[var(--color-text-muted)] mt-1">
            Community + Flexibility • Campus Platform
          </p>
        </div>

        {/* Scroll Assembly Progress HUD Bar */}
        <div className="w-full max-w-sm flex items-center justify-between px-4 py-2 rounded-full glass-card border border-[var(--color-border)] text-[10px] font-bold tracking-wider text-[var(--color-text-muted)] mb-8 shadow-sm">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--palette-teal)] animate-ping" />
            ASSEMBLY
          </span>
          <div className="w-36 h-1.5 rounded-full bg-[var(--color-bg-secondary)] overflow-hidden">
            <div
              className="build-hud-progress h-full bg-gradient-to-r from-[var(--palette-teal)] to-[var(--palette-rose)] w-0"
            />
          </div>
          <span className="font-mono">{percentText}%</span>
        </div>

        {/* 4 Architectural Milestone Cards */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {stages.map((stage, idx) => {
            const Icon = stage.icon;
            const isHighlighted = activeStage >= idx + 1;
            return (
              <div
                key={stage.id}
                className={`glass-card p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                  isHighlighted
                    ? 'border-[var(--palette-teal)]/60 shadow-md bg-[var(--palette-teal)]/5'
                    : 'border-[var(--color-border)] opacity-70'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono font-bold text-[var(--color-text-muted)]">
                      STAGE {stage.id}
                    </span>
                    <Icon
                      size={15}
                      className={isHighlighted ? 'text-[var(--palette-teal)]' : 'text-[var(--color-text-muted)]'}
                    />
                  </div>
                  <h4 className="text-xs sm:text-sm font-bold font-display text-[var(--color-text-primary)]">
                    {stage.title}
                  </h4>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-1 leading-relaxed">
                    {stage.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
