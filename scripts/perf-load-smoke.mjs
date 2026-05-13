#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const defaults = {
  baseUrl: process.env['PERF_BASE_URL'] ?? 'http://localhost:3000',
  path: process.env['PERF_PATH'] ?? '/health',
  duration: Number(process.env['PERF_DURATION_SECONDS'] ?? 60),
  concurrency: Number(process.env['PERF_CONCURRENCY'] ?? 10),
  maxErrorRate: Number(process.env['PERF_MAX_ERROR_RATE'] ?? 0.01),
  maxP95Ms: Number(process.env['PERF_MAX_P95_MS'] ?? 500),
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const config = {
  baseUrl: argValue('--base-url') ?? defaults.baseUrl,
  path: argValue('--path') ?? defaults.path,
  duration: Number(argValue('--duration') ?? defaults.duration),
  concurrency: Number(argValue('--concurrency') ?? defaults.concurrency),
  maxErrorRate: Number(argValue('--max-error-rate') ?? defaults.maxErrorRate),
  maxP95Ms: Number(argValue('--max-p95-ms') ?? defaults.maxP95Ms),
};

if (!Number.isFinite(config.duration) || config.duration <= 0) {
  throw new Error('--duration must be a positive number of seconds.');
}
if (!Number.isFinite(config.concurrency) || config.concurrency <= 0) {
  throw new Error('--concurrency must be a positive number.');
}

const target = new URL(config.path, config.baseUrl).toString();
const deadline = Date.now() + config.duration * 1000;
const latencies = [];
let successes = 0;
let failures = 0;

async function worker() {
  while (Date.now() < deadline) {
    const started = performance.now();
    try {
      const response = await fetch(target, {
        headers: { 'user-agent': 'myclash-perf-load-smoke/1.0' },
      });
      await response.arrayBuffer();
      const elapsed = performance.now() - started;
      latencies.push(elapsed);
      if (response.ok) successes += 1;
      else failures += 1;
    } catch {
      failures += 1;
    }
  }
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

const total = successes + failures;
const errorRate = total === 0 ? 1 : failures / total;
const p50 = percentile(latencies, 50);
const p95 = percentile(latencies, 95);

console.log(`Load smoke target: ${target}`);
console.log(`Duration: ${config.duration}s, concurrency: ${config.concurrency}`);
console.log(`Requests: ${total}, success: ${successes}, failed: ${failures}`);
console.log(`Latency p50: ${p50.toFixed(1)}ms, p95: ${p95.toFixed(1)}ms`);
console.log(`Error rate: ${(errorRate * 100).toFixed(2)}%`);

if (errorRate > config.maxErrorRate) {
  console.error(
    `Error rate ${(errorRate * 100).toFixed(2)}% exceeds ${(config.maxErrorRate * 100).toFixed(2)}%.`,
  );
  process.exitCode = 1;
}
if (p95 > config.maxP95Ms) {
  console.error(`p95 ${p95.toFixed(1)}ms exceeds ${config.maxP95Ms}ms.`);
  process.exitCode = 1;
}
