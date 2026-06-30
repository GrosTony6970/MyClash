'use client';

import { useState } from 'react';
import { EmptyState } from '@myclash/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { MemberCard } from './MemberCard';
import type { DirectoryGroup, useDirectoryGroups } from './useDirectoryGroups';

type GroupsApi = ReturnType<typeof useDirectoryGroups>;

export function GroupsTab({ groupsApi }: { groupsApi: GroupsApi }) {
  const { t } = useI18n();
  const [newName, setNewName] = useState('');

  function createGroup() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    void groupsApi.createGroup(trimmed);
    setNewName('');
  }

  return (
    <section className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createGroup();
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('publicApp.me.groups.createPlaceholder')}
          maxLength={80}
          className="min-h-[44px] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={newName.trim().length === 0}
          className="min-h-[44px] rounded-lg border border-accent/60 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent disabled:opacity-50"
        >
          {t('publicApp.me.groups.create')}
        </button>
      </form>

      {groupsApi.actionError === 'nameInUse' && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {t('publicApp.me.groups.nameInUse')}
        </p>
      )}

      {groupsApi.groups.length === 0 ? (
        <EmptyState
          title={t('publicApp.me.groups.emptyTitle')}
          description={t('publicApp.me.groups.emptyHint')}
        />
      ) : (
        groupsApi.groups.map((group) => (
          <GroupSection key={group.id} group={group} groupsApi={groupsApi} />
        ))
      )}
    </section>
  );
}

function GroupSection({ group, groupsApi }: { group: DirectoryGroup; groupsApi: GroupsApi }) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function saveRename() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== group.name) void groupsApi.renameGroup(group.id, trimmed);
    setRenaming(false);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveRename();
            }}
            className="flex flex-1 items-center gap-2"
          >
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={80}
              className="min-h-[40px] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              className="rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent"
            >
              {t('publicApp.me.groups.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setRenameValue(group.name);
                setRenaming(false);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted"
            >
              {t('publicApp.me.groups.cancel')}
            </button>
          </form>
        ) : (
          <>
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="truncate text-sm font-semibold text-foreground">{group.name}</h2>
              <span className="flex-shrink-0 text-xs text-muted">
                {t('publicApp.me.groups.memberCount', { count: group.members.length })}
              </span>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setRenameValue(group.name);
                  setRenaming(true);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-foreground/5"
              >
                {t('publicApp.me.groups.rename')}
              </button>
              {confirmDelete ? (
                <>
                  <button
                    type="button"
                    onClick={() => void groupsApi.deleteGroup(group.id)}
                    className="rounded-md border border-danger/60 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger"
                  >
                    {t('publicApp.me.groups.delete')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted"
                  >
                    {t('publicApp.me.groups.cancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:border-danger/60 hover:bg-danger/10"
                >
                  {t('publicApp.me.groups.delete')}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {group.members.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted">
          {t('publicApp.me.groups.emptyGroup')}
        </p>
      ) : (
        group.members.map((member) => (
          <MemberCard
            key={member.globalPersonId}
            member={member}
            onFollow={() => groupsApi.followPerson(member.globalPersonId)}
            onUnfollow={() => groupsApi.unfollowPerson(member.globalPersonId)}
            onRemove={() => void groupsApi.removeMember(group.id, member.globalPersonId)}
          />
        ))
      )}
    </section>
  );
}
