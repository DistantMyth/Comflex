import { useRef, useEffect, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useReducedMotion } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';
import './AnimatedComflexTitle.css';

gsap.registerPlugin(ScrollTrigger);

export default function AnimatedComflexTitle() {
  const container = useRef(null);
  const shouldReduceMotion = useReducedMotion();
  const { theme } = useTheme();
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const timeout = setTimeout(() => {
      if (isMounted) setFontsReady(true);
    }, 350);

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        clearTimeout(timeout);
        if (isMounted) setFontsReady(true);
      });
    }

    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!fontsReady) return;
    let isMounted = true;
    const target = container.current;
    if (!target) return;

    const ctx = gsap.context(() => {
      const paths = target.querySelectorAll('.text-draw-path');
      const textFillColor = theme === 'light' ? '#1a1418' : '#ffffff';

      if (shouldReduceMotion) {
        gsap.set(paths, { strokeDashoffset: 0, fill: textFillColor });
        paths.forEach(p => p.classList.add('draw-finished'));
        gsap.set('.text-munity, .text-join-your, .text-badges', { opacity: 1 });
        return;
      }

      // 1. Initial handwriting draw wipe on load
      const drawTl = gsap.timeline();
      drawTl.fromTo(
        paths,
        { strokeDashoffset: 1200, fill: 'transparent' },
        { strokeDashoffset: 0, duration: 2.2, ease: 'power2.inOut' }
      ).to(
        paths,
        {
          fill: textFillColor,
          duration: 0.8,
          ease: 'power1.inOut',
          onComplete: () => {
            paths.forEach(p => p.classList.add('draw-finished'));
          },
        },
        '-=0.3'
      );

      // 2. Responsive ScrollTrigger timeline with PINNING:
      // (comflex written) -> (on scroll) -> (page doesn't go down, instead comflex expands) -> (comflex fully expanded) -> (scroll resumes)
      const mm = gsap.matchMedia();

      mm.add({
        isMobile: '(max-width: 767px)',
        isDesktop: '(min-width: 768px)',
      }, (c) => {
        const { isMobile } = c.conditions;
        const flexShift = isMobile ? 70 : 125;
        const titleShift = isMobile ? -15 : -30;

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: target,
            start: 'top 22%',
            end: '+=280',
            pin: true,
            pinSpacing: true,
            scrub: 0.6,
            anticipatePin: 1,
            fastScrollEnd: true,
            preventOverlaps: true,
          },
        });

        tl.to('.text-flex', { y: flexShift, duration: 2 }, 0)
          .to('.hero-main-title', { y: titleShift, duration: 2 }, 0)
          .to('.text-munity', { opacity: 1, duration: 1.2 }, 0.4)
          .to('.text-join-your', { opacity: 1, y: 0, duration: 1.2 }, 0.4)
          .to('.text-badges', { opacity: 1, x: 0, duration: 1.2 }, 0.4);
      });
    }, container);

    ScrollTrigger.refresh();

    return () => {
      isMounted = false;
      ctx.revert();
    };
  }, [fontsReady, shouldReduceMotion, theme]);

  return (
    <div
      className="animated-comflex-container"
      ref={container}
      style={{ opacity: fontsReady ? 1 : 0, transition: 'opacity 0.2s ease-in' }}
    >
      <h1 className="sr-only">Comflex — Join your community, flex your badges</h1>
      <div className="hero-main-title" aria-hidden="true">
        <div className="title-interactive-wrapper">
          <span className="text-com">
            <span className="text-join-your">join your</span>
            <span className="word-wrapper">
              <span className="text-placeholder">Com</span>
              <svg className="text-draw-svg" aria-hidden="true">
                <text
                  className="text-draw-path"
                  x="50%"
                  y="55%"
                  dominantBaseline="middle"
                  textAnchor="middle"
                >
                  Com
                </text>
              </svg>
            </span>
            <span className="text-munity">munity</span>
          </span>

          <span className="text-flex">
            <span className="word-wrapper">
              <span className="text-placeholder">flex</span>
              <svg className="text-draw-svg" aria-hidden="true">
                <text
                  className="text-draw-path"
                  x="50%"
                  y="55%"
                  dominantBaseline="middle"
                  textAnchor="middle"
                >
                  flex
                </text>
              </svg>
            </span>
            <span className="text-badges">your badges</span>
          </span>
        </div>
      </div>
    </div>
  );
}
