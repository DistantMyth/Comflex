import { useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import './Homepage.css';
import collegeImage from '../assets/college.jpeg';
import goldMedal from '../assets/gold.png';
import silverMedal from '../assets/silver.png';
import bronzeMedal from '../assets/bronze.png';
import Avatar from '../components/Avatar';

gsap.registerPlugin(ScrollTrigger);

const Homepage = () => {
  const { isAuthenticated, user } = useAuth();
  const container = useRef(null);
  const shouldReduceMotion = useReducedMotion();

  useGSAP(() => {
    let isMounted = true;

    if (shouldReduceMotion) {
      // In reduced-motion mode, skip heavy path drawing & pin scrolling
      gsap.set('.text-draw-path', { strokeDashoffset: 0, fill: 'white' });
      gsap.set('.text-munity, .text-join-your, .text-badges', { opacity: 1 });
      return;
    }

    // 1. Initial handwriting wipe animation on load using a chained timeline
    const drawTl = gsap.timeline();
    drawTl.fromTo(
      '.text-draw-path',
      { strokeDashoffset: 1200, fill: 'transparent' },
      { strokeDashoffset: 0, duration: 2.8, ease: 'power2.inOut' }
    ).to(
      '.text-draw-path',
      { fill: 'white', duration: 1.0, ease: 'power1.inOut' },
      '-=0.4'
    );

    // 2. Responsive ScrollTrigger timeline using matchMedia
    const mm = gsap.matchMedia(container);

    mm.add({
      isMobile: '(max-width: 767px)',
      isDesktop: '(min-width: 768px)',
    }, (context) => {
      const { isMobile } = context.conditions;
      const flexShift = isMobile ? 80 : 160;
      const titleShift = isMobile ? -20 : -40;

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: '.hero-section',
          start: 'top top',
          end: '+=250%',
          scrub: 1,
          pin: true,
        },
      });

      tl.to('.text-flex', { y: flexShift, duration: 2 }, 0)
        .to('.hero-main-title', { y: titleShift, duration: 2 }, 0)
        .to('.text-munity', { opacity: 1, duration: 1 }, 1)
        .to('.text-join-your', { opacity: 1, y: 0, duration: 1 }, 1)
        .to('.text-badges', { opacity: 1, x: 0, duration: 1 }, 1)
        .to('.hero-content', { opacity: 0, scale: 0.9, duration: 2 }, 5.5);
    });

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (isMounted) ScrollTrigger.refresh();
      });
    }

    return () => {
      isMounted = false;
    };
  }, { scope: container, dependencies: [shouldReduceMotion] });

  return (
    <div className="homepage-container" ref={container}>
      {/* Hidden semantic heading for screen readers & SEO */}
      <h1 className="sr-only">Comflex — College Community Platform: Join your community, flex your badges</h1>

      {/* Top Navbar */}
      <nav className="homepage-nav" aria-label="Landing Navigation">
        <Link to="/" className="nav-logo" aria-label="Comflex Home">Comflex</Link>
        <div className="nav-links">
          {isAuthenticated ? (
            <Link to="/groups" className="btn-primary flex items-center gap-2">
              <Avatar
                src={user?.avatarUrl}
                name={user?.displayName}
                className="w-6 h-6 rounded-full inline-block"
              />
              <span>Dashboard ({user?.displayName?.split(' ')[0] || 'App'})</span>
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn-secondary">Login</Link>
              <Link to="/register" className="btn-primary">Register</Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero Animation Section */}
      <section className="hero-section" aria-label="Hero Introduction">
        <div className="hero-content">
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
      </section>

      {/* Feature 1: Image Left, Text Right */}
      <motion.section
        className="feature-section left-image-section"
        initial={{ opacity: 0, x: shouldReduceMotion ? 0 : -40, y: 20 }}
        whileInView={{ opacity: 1, x: 0, y: 0 }}
        viewport={{ once: true, margin: '-10%' }}
        transition={{ type: 'spring', stiffness: 60, damping: 15, duration: 0.9 }}
      >
        <div className="feature-content">
          <div className="feature-image-wrapper">
            <img
              src={collegeImage}
              alt="College campus and students collaborating"
              className="feature-image"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="feature-text">
            <h2>Seamless Event Management</h2>
            <p>
              Experience smooth transitions and organized planning for all your community events.
              Track participants, coordinate activities, and schedule milestones effectively.
            </p>
          </div>
        </div>
      </motion.section>

      {/* Feature 2: Image Right (Popping Medals), Text Left */}
      <motion.section
        className="feature-section right-image-section"
        initial={{ opacity: 0, x: shouldReduceMotion ? 0 : 40, y: 20 }}
        whileInView={{ opacity: 1, x: 0, y: 0 }}
        viewport={{ once: true, margin: '-10%' }}
        transition={{ type: 'spring', stiffness: 60, damping: 15, duration: 0.9 }}
      >
        <div className="feature-content reverse">
          <div className="feature-image-wrapper medals-cluster">
            <motion.img
              src={silverMedal}
              alt="Silver achievement medal"
              className="medal silver-medal"
              loading="lazy"
              decoding="async"
              initial={{ opacity: 0, x: -30, y: 20, rotate: -25, scale: 0.7 }}
              whileInView={{ opacity: 1, x: 0, y: 0, rotate: -15, scale: 1 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ type: 'spring', stiffness: 75, damping: 14, delay: 0.1 }}
            />
            <motion.img
              src={bronzeMedal}
              alt="Bronze achievement medal"
              className="medal bronze-medal"
              loading="lazy"
              decoding="async"
              initial={{ opacity: 0, x: 30, y: 20, rotate: 25, scale: 0.7 }}
              whileInView={{ opacity: 1, x: 0, y: 0, rotate: 15, scale: 1 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ type: 'spring', stiffness: 75, damping: 14, delay: 0.2 }}
            />
            <motion.img
              src={goldMedal}
              alt="Gold achievement medal"
              className="medal gold-medal"
              loading="lazy"
              decoding="async"
              initial={{ opacity: 0, y: 40, scale: 0.6 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={{ type: 'spring', stiffness: 85, damping: 12, delay: 0.3 }}
            />
          </div>
          <div className="feature-text">
            <h2>Showcase Your Achievements</h2>
            <p>
              Earn badges, showcase accomplishments, and let the college community recognize your
              dedication and milestones.
            </p>
          </div>
        </div>
      </motion.section>

      {/* Standard Bottom Content */}
      <section className="standard-section">
        <h2>Start Building Your Legacy</h2>
        <div className="grid-features">
          <div className="grid-item">
            <h3>Connect</h3>
            <p>Meet like-minded peers, mentors, and innovators in your college and beyond.</p>
          </div>
          <div className="grid-item">
            <h3>Compete</h3>
            <p>Participate in dynamic events, hackathons, and collaborative group challenges.</p>
          </div>
          <div className="grid-item">
            <h3>Reward</h3>
            <p>Redeem, flaunt, and showcase your verified badges across the network.</p>
          </div>
        </div>
        <Link
          to={isAuthenticated ? '/groups' : '/register'}
          className="cta-button inline-block"
        >
          {isAuthenticated ? 'Go to Dashboard' : 'Join Comflex Today'}
        </Link>
      </section>

      {/* Footer */}
      <footer className="homepage-footer">
        <p>&copy; {new Date().getFullYear()} Comflex Platform. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default Homepage;