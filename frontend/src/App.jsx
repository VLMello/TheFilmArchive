import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './views/Dashboard';
import Movies from './views/Movies';
import Settings from './views/Settings';

export default function App() {
  return (
    <>
      <nav>
        <span className="logo">The Film Archive</span>
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/movies">Movies</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/movies" element={<Movies />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </>
  );
}
