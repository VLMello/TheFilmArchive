import { formatBytes, formatRuntime } from '../format';

test('formats bytes into human-readable units', () => {
  expect(formatBytes(0)).toBe('0 MB');
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(10_000_000_000)).toBe('9.3 GB');
  expect(formatBytes(20_000_000_000)).toBe('18.6 GB');
});

test('returns null for missing values', () => {
  expect(formatBytes(null)).toBeNull();
  expect(formatBytes(undefined)).toBeNull();
});

test('formats runtime minutes into hours and minutes', () => {
  expect(formatRuntime(175)).toBe('2h 55m');
  expect(formatRuntime(45)).toBe('45m');
  expect(formatRuntime(60)).toBe('1h 0m');
});

test('returns null for missing or invalid runtime', () => {
  expect(formatRuntime(null)).toBeNull();
  expect(formatRuntime(0)).toBeNull();
});
