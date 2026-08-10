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
    // 1. Initial wipe animation on load (not scrubbed)
    gsap.fromTo('.text-draw-path',
      { strokeDashoffset: 1000, fill: "transparent" },
      { 
        strokeDashoffset: 0, 
        duration: 3.5, 
        ease: 'power2.inOut',
        onComplete: () => {
          gsap.to('.text-draw-path', { fill: "white", duration: 1.5, ease: 'power1.inOut' });
        }
      }
    );

      // 2. Timeline for ScrollTrigger
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '.hero-section',
        start: 'top top',
        end: '+=300%', // Increased spacing to keep text on screen longer
        scrub: 1,
        pin: true,
      }
    });

    // Sequence: 
    // - "flex" detaches and moves down
    // - "munity", "join your", "your badges" fade in at appropriate places
    
    tl.to('.text-flex', { y: 200, duration: 2 }, 0)       // flex moves down
      .to('.hero-main-title', { y: -50, duration: 2 }, 0) // shift the group slightly up to balance
      .to('.text-munity', { opacity: 1, duration: 1 }, 1)  // "Com" to "Community"
      .to('.text-join-your', { opacity: 1, y: 0, duration: 1 }, 1) // "join your" appears above "Community"
      .to('.text-badges', { opacity: 1, x: 0, duration: 1 }, 1)    // "your badges" appears right of "flex"
      .to('.hero-content', { opacity: 0, scale: 0.8, duration: 2 }, 7); // Start fade out much later to hold text on screen

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

      {/* Hero Animation section */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="hero-main-title">
            <div style={{ display: 'flex', flexDirection: 'row', position: 'relative' }}>
              <span className="text-com">
                <div className="text-join-your" style={{ opacity: 0 }}>join your</div>
                <span style={{ position: 'relative', display: 'inline-block' }}>
                  <span style={{ color: 'transparent' }}>Com</span>
                  <svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible' }}>
                    <text className="text-draw-path" x="50%" y="55%" dominantBaseline="middle" textAnchor="middle">Com</text>
                  </svg>
                </span>
                <span className="text-munity" style={{ opacity: 0 }}>munity</span>
              </span>
              <span className="text-flex">
                <span style={{ position: 'relative', display: 'inline-block' }}>
                  <span style={{ color: 'transparent' }}>flex</span>
                  <svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible' }}>
                    <text className="text-draw-path" x="50%" y="55%" dominantBaseline="middle" textAnchor="middle">flex</text>
                  </svg>
                </span>
                <span className="text-badges" style={{ opacity: 0 }}>your badges</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Feature 1: Image Left, Text Right */}
      <motion.section 
        className="feature-section left-image-section"
        initial={{ opacity: 0, x: -200, y: 50, scale: 0.8 }}
        whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        viewport={{ once: false, margin: "-15%" }}
        transition={{ type: "spring", stiffness: 60, damping: 15, duration: 1.2 }}
      >
        <div className="feature-content">
          <div className="feature-image-wrapper">
            <img src={collegeImage} alt="College Campus" className="feature-image" />
          </div>
          <div className="feature-text">
            <h2>Seamless Event Management</h2>
            <p>Experience smooth transitions and organized planning for all your community events. Track participants and schedules effectively.</p>
          </div>
        </div>
      </motion.section>

      {/* Feature 2: Image Right, Text Left */}
      <motion.section 
        className="feature-section right-image-section"
        initial={{ opacity: 0, x: 200, y: 50, scale: 0.8 }}
        whileInView={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        viewport={{ once: false, margin: "-15%" }}
        transition={{ type: "spring", stiffness: 60, damping: 15, duration: 1.2 }}
      >
        <div className="feature-content reverse">
          <div className="feature-image-wrapper medals-cluster">
            <motion.img src={silverMedal} alt="Silver" className="medal silver-medal" initial={{ opacity: 0, x: -50, rotate: -30 }} whileInView={{ opacity: 1, x: 0, rotate: -15 }} transition={{ type: 'spring', delay: 0.2 }} />
            <motion.img src={bronzeMedal} alt="Bronze" className="medal bronze-medal" initial={{ opacity: 0, x: 50, rotate: 30 }} whileInView={{ opacity: 1, x: 0, rotate: 15 }} transition={{ type: 'spring', delay: 0.4 }} />
            <motion.img src={goldMedal} alt="Gold" className="medal gold-medal" initial={{ opacity: 0, y: 50, scale: 0.5 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', delay: 0.6, bounce: 0.5 }} />
          </div>
          <div className="feature-text">
            <h2>Showcase Your Achievements</h2>
            <p>Earn badges, showcase accomplishments, and let the global community recognize your dedication and milestones.</p>
          </div>
        </div>
      </motion.section>

      {/* Standard Bottom Content */}
      <section className="standard-section">
        <h2>Start Building Your Legacy</h2>
        <div className="grid-features">
          <div className="grid-item">
            <h3>Connect</h3>
            <p>Meet like-minded individuals.</p>
          </div>
          <div className="grid-item">
            <h3>Compete</h3>
            <p>Participate in events and groups.</p>
          </div>
          <div className="grid-item">
            <h3>Reward</h3>
            <p>Redeem and showcase your earned badges.</p>
          </div>
        </div>
        <button className="cta-button" onClick={() => navigate('/register')}>Join Comflex Today</button>
      </section>

      {/* Footer */}
      <footer className="homepage-footer">
        <p>&copy; {new Date().getFullYear()} Comflex. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default Homepage;