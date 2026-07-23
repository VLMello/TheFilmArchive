import React, { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './views/Dashboard';
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
          <NavLink to="/" end onClick={() => setMenuOpen(false)}>Dashboard</NavLink>
          <NavLink to="/movies" onClick={() => setMenuOpen(false)}>Movies</NavLink>
          <NavLink to="/settings" onClick={() => setMenuOpen(false)}>Settings</NavLink>
        </div>
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/movies" element={<Movies />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </>
  );
}
