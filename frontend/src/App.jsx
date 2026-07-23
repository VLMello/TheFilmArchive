import React, { useState } from 'react';
import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import Movies from './views/Movies';
import Settings from './views/Settings';

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <nav>
        <span className="logo">The Film Archive</span>
        <button
          className="hamburger"
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(o => !o)}
        >
          ☰
        </button>
        <div className={`nav-links${menuOpen ? ' open' : ''}`}>
          <NavLink to="/movies" onClick={() => setMenuOpen(false)}>Movies</NavLink>
          <NavLink to="/settings" onClick={() => setMenuOpen(false)}>Settings</NavLink>
        </div>
      </nav>
      <Routes>
        <Route path="/" element={<Navigate to="/movies" replace />} />
        <Route path="/movies" element={<Movies />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </>
  );
}
