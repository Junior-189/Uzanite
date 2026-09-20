// Tiny in-process metrics registry (Prometheus text format). Counters,
// gauges, and summaries are kept per process; expose them at /metrics.
const counters = new Map();
const gauges = new Map();
const summaries = new Map();

function labelKey(name, labels) {
  const parts = Object.entries(labels || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

function inc(name, labels, by = 1) {
  const k = labelKey(name, labels);
  counters.set(k, (counters.get(k) || 0) + by);
}

function setGauge(name, value, labels) {
  gauges.set(labelKey(name, labels), value);
}

function observe(name, value, labels) {
  const k = labelKey(name, labels);
  const s = summaries.get(k) || { count: 0, sum: 0 };
  s.count += 1;
  s.sum += value;
  summaries.set(k, s);
}

function withSuffix(k, suffix) {
  const i = k.indexOf('{');
  return i === -1 ? `${k}_${suffix}` : `${k.slice(0, i)}_${suffix}${k.slice(i)}`;
}

function render() {
  const lines = [];
  for (const [k, v] of counters) lines.push(`${k} ${v}`);
  for (const [k, v] of gauges) lines.push(`${k} ${v}`);
  for (const [k, s] of summaries) {
    lines.push(`${withSuffix(k, 'count')} ${s.count}`);
    lines.push(`${withSuffix(k, 'sum')} ${s.sum}`);
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}

function reset() {
  counters.clear();
  gauges.clear();
  summaries.clear();
}

module.exports = { inc, setGauge, observe, render, reset };
