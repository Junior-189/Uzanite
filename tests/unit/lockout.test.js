import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  checkLoginLockout,
  recordFailedLogin,
  clearLoginAttempts,
} = require('../../src/middleware/auth.js');

describe('login lockout (shared-state backed)', () => {
  it('escalates after repeated failures and clears on success', async () => {
    const email = 'lockout-test@example.com';
    await clearLoginAttempts(email);

    let lock = await checkLoginLockout(email);
    expect(lock.locked).toBe(false);

    for (let i = 0; i < 5; i++) await recordFailedLogin(email);

    lock = await checkLoginLockout(email);
    expect(lock.locked).toBe(true);
    expect(lock.attempts).toBeGreaterThanOrEqual(5);

    await clearLoginAttempts(email);
    lock = await checkLoginLockout(email);
    expect(lock.locked).toBe(false);
  });
});
