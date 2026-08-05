import assert from 'node:assert/strict';
import test from 'node:test';
import * as deployModule from './deploy.ts';

/**
 * Post-deploy verification collects failures; it does not decide the exit code.
 * These pin the two properties the deploy path depends on: every failure is
 * reported, and a failing probe never suppresses the one after it.
 *
 * The probes are injected because the real ones do network I/O (smoke) and
 * spawn a subprocess (edge). Importing this module at all is only safe because
 * deploy.ts guards its `main()` call on being invoked directly.
 */

// The repo has no `"type": "module"`, so tsx transpiles .ts to CJS and the
// named export arrives under `default` rather than on the namespace. Reading
// through both shapes keeps this working if that ever flips to true ESM.
const { postDeployChecks } = deployModule.default ?? deployModule;

const ENV = {
  host: 'myclash.fr',
  user: 'deploy',
  sshKeyPath: '/home/deploy/.ssh/id',
  repoPath: '/srv/myclash',
  smokeUrl: 'https://api.myclash.fr/health',
  edgeDomain: 'myclash.fr',
  supabaseAnonKey: null,
  allowStagingCert: false,
};

/** Silence the banner/probe chatter so the suite output stays readable. */
function muted(fn) {
  return async () => {
    const { log, error } = console;
    console.log = () => {};
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.log = log;
      console.error = error;
    }
  };
}

/** Probes with recorded calls, so we can assert BOTH ran. */
function probes({ smoke, edge }) {
  const calls = [];
  return {
    calls,
    smoke: async (url) => {
      calls.push(`smoke:${url}`);
      return smoke;
    },
    edge: async (env) => {
      calls.push(`edge:${env.edgeDomain}`);
      return edge;
    },
  };
}

test(
  'reports no failures when both probes pass',
  muted(async () => {
    const p = probes({ smoke: true, edge: true });
    assert.deepEqual(await postDeployChecks(ENV, p), []);
  }),
);

test(
  'reports the smoke test when it fails',
  muted(async () => {
    const p = probes({ smoke: false, edge: true });
    assert.deepEqual(await postDeployChecks(ENV, p), ['smoke test: https://api.myclash.fr/health']);
  }),
);

test(
  'reports the edge review when it fails',
  muted(async () => {
    const p = probes({ smoke: true, edge: false });
    assert.deepEqual(await postDeployChecks(ENV, p), ['edge review: myclash.fr']);
  }),
);

test(
  'reports both failures, smoke first',
  muted(async () => {
    const p = probes({ smoke: false, edge: false });
    assert.deepEqual(await postDeployChecks(ENV, p), [
      'smoke test: https://api.myclash.fr/health',
      'edge review: myclash.fr',
    ]);
  }),
);

// The regression this file exists for. A failing smoke test must NOT skip the
// edge review: the whole point of e9e65f86 was that a first failure had been
// hiding every check behind it.
test(
  'runs the edge review even when the smoke test already failed',
  muted(async () => {
    const p = probes({ smoke: false, edge: true });
    await postDeployChecks(ENV, p);
    assert.deepEqual(p.calls, ['smoke:https://api.myclash.fr/health', 'edge:myclash.fr']);
  }),
);

test(
  'defaults exist so main() can call it with no probes argument',
  muted(async () => {
    assert.equal(typeof postDeployChecks, 'function');
    // env + probes, both with defaults on the second parameter only.
    assert.equal(postDeployChecks.length, 1);
  }),
);
