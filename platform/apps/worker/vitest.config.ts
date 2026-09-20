import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@uzanite/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@uzanite/messaging': path.resolve(__dirname, '../../packages/messaging/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globals: false,
    testTimeout: 30000,
    // Integration specs share ONE PostgreSQL database and reset it with
    // TRUNCATE in beforeEach. `fileParallelism: false` alone proved
    // insufficient: files still overlapped enough to truncate each other's
    // fixtures mid-test, producing intermittent foreign-key violations and
    // TRUNCATE deadlocks that looked like application bugs.
    //
    // `pool: 'forks'` + `singleFork` guarantees ONE process running files
    // strictly one at a time. Slower, but a flaky suite is worse than a slow
    // one: it trains people to re-run instead of investigate.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
  },
});
