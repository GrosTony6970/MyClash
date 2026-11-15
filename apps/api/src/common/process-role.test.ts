import { describe, expect, it } from 'vitest';
import { processRole } from './process-role';

describe('processRole', () => {
  it('is the API with no flag: the Dockerfile command and the api service', () => {
    expect(processRole(['node', 'dist/main.js'])).toBe('api');
  });

  it('is the worker with --worker: the worker service', () => {
    expect(processRole(['node', 'dist/main.js', '--worker'])).toBe('worker');
  });
});
