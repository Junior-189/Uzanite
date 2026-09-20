import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { registerProcessor, enqueue, getStats, getDeadLetters } = require('../../src/queue/localQueue.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('localQueue fallback', () => {
  it('processes a successful job and records completion', async () => {
    let ran = 0;
    registerProcessor('test-ok', 'run', async () => { ran++; });
    enqueue('test-ok', 'run', {});
    await wait(50);
    expect(ran).toBe(1);
    expect(getStats()['test-ok'].completed).toBe(1);
  });

  it('dead-letters a job after exhausting attempts', async () => {
    registerProcessor('test-fail', 'run', async () => { throw new Error('boom'); });
    enqueue('test-fail', 'run', { __attempts: 1 });
    await wait(50);
    expect(getStats()['test-fail'].failed).toBe(1);
    const dl = getDeadLetters('test-fail');
    expect(dl.length).toBe(1);
    expect(dl[0].error).toContain('boom');
  });
});
