import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Sparkles, ArrowRight, ShieldCheck, Users, MessagesSquare,
  Award, BookOpen, CalendarDays, Lock, ChevronRight, CheckCircle2,
  Star, Flame, Trophy
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import Avatar from '../components/Avatar';
import ComflexLogo from '../components/ComflexLogo';
import ComflexBuildSection from '../components/ComflexBuildSection';
import AnimatedComflexTitle from '../components/AnimatedComflexTitle';
import ThemeToggle from '../components/ThemeToggle';
import GlowButton from '../components/GlowButton';
import LiquidGlassBackground from '../components/LiquidGlassBackground';
import LiquidGlassButton from '../components/LiquidGlassButton';
import ScrollProgressBar from '../components/ScrollProgressBar';
import goldMedal from '../assets/gold.png';
import silverMedal from '../assets/silver.png';
import bronzeMedal from '../assets/bronze.png';
import collegeImage from '../assets/college.jpeg';

export default function Homepage() {
  const { isAuthenticated, user } = useAuth();
  const [activeFeatureTab, setActiveFeatureTab] = useState(0);

  const heroContainerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.12, delayChildren: 0.1 },
    },
  };

  const heroItemVariants = {
    hidden: { opacity: 0, y: 22 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 320, damping: 24 },
    },
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] overflow-x-hidden selection:bg-[var(--color-accent)] selection:text-white">
      {/* 21st.dev Palette-anchored Scroll Progress Bar */}
      <ScrollProgressBar height={3} showGlow showLeadingBead />

      {/* 21st.dev Atmospheric Fluid Liquid Glass Ambient Background */}
      <LiquidGlassBackground />

      {/* Floating Matte Glass Top Navigation */}
      <nav className="fixed top-[calc(0.625rem+env(safe-area-inset-top,0px))] sm:top-4 inset-x-2.5 sm:inset-x-4 max-w-6xl mx-auto z-50 glass-card px-3 sm:px-5 py-2 sm:py-3 flex items-center justify-between border border-[var(--color-border)] shadow-lg">
        <Link to="/" className="flex items-center gap-2">
          <ComflexLogo variant="fullWithWordmark" size="md" animated={true} responsiveWordmark={false} />
        </Link>

        {/* Center Links */}
        <div className="hidden md:flex items-center gap-6 text-xs font-semibold text-[var(--color-text-secondary)]">
          <a href="#architecture" className="hover:text-[var(--color-text-primary)] transition-colors">Architecture</a>
          <a href="#features" className="hover:text-[var(--color-text-primary)] transition-colors">Features</a>
          <a href="#achievements" className="hover:text-[var(--color-text-primary)] transition-colors">Medals & Store</a>
          <a href="#community" className="hover:text-[var(--color-text-primary)] transition-colors">Community</a>
        </div>

        {/* Right CTA */}
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle size="sm" variant="icon" />

          {isAuthenticated ? (
            <Link to="/groups" className="btn btn-primary text-xs py-1.5 px-3 sm:py-2 sm:px-4 shadow-sm flex items-center gap-1.5 sm:gap-2">
              <Avatar src={user?.avatarUrl} name={user?.displayName} className="w-5 h-5 rounded-full" />
              <span className="hidden sm:inline">Go to App</span>
              <span className="sm:hidden">App</span>
            </Link>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <Link to="/login" className="btn btn-secondary text-xs py-1.5 px-2.5 sm:py-2 sm:px-3.5">
                Login
              </Link>
              <Link to="/register" className="btn btn-primary text-xs py-1.5 px-3 sm:py-2 sm:px-4 shadow-sm">
                Register
              </Link>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 pt-[calc(7rem+env(safe-area-inset-top,0px))] sm:pt-36 pb-16 sm:pb-20 px-3 sm:px-6 lg:px-8 max-w-6xl mx-auto flex flex-col items-center text-center">
        <motion.div
          variants={heroContainerVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center w-full max-w-5xl"
        >
          {/* Announcement Pill Badge */}
          <motion.div variants={heroItemVariants} className="mb-4 inline-flex">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--palette-bisque)]/60 dark:bg-[var(--palette-plum)]/30 border border-[var(--palette-teal)]/30 backdrop-blur-md shadow-sm hover:border-[var(--palette-teal)] transition-colors">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--palette-teal)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--palette-teal)]" />
              </span>
              <span className="text-xs font-semibold text-[var(--color-text-secondary)] tracking-wide">
                Next-Gen Campus Collaboration Hub
              </span>
              <ArrowRight size={13} className="text-[var(--palette-teal)]" />
            </div>
          </motion.div>

          {/* Animated Handwriting Wipe & Interactive Scroll Title from Legacy */}
          <motion.div variants={heroItemVariants} className="w-full">
            <AnimatedComflexTitle />
          </motion.div>

          {/* Subtitle */}
          <motion.p
            variants={heroItemVariants}
            className="mt-4 text-base sm:text-lg text-[var(--color-text-secondary)] leading-relaxed max-w-2xl"
          >
            The dedicated platform for modern college innovators. Automatic cohort discovery, real-time channels, anonymous safe-spaces, verified achievements, and student notes AI.
          </motion.p>

          {/* 21st.dev Liquid Glass Tactile CTA Buttons */}
          <motion.div variants={heroItemVariants} className="mt-8 flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-4 w-full max-w-md mx-auto">
            <LiquidGlassButton
              to={isAuthenticated ? '/groups' : '/register'}
              variant="primary"
              size="lg"
              icon={Sparkles}
              className="w-full sm:w-auto justify-center text-center"
            >
              {isAuthenticated ? 'Open Dashboard' : 'Get Started with College Email'}
            </LiquidGlassButton>
            <LiquidGlassButton
              href="#architecture"
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto justify-center text-center"
            >
              Explore Platform
            </LiquidGlassButton>
          </motion.div>
        </motion.div>

        {/* Hero Interactive Showcase Card (Liquid Glass with spring entry) */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.4 }}
          className="mt-14 w-full max-w-4xl"
        >
          <div className="liquid-glass-card p-4 sm:p-6 border border-[var(--color-border)] shadow-2xl relative overflow-hidden text-left">
            {/* Window header */}
            <div className="flex items-center justify-between pb-4 border-b border-[var(--color-border)]/70 mb-5">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[var(--color-danger)]/80" />
                <span className="w-3 h-3 rounded-full bg-[var(--color-warning)]/80" />
                <span className="w-3 h-3 rounded-full bg-[var(--color-success)]/80" />
                <span className="text-xs font-semibold text-[var(--color-text-muted)] ml-2">
                  #batch-2026-cs • Comflex Live Channel
                </span>
              </div>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                Active Session
              </span>
            </div>

            {/* Chat Mockup inside Glass */}
            <div className="space-y-3.5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[var(--palette-teal)] to-[var(--palette-plum)] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  AK
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-[var(--color-text-primary)]">Aryan Kumar</span>
                    <span className="text-[10px] font-semibold px-2 py-0.2 rounded-full ring-badge-2">Ring 2 • Lead</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">12:34 PM</span>
                  </div>
                  <div className="glass-card p-3 rounded-2xl rounded-tl-sm text-xs leading-relaxed text-[var(--color-text-primary)] border border-[var(--color-border)] max-w-xl">
                    Has everyone registered for the Inter-College Hackathon? Team registrations close at midnight! 🚀
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 justify-end">
                <div className="flex-1 flex flex-col items-end">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-[var(--color-text-muted)]">12:35 PM</span>
                    <span className="text-xs font-bold text-[var(--color-text-primary)]">You</span>
                  </div>
                  <div className="p-3 rounded-2xl rounded-tr-sm text-xs leading-relaxed text-white bg-gradient-to-br from-[var(--color-accent)] to-[#528976] shadow-sm max-w-xl">
                    Just submitted our team project repo! We earned the verified Gold Builder badge too 🏆
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--palette-bisque)]/70 dark:bg-[var(--palette-plum)]/40 border border-[var(--color-border)] flex items-center gap-1">
                      🔥 <span>8</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--palette-bisque)]/70 dark:bg-[var(--palette-plum)]/40 border border-[var(--color-border)] flex items-center gap-1">
                      👏 <span>14</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Scroll-Driven Self-Building Vector Logo Section */}
      <ComflexBuildSection />

      {/* Features Bento Grid Section */}
      <section id="features" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--palette-teal)]">
            Architected for Campus Life
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold font-display mt-2 text-[var(--color-text-primary)]">
            Everything your college needs, engineered into one hub.
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-3 leading-relaxed">
            Replace fragmented WhatsApp groups, untracked Google drives, and chaotic spreadsheets with structured, ring-governed communication.
          </p>
        </div>

        {/* Bento Grid layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Bento Card 1: Cohort Auto-Tagging */}
          <div className="glass-card p-6 border border-[var(--color-border)] hover-lift flex flex-col justify-between md:col-span-2">
            <div>
              <div className="w-10 h-10 rounded-2xl bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] flex items-center justify-center mb-4">
                <Users size={20} />
              </div>
              <h3 className="text-lg font-bold font-display text-[var(--color-text-primary)] mb-1.5">
                Automated Academic Cohort Tagging
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed max-w-lg">
                Log in with your university Google account and get instantly assigned to your official graduation year and academic branch without manual admin overhead.
              </p>
            </div>
            <div className="mt-6 p-4 rounded-2xl bg-[var(--color-bg-matte)] border border-[var(--color-border)] flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-[var(--color-text-muted)]">Input: student2026@university.edu</span>
              <ArrowRight size={14} className="text-[var(--color-accent)]" />
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--palette-teal)]/20 text-[var(--palette-teal)]">
                Batch of 2026
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[var(--palette-rose)]/25 text-[var(--palette-plum)]">
                Computer Science
              </span>
            </div>
          </div>

          {/* Bento Card 2: Anonymous Safe Spaces */}
          <div className="glass-card p-6 border border-[var(--color-border)] hover-lift flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-2xl bg-[var(--palette-rose)]/20 text-[var(--palette-plum)] flex items-center justify-center mb-4">
                <Lock size={20} />
              </div>
              <h3 className="text-lg font-bold font-display text-[var(--color-text-primary)] mb-1.5">
                Zero-Knowledge Anonymous Channels
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                Discuss placement advice, ask delicate campus questions, and share honest feedback with cryptographically isolated alias keys.
              </p>
            </div>
            <div className="mt-6 flex items-center gap-2 text-xs font-semibold text-[var(--color-text-muted)]">
              <ShieldCheck size={16} className="text-[var(--color-accent)]" />
              <span>Key-backed local secrets</span>
            </div>
          </div>

          {/* Bento Card 3: Events & Leaderboards */}
          <div className="glass-card p-6 border border-[var(--color-border)] hover-lift flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-2xl bg-[var(--color-warning)]/15 text-[var(--color-warning)] flex items-center justify-center mb-4">
                <Trophy size={20} />
              </div>
              <h3 className="text-lg font-bold font-display text-[var(--color-text-primary)] mb-1.5">
                Campus Hackathons & Brackets
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                Build teams, submit milestones, track real-time live leaderboards, and win verified digital medals directly to your profile.
              </p>
            </div>
            <div className="mt-6 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
                Live Timers
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[var(--palette-teal)]/15 text-[var(--palette-teal)]">
                Auto-Grading
              </span>
            </div>
          </div>

          {/* Bento Card 4: Academic Resources */}
          <div className="glass-card p-6 border border-[var(--color-border)] hover-lift flex flex-col justify-between md:col-span-2">
            <div>
              <div className="w-10 h-10 rounded-2xl bg-[var(--palette-sage)]/30 text-[var(--palette-teal)] flex items-center justify-center mb-4">
                <BookOpen size={20} />
              </div>
              <h3 className="text-lg font-bold font-display text-[var(--color-text-primary)] mb-1.5">
                High-Speed Academic Resource Sharing
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed max-w-lg">
                Subject-categorized lecture notes, past exam papers, and syllabus cheatsheets with fast streaming uploads and cancellation support.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-secondary)]">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-[var(--color-success)]" />
                <span>Up to 75MB files</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-[var(--color-success)]" />
                <span>PDF, MD, CSV, Code</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-[var(--color-success)]" />
                <span>Instant Download</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Medals & Achievements Showcase Section (Spring Motion) */}
      <section id="achievements" className="relative z-10 py-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="glass-card p-8 sm:p-12 border border-[var(--color-border)] relative overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--palette-teal)]">
                Verifiable Reputation
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold font-display mt-2 text-[var(--color-text-primary)]">
                Flex verified badges earned through campus merit.
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)] mt-4 leading-relaxed">
                Win hackathons, help peers in study groups, or collect rare community badges. Showcase them directly on your avatar and direct messaging threads.
              </p>

              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-3 text-xs font-semibold text-[var(--color-text-primary)]">
                  <div className="w-6 h-6 rounded-lg bg-[var(--palette-teal)]/15 text-[var(--palette-teal)] flex items-center justify-center">
                    <Star size={14} />
                  </div>
                  <span>Display up to 3 showcase badges on your user profile</span>
                </div>
                <div className="flex items-center gap-3 text-xs font-semibold text-[var(--color-text-primary)]">
                  <div className="w-6 h-6 rounded-lg bg-[var(--palette-rose)]/20 text-[var(--palette-plum)] flex items-center justify-center">
                    <Flame size={14} />
                  </div>
                  <span>Earn Comflex credits from campus events and trade in Store</span>
                </div>
              </div>

              <div className="mt-8">
                <Link to={isAuthenticated ? '/store' : '/register'} className="btn btn-primary px-6 py-2.5 text-xs">
                  Browse Badge Catalog
                </Link>
              </div>
            </div>

            {/* Medal Floating Clusters with Framer Motion */}
            <div className="flex justify-center items-center gap-4 relative py-6">
              <motion.div
                whileHover={{ scale: 1.1, rotate: -5 }}
                transition={{ type: 'spring', stiffness: 350, damping: 15 }}
                className="w-24 sm:w-28 flex flex-col items-center cursor-pointer"
              >
                <img src={silverMedal} alt="Silver Medal" className="w-full drop-shadow-xl" />
                <span className="text-[11px] font-bold mt-2 text-[var(--color-text-secondary)]">Silver Medal</span>
              </motion.div>

              <motion.div
                whileHover={{ scale: 1.15, rotate: 0, y: -8 }}
                transition={{ type: 'spring', stiffness: 350, damping: 15 }}
                className="w-32 sm:w-36 flex flex-col items-center cursor-pointer -mt-6"
              >
                <img src={goldMedal} alt="Gold Medal" className="w-full drop-shadow-2xl" />
                <span className="text-xs font-bold mt-2 text-[var(--color-accent)]">Gold Medal</span>
              </motion.div>

              <motion.div
                whileHover={{ scale: 1.1, rotate: 5 }}
                transition={{ type: 'spring', stiffness: 350, damping: 15 }}
                className="w-24 sm:w-28 flex flex-col items-center cursor-pointer"
              >
                <img src={bronzeMedal} alt="Bronze Medal" className="w-full drop-shadow-xl" />
                <span className="text-[11px] font-bold mt-2 text-[var(--color-text-secondary)]">Bronze Medal</span>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Campus Life Preview Section */}
      <section id="community" className="relative z-10 py-16 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="rounded-3xl overflow-hidden border border-[var(--color-border)] shadow-xl aspect-video relative group">
            <img
              src={collegeImage}
              alt="College Campus"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-6">
              <p className="text-white text-sm font-semibold">
                Campus Community • Powered by Comflex
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--palette-teal)]">
              Built by Students, for Students
            </span>
            <h2 className="text-3xl font-bold font-display text-[var(--color-text-primary)]">
              Ready to elevate your campus experience?
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
              Join hundreds of peers already coordinating projects, preparing for tech interviews, sharing notes, and organizing campus events.
            </p>
            <div className="pt-3">
              <Link to={isAuthenticated ? '/groups' : '/register'} className="btn btn-primary px-7 py-3 text-sm">
                {isAuthenticated ? 'Go to Groups' : 'Create Free Student Account'}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--color-border)] py-10 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[var(--color-text-muted)]">
        <div className="flex items-center gap-3">
          <ComflexLogo variant="fullWithWordmark" size="sm" showSubtitle={false} />
          <span className="text-[11px] text-[var(--color-text-muted)]">© {new Date().getFullYear()} All rights reserved.</span>
        </div>

        <div className="flex items-center gap-6">
          <a href="#features" className="hover:text-[var(--color-text-primary)]">Features</a>
          <a href="#achievements" className="hover:text-[var(--color-text-primary)]">Medals</a>
          <Link to="/login" className="hover:text-[var(--color-text-primary)]">Login</Link>
          <Link to="/register" className="hover:text-[var(--color-text-primary)]">Register</Link>
        </div>
      </footer>
    </div>
  );
}
