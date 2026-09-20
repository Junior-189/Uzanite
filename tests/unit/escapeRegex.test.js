import { describe, it, expect } from 'vitest';
import { escapeRegex, MAX_SEARCH_LENGTH } from '../../src/utils/escapeRegex.js';

describe('escapeRegex', () => {
  it('escapes regex metacharacters so input is matched literally', () => {
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
    expect(escapeRegex('(a+)+$')).toBe('\\(a\\+\\)\\+\\$');
    expect(escapeRegex('[x]|^y')).toBe('\\[x\\]\\|\\^y');
  });

  it('caps the pattern length to bound work', () => {
    expect(escapeRegex('a'.repeat(500))).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it('handles null/undefined and numbers', () => {
    expect(escapeRegex(null)).toBe('');
    expect(escapeRegex(undefined)).toBe('');
    expect(escapeRegex(42)).toBe('42');
  });
});
