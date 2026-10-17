import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { staffRoutePrefix } from './nav';
import { servedCommit } from './served-commit';
import { registrationScript, workerUrl } from './worker-registration';

afterEach(() => vi.unstubAllEnvs());

const APP = join(__dirname, '..', '..');
const read = (...path: string[]) => readFileSync(join(APP, ...path), 'utf8');

describe('servedCommit', () => {
  it('is the commit of the container, in 8 characters', () => {
    vi.stubEnv('GIT_COMMIT', '14f7b056c1e80dd4812aabf3b498fe0a640bd9c2');
    expect(servedCommit()).toBe('14f7b056');
  });

  it('is "unknown" with no commit, or one with nothing of a commit in it', () => {
    vi.stubEnv('GIT_COMMIT', '');
    expect(servedCommit()).toBe('unknown');
    vi.stubEnv('GIT_COMMIT', '"><');
    expect(servedCommit()).toBe('unknown');
  });

  // It goes into an address and into an inline script.
  it('keeps only what a commit is made of', () => {
    vi.stubEnv('GIT_COMMIT', 'ab"c</script>');
    expect(servedCommit()).toBe('abcscrip');
  });
});

describe('the registration of the service worker', () => {
  // The deploy script stamped the cache's name into the worker's file with a
  // `sed` that had stopped matching: the cache was never renewed.
  it('registers the worker under its version, so a deploy is a new worker', () => {
    expect(workerUrl('14f7b056')).toBe('/sw.js?v=14f7b056');
    expect(registrationScript('14f7b056')).toContain(
      'navigator.serviceWorker.register(mount + "/sw.js?v=14f7b056")',
    );
    expect(registrationScript('5bc3195f')).toContain('register(mount + "/sw.js?v=5bc3195f")');
  });

  // O2a: on the organiser site `/sw.js` is the organiser app's, with no worker.
  it('registers the worker under the mount of the page, by the rule of staffRoutePrefix', () => {
    const registered = (pathname: string) => {
      let address = '';
      let onLoad = () => undefined as void;
      const register = (url: string) => {
        address = url;
        return { then: () => ({ catch: () => undefined }) };
      };
      runInNewContext(registrationScript('14f7b056'), {
        location: { pathname },
        navigator: { serviceWorker: { register } },
        window: { addEventListener: (_: string, run: () => void) => (onLoad = run) },
      });
      onLoad();
      return address;
    };

    for (const pathname of ['/', '/matches/bout-1', '/staff', '/staff/', '/staff/matches/bout-1']) {
      expect(registered(pathname), pathname).toBe(
        staffRoutePrefix(pathname) + workerUrl('14f7b056'),
      );
    }
    expect(registered('/staff/matches/bout-1')).toBe('/staff/sw.js?v=14f7b056');
    expect(registered('/matches/bout-1')).toBe('/sw.js?v=14f7b056');
  });

  it('is written by the root layout’s component with the commit served, on the server', () => {
    const component = read('src', 'components', 'ServiceWorkerRegistration.tsx');
    expect(component).toContain('__html: registrationScript(servedCommit())');
    expect(component).not.toContain("'use client'");
    const layout = read('app', 'layout.tsx');
    expect(layout).toContain('<ServiceWorkerRegistration />');
    expect(layout).not.toMatch(/^'use client'/);
  });

  it('has one reader of the commit, shared with GET /api/version', () => {
    const route = read('app', 'api', 'version', 'route.ts');
    expect(route).toContain('commit: servedCommit(),');
    expect(route.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('GIT_COMMIT');
  });

  // Nothing stamps a file any more: a second owner of the version would rot again.
  it('is the only owner of the worker’s version: the deploy scripts stamp nothing', () => {
    const infra = join(APP, '..', '..', 'infra', 'scripts');
    for (const name of ['deploy.sh', 'redeploy.sh']) {
      expect(readFileSync(join(infra, name), 'utf8'), name).not.toContain('sed -i "s/const CACHE');
    }
    expect(read('public', 'sw.js')).not.toContain('__CACHE_VERSION__');
  });
});
