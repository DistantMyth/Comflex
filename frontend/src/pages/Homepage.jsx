import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Homepage.css';
import collegeImage from '../assets/college.jpeg';
import goldMedal from '../assets/gold.png';
import silverMedal from '../assets/silver.png';
import bronzeMedal from '../assets/bronze.png';

const Homepage = () => {
  const navigate = useNavigate();

  return (
    <div className="homepage-container">
      {/* Top Navbar */}
      <nav className="homepage-nav">
        <div className="nav-logo">Comflex</div>
        <div className="nav-links">
          <button onClick={() => navigate('/login')} className="btn-secondary">Login</button>
          <button onClick={() => navigate('/register')} className="btn-primary">Register</button>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="hero-main-title">Comflex</div>
          <div className="hero-tagline">join your community, earn your badges</div>
          <p className="hero-subtitle">Events, groups, and achievements — all in one place.</p>
          <button className="cta-button" onClick={() => navigate('/register')}>Join Comflex Today</button>
        </div>
      </section>

      {/* Feature 1: Image Left, Text Right */}
      <section className="feature-section left-image-section">
        <div className="feature-content">
          <div className="feature-image-wrapper">
            <img src={collegeImage} alt="College Campus" className="feature-image" />
          </div>
          <div className="feature-text">
            <h2>Seamless Event Management</h2>
            <p>Experience smooth transitions and organized planning for all your community events. Track participants and schedules effectively.</p>
          </div>
        </div>
      </section>

      {/* Feature 2: Image Right, Text Left */}
      <section className="feature-section right-image-section">
        <div className="feature-content reverse">
          <div className="feature-image-wrapper medals-cluster">
            <img src={silverMedal} alt="Silver" className="medal silver-medal" />
            <img src={bronzeMedal} alt="Bronze" className="medal bronze-medal" />
            <img src={goldMedal} alt="Gold" className="medal gold-medal" />
          </div>
          <div className="feature-text">
            <h2>Showcase Your Achievements</h2>
            <p>Earn badges, showcase accomplishments, and let the global community recognize your dedication and milestones.</p>
          </div>
        </div>
      </section>

      {/* Bottom Content */}
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