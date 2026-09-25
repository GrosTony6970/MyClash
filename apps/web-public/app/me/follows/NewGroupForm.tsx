'use client';

import { useState } from 'react';
import { useI18n } from '@myclash/next-i18n/client';

const STYLES = {
  page: {
    form: 'flex items-center gap-2',
    input:
      'min-h-[44px] flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent',
    button:
      'min-h-[44px] rounded-lg border border-accent/60 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent disabled:opacity-50',
  },
  inline: {
    form: 'mt-1 flex items-center gap-2 border-t border-border pt-2',
    input:
      'min-h-[40px] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent',
    button:
      'rounded-md border border-accent/60 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-50',
  },
} as const;

/**
 * The one "new group" form: the My groups tab (`page`) and the Search tab's group picker
 * (`inline`). The name stays until the server answers (ruling 123): a refused create ("name
 * already used") leaves it there to fix; only a created group clears it, and only if it was not
 * retyped meanwhile. `disabled` holds it shut until the groups are loaded.
 */
export function NewGroupForm({
  onCreate,
  disabled,
  variant,
}: {
  onCreate: (name: string) => Promise<boolean>;
  disabled: boolean;
  variant: keyof typeof STYLES;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const styles = STYLES[variant];

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    const created = await onCreate(trimmed);
    setCreating(false);
    if (created) setName((current) => (current.trim() === trimmed ? '' : current));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className={styles.form}
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('publicApp.me.groups.createPlaceholder')}
        maxLength={80}
        className={styles.input}
      />
      <button
        type="submit"
        disabled={disabled || creating || name.trim().length === 0}
        className={styles.button}
      >
        {t('publicApp.me.groups.create')}
      </button>
    </form>
  );
}

/**
 * While the groups load, or when they failed to, say so (ruling 123): never "No groups yet" or
 * "Create a group first". Nothing once they are loaded.
 */
export function GroupsLoadNotice({ status }: { status: string }) {
  const { t } = useI18n();
  if (status === 'loading') return <p className="text-sm text-muted">{t('common.loading')}</p>;
  if (status !== 'error') return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {t('publicApp.me.groups.loadFailed')}
    </p>
  );
}
