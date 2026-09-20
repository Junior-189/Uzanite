// Client test environment.
//
// jsdom provides sessionStorage/localStorage, but the app must also survive
// them being unavailable (private mode, blocked site data, embedded webviews),
// so tests exercise that path explicitly rather than assuming they exist.
import { afterEach, vi } from 'vitest';

afterEach(() => {
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
