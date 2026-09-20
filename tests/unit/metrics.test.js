import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const metrics = require('../../src/lib/metrics.js');

describe('metrics registry', () => {
  beforeEach(() => metrics.reset());

  it('renders counters, gauges and summaries in Prometheus format', () => {
    metrics.inc('uzanite_http_requests_total', { method: 'GET', status: '200' });
    metrics.inc('uzanite_http_requests_total', { method: 'GET', status: '200' }, 2);
    metrics.setGauge('uzanite_up', 1);
    metrics.observe('uzanite_http_request_duration_ms', 5, { method: 'GET' });

    const out = metrics.render();
    expect(out).toContain('uzanite_http_requests_total{method="GET",status="200"} 3');
    expect(out).toContain('uzanite_up 1');
    expect(out).toContain('uzanite_http_request_duration_ms_count{method="GET"} 1');
    expect(out).toContain('uzanite_http_request_duration_ms_sum{method="GET"} 5');
  });

  it('resets', () => {
    metrics.inc('x');
    metrics.reset();
    expect(metrics.render()).toBe('');
  });
});
