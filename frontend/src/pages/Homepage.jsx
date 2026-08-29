import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';
import './Homepage.css';
import collegeImage from '../assets/college.jpeg';
import goldMedal from '../assets/gold.png';
import silverMedal from '../assets/silver.png';
import bronzeMedal from '../assets/bronze.png';

gsap.registerPlugin(ScrollTrigger);

const Homepage = () => {
  const navigate = useNavigate();
  const container = useRef(null);

  useGSAP(() => {
    // 1. Initial handwriting wipe animation on load
    gsap.fromTo('.text-draw-path',
      { strokeDashoffset: 1200, fill: 'transparent' },
      {
        strokeDashoffset: 0,
        duration: 3,
        ease: 'power2.inOut',
        onComplete: () => {
          gsap.to('.text-draw-path', {
            fill: 'white',
            duration: 1.2,
            ease: 'power1.inOut',
          });
        },
      }
    );

    // 2. Timeline for ScrollTrigger
    const isMobile = window.innerWidth < 768;
    const flexShift = isMobile ? 95 : 180;
    const titleShift = isMobile ? -30 : -50;

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '.hero-section',
        start: 'top top',
        end: '+=280%',
        scrub: 1,
        pin: true,
      },
    });

    // Sequence:
    // - "flex" detaches and moves down
    // - "munity", "join your", "your badges" fade and slide in
    // - hold on screen for readability
    // - hero fades out smoothly before the next section
    tl.to('.text-flex', { y: flexShift, duration: 2 }, 0)
      .to('.hero-main-title', { y: titleShift, duration: 2 }, 0)
      .to('.text-munity', { opacity: 1, duration: 1 }, 1)
      .to('.text-join-your', { opacity: 1, y: 0, duration: 1 }, 1)
      .to('.text-badges', { opacity: 1, x: 0, duration: 1 }, 1)
      .to('.hero-content', { opacity: 0, scale: 0.85, duration: 2 }, 6.5);

    document.fonts?.ready?.then(() => {
      ScrollTrigger.refresh();
    });
  }, { scope: container });

  return (
    <div className="homepage-container" ref={container}>
      {/* Top Navbar */}
      <nav className="homepage-nav">
        <div className="nav-logo">Comflex</div>
        <div className="nav-links">
          <button onClick={() => navigate('/login')} className="btn-secondary">Login</button>
          <button onClick={() => navigate('/register')} className="btn-primary">Register</button>
        </div>
      </nav>

      {/* Hero Animation Section */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="hero-main-title">
            <div className="title-interactive-wrapper">
              <span className="text-com">
                <div className="text-join-your">join your</div>
                <span className="word-wrapper">
                  <span className="text-placeholder">Com</span>
                  <svg className="text-draw-svg">
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
                  <svg className="text-draw-svg">
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
        initial={{ opacity: 0, x: -120, y: 30, scale: 0.92 }}
        whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        viewport={{ once: false, margin: '-10%' }}
        transition={{ type: 'spring', stiffness: 55, damping: 14, duration: 1.1 }}
      >
        <div className="feature-content">
          <div className="feature-image-wrapper">
            <img src={collegeImage} alt="College Campus" className="feature-image" />
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
        initial={{ opacity: 0, x: 120, y: 30, scale: 0.92 }}
        whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        viewport={{ once: false, margin: '-10%' }}
        transition={{ type: 'spring', stiffness: 55, damping: 14, duration: 1.1 }}
      >
        <div className="feature-content reverse">
          <div className="feature-image-wrapper medals-cluster">
            <motion.img
              src={silverMedal}
              alt="Silver Medal"
              className="medal silver-medal"
              initial={{ opacity: 0, x: -60, y: 20, rotate: -35, scale: 0.6 }}
              whileInView={{ opacity: 1, x: 0, y: 0, rotate: -15, scale: 1 }}
              viewport={{ once: false, margin: '-10%' }}
              transition={{ type: 'spring', stiffness: 75, damping: 12, delay: 0.15 }}
            />
            <motion.img
              src={bronzeMedal}
              alt="Bronze Medal"
              className="medal bronze-medal"
              initial={{ opacity: 0, x: 60, y: 30, rotate: 35, scale: 0.6 }}
              whileInView={{ opacity: 1, x: 0, y: 0, rotate: 15, scale: 1 }}
              viewport={{ once: false, margin: '-10%' }}
              transition={{ type: 'spring', stiffness: 75, damping: 12, delay: 0.3 }}
            />
            <motion.img
              src={goldMedal}
              alt="Gold Medal"
              className="medal gold-medal"
              initial={{ opacity: 0, y: 70, scale: 0.4 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: false, margin: '-10%' }}
              transition={{ type: 'spring', stiffness: 85, damping: 10, bounce: 0.5, delay: 0.45 }}
            />
          </div>
          <div className="feature-text">
            <h2>Showcase Your Achievements</h2>
            <p>
              Earn badges, showcase accomplishments, and let the global community recognize your
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
        <button className="cta-button" onClick={() => navigate('/register')}>
          Join Comflex Today
        </button>
      </section>

      {/* Footer */}
      <footer className="homepage-footer">
        <p>&copy; {new Date().getFullYear()} Comflex. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default Homepage;