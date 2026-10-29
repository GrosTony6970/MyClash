// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import type { NodeOptions } from '@sentry/nextjs';
import type { SentryDataCollection } from '@myclash/types/sentry-data-collection';

/**
 * The Next server init, resolved by the real SDK — no mock. Every Sentry
 * default is "collect", so dropping the setting from sentry.server.config.ts
 * turns the literal below red. The API holds the same test for its own init
 * (apps/api/src/common/observability/sentry.resolved.test.ts); the two resolve
 * different @sentry/core copies, so each pins the keys against its own.
 */

type AssertNever<T extends never> = T;
type SdkKeys = keyof Required<NonNullable<NodeOptions['dataCollection']>>;
export type SentryKeysPin = [
  AssertNever<Exclude<SdkKeys, keyof SentryDataCollection>>,
  AssertNever<Exclude<keyof SentryDataCollection, SdkKeys>>,
];

describe('the web-staff Next server Sentry init, resolved by the real SDK', () => {
  afterAll(async () => {
    await Sentry.close(0);
    delete process.env['SENTRY_TRACE_LIFECYCLE'];
    delete process.env['NEXT_PUBLIC_SENTRY_DSN_SCORING'];
  });

  it('is the server SDK, holds the server setting, and streams spans whatever the env says', async () => {
    process.env['NEXT_PUBLIC_SENTRY_DSN_SCORING'] = 'http://k@127.0.0.1:9/1';
    process.env['SENTRY_TRACE_LIFECYCLE'] = 'static';
    await import('../sentry.server.config');

    const client = Sentry.getClient();
    const packages = client?.getOptions()._metadata?.sdk?.packages?.map((p) => p.name) ?? [];
    expect(packages).toContain('npm:@sentry/node');
    expect(client?.getDataCollectionOptions()).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: {
          allow: ['host', 'user-agent', 'content-type', 'content-length', 'x-request-id'],
        },
        response: { deny: ['location'] },
      },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 5,
    });
    expect(client?.getOptions().traceLifecycle).toBe('stream');
  });
});
