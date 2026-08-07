import { describe, expect, it } from 'vitest';
import { resolveWorkspaceOptions } from './workspace-options';

describe('resolveWorkspaceOptions', () => {
  it('returns nothing while /me is unresolved, so the shell keeps its static label', () => {
    expect(resolveWorkspaceOptions(null, { kind: 'platform' })).toEqual({
      options: [],
      current: null,
    });
    expect(resolveWorkspaceOptions({}, { kind: 'org', slug: 'lyon-amhe' })).toEqual({
      options: [],
      current: null,
    });
  });

  it('gives an organiser-only account a single org workspace', () => {
    const { options, current } = resolveWorkspaceOptions(
      { admin: { platformRole: null, organizations: [{ slug: 'lyon-amhe', name: 'Lyon AMHE' }] } },
      { kind: 'org', slug: 'lyon-amhe' },
    );

    expect(options).toEqual([
      { kind: 'org', href: '/org/lyon-amhe', slug: 'lyon-amhe', name: 'Lyon AMHE' },
    ]);
    expect(current).toEqual(options[0]);
  });

  it('gives a platform-only account a single platform workspace carrying its tier', () => {
    const { options, current } = resolveWorkspaceOptions(
      { admin: { platformRole: 'platform_viewer', organizations: [] } },
      { kind: 'platform' },
    );

    expect(options).toEqual([{ kind: 'platform', href: '/admin', tier: 'platform_viewer' }]);
    expect(current).toEqual(options[0]);
  });

  it('lists the platform workspace first, then every org by name', () => {
    const { options, current } = resolveWorkspaceOptions(
      {
        admin: {
          platformRole: 'super_admin',
          organizations: [
            { slug: 'paris-hema', name: 'Paris HEMA' },
            { slug: 'lyon-amhe', name: 'Lyon AMHE' },
          ],
        },
      },
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
      {
        admin: {
          platformRole: null,
          organizations: [
            { slug: 'z-club', name: 'Zurich Fechtschule' },
            { slug: 'a-club', name: 'Aix Escrime' },
            { slug: 'm-club', name: 'Marseille AMHE' },
          ],
        },
      },
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
      { admin: { platformRole: 'platform_admin', organizations: [] } },
      { kind: 'org', slug: 'someone-elses-club' },
    );

    expect(options).toHaveLength(1);
    expect(current).toBeNull();
  });

  it('keeps the platform row when the tier is one this build does not know', () => {
    const { options } = resolveWorkspaceOptions(
      { admin: { platformRole: 'platform_overlord', organizations: [] } },
      { kind: 'platform' },
    );

    // Still offered — the shells gate entry on raw truthiness, so dropping the
    // row here would strand the user with no way back to the console.
    expect(options).toEqual([{ kind: 'platform', href: '/admin', tier: null }]);
  });

  it('skips org entries with no slug and falls back to the slug when the name is missing', () => {
    const { options } = resolveWorkspaceOptions(
      {
        admin: {
          platformRole: null,
          organizations: [
            { slug: '', name: 'Unreachable' },
            { slug: null, name: 'Also unreachable' },
            { slug: 'lyon-amhe' },
          ],
        },
      },
      { kind: 'org', slug: 'lyon-amhe' },
    );

    expect(options).toEqual([
      { kind: 'org', href: '/org/lyon-amhe', slug: 'lyon-amhe', name: 'lyon-amhe' },
    ]);
  });
});
