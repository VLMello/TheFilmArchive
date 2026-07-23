import { formatBytes } from '../format';

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
