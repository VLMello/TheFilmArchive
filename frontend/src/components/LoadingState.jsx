import React from 'react';

export default function LoadingState({ label = 'Loading…' }) {
  return (
    <p style={{ color: '#666', textAlign: 'center', padding: 32 }}>{label}</p>
  );
}
