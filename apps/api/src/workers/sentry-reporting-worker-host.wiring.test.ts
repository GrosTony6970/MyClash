import { OnWorkerEvent } from '@nestjs/bullmq';
import { MetadataScanner } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';

/**
 * A failed job reaches Sentry only because BullMQ's Nest explorer finds `onJobFailed`, which every
 * worker inherits from SentryReportingWorkerHost. `sentry-reporting-worker-host.test.ts` calls the
 * hook by hand; this test asks the question the explorer asks, with the explorer's own call
 * (`scanFromPrototype` over the instance, reading each method's worker-event metadata), so a Nest
 * or @nestjs/bullmq update that stops finding an inherited hook turns it red.
 *
 * Root imports only: @nestjs/bullmq 12 exports nothing else, so the metadata key is read from a
 * method the public decorator has just marked.
 */

class ProbeWorker extends SentryReportingWorkerHost {
  async process(): Promise<void> {
    // The inherited failure hook is what is under test.
  }
}

function workerEventKey(): string | symbol {
  class KeyProbe {
    probe(): void {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(KeyProbe.prototype, 'probe');
  if (!descriptor) throw new Error('KeyProbe.probe has no descriptor');
  OnWorkerEvent('completed')(KeyProbe.prototype, 'probe', descriptor);
  const [key] = Reflect.getMetadataKeys(descriptor.value as object) as (string | symbol)[];
  if (key === undefined) throw new Error('OnWorkerEvent stored no metadata');
  return key;
}

describe('SentryReportingWorkerHost wiring', () => {
  it('the explorer finds the inherited failure hook on a worker', () => {
    const key = workerEventKey();
    const worker = new ProbeWorker() as unknown as Record<string, unknown>;
    const found: Record<string, unknown> = {};
    new MetadataScanner().scanFromPrototype(worker, Object.getPrototypeOf(worker), (name) => {
      const meta: unknown = Reflect.getMetadata(key, worker[name] as object);
      if (meta) found[name] = meta;
    });
    expect(found).toEqual({ onJobFailed: { eventName: 'failed' } });
  });
});
