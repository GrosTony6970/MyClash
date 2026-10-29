import { afterAll, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/nestjs';
import type { NodeOptions } from '@sentry/nestjs';
import type { SentryDataCollection } from '@myclash/types/sentry-data-collection';
import { initApiSentry } from './sentry';

/**
 * What the SDK really resolved from our init — no mock. The mocked sibling
 * (sentry.test.ts) checks the call shape; this one proves the setting reaches
 * the client. Every Sentry default is "collect", so dropping the setting from
 * initApiSentry turns the literal below red.
 */

// Exact keys both ways: a key Sentry adds, or one we invent, fails to compile.
// A `never`-typed assignment would pin nothing; a constrained parameter does.
type AssertNever<T extends never> = T;
type SdkKeys = keyof Required<NonNullable<NodeOptions['dataCollection']>>;
export type SentryKeysPin = [
  AssertNever<Exclude<SdkKeys, keyof SentryDataCollection>>,
  AssertNever<Exclude<keyof SentryDataCollection, SdkKeys>>,
];

describe('API Sentry, resolved by the real SDK', () => {
  afterAll(async () => {
    await Sentry.close(0);
    delete process.env['SENTRY_TRACE_LIFECYCLE'];
  });

  it('holds our data-collection setting and streams spans whatever the env says', () => {
    // `static` would switch the span hook off; our option must win.
    process.env['SENTRY_TRACE_LIFECYCLE'] = 'static';
    initApiSentry({ SENTRY_DSN_API: 'http://k@127.0.0.1:9/1', DOMAIN: 'example.test' });

    const client = Sentry.getClient();
    expect(client).toBeDefined();
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
