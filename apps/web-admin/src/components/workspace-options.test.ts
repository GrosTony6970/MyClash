import { describe, expect, it } from 'vitest';
import type { MeSession } from '@myclash/api-client';
import { resolveWorkspaceOptions } from './workspace-options';

/**
 * A claimed `/me` body carrying just the admin block these tests care about.
 *
 * The org rows are whole because `MeSession` now says they are: the API's
 * `normalizeOrganizationMembership` (auth.service.ts:94) drops any membership
 * missing id, slug, name or role, so a partial row is not a payload this module
 * can receive.
 */
function me(admin: MeSession['admin']): MeSession {
  return { type: 'claimed', admin };
}

function org(slug: string, name: string) {
  return { id: `id-${slug}`, slug, name, role: 'owner' };
}

describe('resolveWorkspaceOptions', () => {
  it('returns nothing while /me is unresolved, so the shell keeps its static label', () => {
    expect(resolveWorkspaceOptions(null, { kind: 'platform' })).toEqual({
      options: [],
      current: null,
    });
    expect(resolveWorkspaceOptions(me(undefined), { kind: 'org', slug: 'lyon-amhe' })).toEqual({
      options: [],
      current: null,
    });
  });

  it('gives an organiser-only account a single org workspace', () => {
    const { options, current } = resolveWorkspaceOptions(
      me({ platformRole: null, organizations: [org('lyon-amhe', 'Lyon AMHE')] }),
      { kind: 'org', slug: 'lyon-amhe' },
    );

    expect(options).toEqual([
      { kind: 'org', href: '/org/lyon-amhe', slug: 'lyon-amhe', name: 'Lyon AMHE' },
    ]);
    expect(current).toEqual(options[0]);
  });

  it('gives a platform-only account a single platform workspace carrying its tier', () => {
    const { options, current } = resolveWorkspaceOptions(
      me({ platformRole: 'platform_viewer', organizations: [] }),
      { kind: 'platform' },
    );

    expect(options).toEqual([{ kind: 'platform', href: '/admin', tier: 'platform_viewer' }]);
    expect(current).toEqual(options[0]);
  });

  it('lists the platform workspace first, then every org by name', () => {
    const { options, current } = resolveWorkspaceOptions(
      me({
        platformRole: 'super_admin',
        organizations: [org('paris-hema', 'Paris HEMA'), org('lyon-amhe', 'Lyon AMHE')],
      }),
      { kind: 'org', slug: 'paris-hema' },
    );

    expect(options).toEqual([
      { kind: 'platform', href: '/admin', tier: 'super_admin' },
      { kind: 'org', href: '/org/lyon-amhe', slug: 'lyon-amhe', name: 'Lyon AMHE' },
      { kind: 'org', href: '/org/paris-hema', slug: 'paris-hema', name: 'Paris HEMA' },
    ]);
    expect(current).toEqual(options[2]);
  });

  // The bug this whole module exists to kill: the console used to link to
  // `organizations.find(o => o.slug)`, and the membership query has no ORDER BY.
  it('orders orgs by name rather than by the order the payload happened to arrive in', () => {
    const { options } = resolveWorkspaceOptions(
      me({
        platformRole: null,
        organizations: [
          org('z-club', 'Zurich Fechtschule'),
          org('a-club', 'Aix Escrime'),
          org('m-club', 'Marseille AMHE'),
        ],
      }),
      { kind: 'org', slug: 'm-club' },
    );

    expect(options.map((o) => o.kind === 'org' && o.name)).toEqual([
      'Aix Escrime',
      'Marseille AMHE',
      'Zurich Fechtschule',
    ]);
  });

  it('reports no current workspace for platform staff inside an org they do not belong to', () => {
    const { options, current } = resolveWorkspaceOptions(
      me({ platformRole: 'platform_admin', organizations: [] }),
      { kind: 'org', slug: 'someone-elses-club' },
    );

    expect(options).toHaveLength(1);
    expect(current).toBeNull();
  });

  // The cast is the honest part of this test, not a way around the type.
  // `MeSession` is a claim about what a SEPARATELY DEPLOYED service sends, not a
  // proof — an API that gains a tier before this bundle is rebuilt will put a
  // string here that the union does not list. `parsePlatformRole` is the handler
  // for exactly that, so the branch is reachable and stays covered.
  it('keeps the platform row when the tier is one this build does not know', () => {
    const { options } = resolveWorkspaceOptions(
      me({ platformRole: 'platform_overlord' as never, organizations: [] }),
      { kind: 'platform' },
    );

    // Still offered — the shells gate entry on raw truthiness, so dropping the
    // row here would strand the user with no way back to the console.
    expect(options).toEqual([{ kind: 'platform', href: '/admin', tier: null }]);
  });

  // REMOVED 2026-08-20: 'skips org entries with no slug and falls back to the
  // slug when the name is missing'. That branch could not fire. The API's
  // normalizeOrganizationMembership returns null unless id, slug, name and role
  // are all strings and the caller filters those out, so a slugless or nameless
  // row is not something /me can emit. It was written against an "older API
  // build", which this repo does not defend — the operator wipes and redeploys
  // the whole stack every few commits. The guard went with the test.
});
