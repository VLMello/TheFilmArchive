import React from 'react';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../components/ErrorBoundary';

function Bomb() {
  throw new Error('boom');
}

test('renders children normally when there is no error', () => {
  render(
    <ErrorBoundary>
      <p>All good</p>
    </ErrorBoundary>
  );
  expect(screen.getByText('All good')).toBeInTheDocument();
});

test('catches a thrown render error and shows the fallback UI', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <ErrorBoundary>
      <Bomb />
    </ErrorBoundary>
  );
  expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  spy.mockRestore();
});
