import path from 'node:path';
import { RUNTIME_HEALTH_QUEUE_NAMES } from '@myclash/types';
import { describe, expect, it } from 'vitest';

/**
 * The health card watches the queues the worker consumes (ruling 830): its list
 * (`@myclash/types`) is compared with the `@Processor` queues the CI start check reads from the
 * API source (`scripts/check-api-boot.mjs`). A queue added without the card, or a card row for a
 * queue nobody consumes, fails here.
 *
 * A CommonJS test cannot import the `.mjs` statically (TS1479): it is loaded by `await import()`
 * beside its `.d.mts`. Its source dir is made absolute: the script's default is relative to the
 * repo root, and this test runs from apps/api.
 */
const bootCheck = () => import('../../../../../../scripts/check-api-boot.mjs');
const API_SOURCE = path.resolve(__dirname, '../../..');

describe('the queues the health card watches', () => {
  it('are exactly the queues a @Processor consumes', async () => {
    const { readSources, processorQueues } = await bootCheck();
    const { queues, unresolved } = processorQueues(readSources(API_SOURCE));
    expect(unresolved).toEqual([]);
    expect(queues.length).toBeGreaterThan(0);
    expect([...RUNTIME_HEALTH_QUEUE_NAMES].sort()).toEqual(queues);
  });
});
