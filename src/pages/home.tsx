import React from 'react';
import { motion } from 'framer-motion';

/**
 * Animate the background gradient and overlay patterns using CSS keyframes and
 * inline <style> tags. 
 * The gradient will move gently, and the dot overlays will slowly drift in different directions,
 * creating a dynamic "living" background effect.
 */
const AnimatedBackground = () => (
  <>
    {/* Animate gradient */}
    <div
      className="absolute inset-0 w-full h-full z-0"
      style={{
        background: 'linear-gradient(135deg, #091930 0%, #0d1f42 60%, #091930 100%)',
        animation: 'move-bg-gradient 16s ease-in-out infinite alternate',
        willChange: 'background-position, filter',
        backgroundSize: '200% 200%',
        filter: 'brightness(1.01) blur(0.5px)'
      }}
    />
    {/* Animated overlay: dots scroll diagonally */}
    <div
      className="pointer-events-none absolute inset-0 z-10 opacity-30"
      style={{
        background:
          'radial-gradient(circle, transparent 65%, #ffffff11 69%, #ffffff13 72%, transparent 79%), radial-gradient(circle, transparent 86%, #5adcf713 89%, transparent 99%)',
        backgroundRepeat: 'repeat',
        backgroundSize: '60px 60px, 140px 140px',
        animation: 'move-dot-overlay 19s linear infinite alternate'
      }}
    />
    {/* Secondary overlay for parallax effect (move at different speed) */}
    <div
      className="pointer-events-none absolute inset-0 z-10 opacity-15"
      style={{
        background:
          'radial-gradient(circle at 30% 10%, #70f2ff13 0%, transparent 60%), radial-gradient(circle at 80% 90%, #3a78c713 0%, transparent 60%)',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '120% 120%',
        animation: 'move-dot-overlay-alt 32s linear infinite alternate'
      }}
    />
    {/* CSS keyframes for background and overlay movement */}
    <style>{`
      @keyframes move-bg-gradient {
        0% {
          background-position: 35% 40%;
        }
        100% {
          background-position: 65% 60%;
        }
      }
      @keyframes move-dot-overlay {
        0% {
          background-position: 0px 0px, 0px 0px;
        }
        100% {
          background-position: 60px 100px, 100px 110px;
        }
      }
      @keyframes move-dot-overlay-alt {
        0% {
          background-position: 0% 0%, 100% 100%;
        }
        100% {
          background-position: 15% 12%, 85% 87%;
        }
      }
    `}</style>
  </>
);

const HomePage = () => {
  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden">
      <AnimatedBackground />
      {/* Centered content */}
      <motion.div
        className="relative z-20 flex flex-col items-center justify-center px-4 py-10 w-full max-w-3xl text-center"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
      >
        {/* Rotated title box with rotated text inside, bigger and longer box, but same size title */}
        <motion.div
          className="mb-12"
          initial={{ opacity: 0, scale: 0.93, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.95, delay: 0.16 }}
        >
          <div className="inline-block border-4 border-dashed border-blue-500 px-40 py-9 rounded-2xl shadow-2xl bg-[#102040ee] backdrop-blur-sm transform rotate-[-8deg] min-w-[480px]">
            <h1 className="text-6xl sm:text-7xl font-extrabold text-white tracking-tight drop-shadow-xl [text-shadow:0px_2px_16px_rgba(25,120,255,0.13)] transform rotate-[8deg]">
              Sparky
            </h1>
          </div>
        </motion.div>

        {/* Subheading */}
        <motion.p
          className="mb-9 text-lg sm:text-xl text-blue-200/80 font-medium"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.41 }}
        >
          Your personal AI assistant for chat, search &amp; coding.
        </motion.p>

        {/* Features list (horizontal) */}
        <motion.div
          className="mx-auto flex flex-col sm:flex-row items-center justify-center gap-6 w-full max-w-2xl"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.7 }}
        >
          <ul className="flex flex-row items-center gap-6 w-full justify-center mb-6 sm:mb-0">
            <li className="flex items-center gap-2 text-lg text-gray-100 bg-[#0d233c]/80 px-5 py-3 rounded-lg shadow-sm border border-blue-600/10 min-w-[180px] justify-center">
              <span role="img" aria-label="chat">
                💬
              </span>
              <span>AI Chat Application</span>
            </li>
            <li className="flex items-center gap-2 text-lg text-gray-100 bg-[#0d233c]/80 px-5 py-3 rounded-lg shadow-sm border border-blue-600/10 min-w-[200px] justify-center">
              <span role="img" aria-label="search">
                🔎
              </span>
              <span>Web Search Integration</span>
            </li>
            <li className="flex items-center gap-2 text-lg text-gray-100 bg-[#0d233c]/80 px-5 py-3 rounded-lg shadow-sm border border-blue-600/10 min-w-[210px] justify-center">
              <span role="img" aria-label="code">
                💡
              </span>
              <span>Agentic Coding Support</span>
            </li>
          </ul>
        </motion.div>
        {/* Sign Up button below features */}
        <motion.button
          className="mt-4 bg-blue-600 hover:bg-blue-500 text-white font-bold px-7 py-3 rounded-lg shadow-lg transition-colors text-lg"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.96 }}
        >
          Sign Up
        </motion.button>
      </motion.div>
    </div>
  );
};

export default HomePage;