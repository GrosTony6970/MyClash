import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The People hub says what went wrong (operator ruling 123).
 *
 * A failed groups load showed "No groups yet"; a signed-out change said "try again", which cannot
 * help; both create forms emptied the name before the server answered, so "name already used"
 * left nothing to fix. The rules live in `action-error.ts` (tested there); these pin the wiring.
 *
 * This package's vitest does not compile TSX, so the components are read as text.
 */
const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('the groups store', () => {
  const source = read('useDirectoryGroups.ts');

  it('names a signed-out failure on every group and follow action', () => {
    // Seven actions throw their failure through `failureOf`; the load's 401 is the "sign in"
    // screen already, so its own throw stays as it is. No action throws a bare kind any more.
    expect(source.match(/throw new Error\(\s*failureOf\(res\.status, /g)).toHaveLength(7);
    expect(source).not.toMatch(/throw new Error\('(create|update|follow|nameInUse)'\)/);
    expect(source).not.toContain("? 'nameInUse' : 'create');");
    expect(source.match(/fail\(caughtFailure\(err, '(create|update|follow)'\)\);/g)).toHaveLength(
      7,
    );
  });
});

describe('the new-group form (one owner, both tabs)', () => {
  const form = read('NewGroupForm.tsx');

  it('keeps the name until the group is created, and only then clears it', () => {
    expect(form).toContain('const created = await onCreate(trimmed);');
    expect(form).toContain(
      "if (created) setName((current) => (current.trim() === trimmed ? '' : current));",
    );
    // No other clear: one before the answer would lose the name on "name already used".
    expect(form.match(/setName\(/g)).toHaveLength(2);
    expect(form).toContain('disabled={disabled || creating || name.trim().length === 0}');
  });

  it('is the form of both tabs, held shut until the groups are loaded', () => {
    const groups = read('GroupsTab.tsx');
    const search = read('SearchTab.tsx');
    expect(groups).toMatch(/<NewGroupForm\s+variant="page"\s+disabled=\{!ready\}/);
    expect(search).toMatch(
      /<NewGroupForm\s+variant="inline"\s+disabled=\{groupsApi\.status !== 'ready'\}/,
    );
    // No second create form of its own (the rename form stays).
    expect(groups).not.toContain("t('publicApp.me.groups.createPlaceholder')");
    expect(search).not.toContain('function NewGroupInline');
  });
});

describe('a groups load that is pending or failed says so, never "no groups"', () => {
  it('the notice says loading, or that the load failed', () => {
    const form = read('NewGroupForm.tsx');
    expect(form).toContain(
      "if (status === 'loading') return <p className=\"text-sm text-muted\">{t('common.loading')}</p>;",
    );
    // Reachable: the notice returns nothing only when the status is neither.
    expect(form).toContain("if (status !== 'error') return null;");
    expect(form).toContain("{t('publicApp.me.groups.loadFailed')}");
  });

  it('the groups tab shows the notice, and "No groups yet" only once loaded', () => {
    const groups = read('GroupsTab.tsx');
    expect(groups).toContain('<GroupsLoadNotice status={groupsApi.status} />');
    expect(groups).toMatch(/\{!ready \? null : groupsApi\.groups\.length === 0 \?/);
  });

  it('the search tab’s group picker too', () => {
    const search = read('SearchTab.tsx');
    expect(search).toContain('<GroupsLoadNotice status={groupsApi.status} />');
    expect(search).toContain("{groupsApi.status === 'ready' && groupsApi.groups.length === 0 && (");
  });
});

describe('the Following and Organizers tabs name a session that ended', () => {
  it('the Following tab, on a toggle and on an unfollow', () => {
    const source = read('FollowsClient.tsx');
    expect(source).toContain("t(refusalKey(status, 'publicApp.me.follows.updateFailed'))");
    expect(source).toContain("t(refusalKey(status, 'publicApp.me.follows.unfollowFailed'))");
    expect(source.match(/status = res\.status;/g)).toHaveLength(2);
  });

  it('the Organizers tab says a refused unfollow failed', () => {
    const source = read('OrganizersTab.tsx');
    expect(source).toContain(
      "else toast.error(t(refusalKey(res.status, 'publicApp.me.follows.unfollowFailed')));",
    );
  });
});

describe('adding to a new group keeps the group when the add fails', () => {
  it('the add takes out its own placeholder only, never a snapshot of the list', () => {
    const source = read('useDirectoryGroups.ts');
    const add = source.slice(
      source.indexOf('async function addMember'),
      source.indexOf('async function removeMember'),
    );
    expect(add).toContain('members: g.members.filter((m) => m !== placeholder)');
    expect(add).not.toContain('setGroups(previous)');
  });
});
