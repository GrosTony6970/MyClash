'use client';

import { useState } from 'react';
import type { StaffRole } from '@myclash/types';
import { useI18n } from '../../../../../../src/i18n/I18nProvider';
import { STAFF_TAB_CREATE_KEYS } from './types';
import type { NewStaffAccount } from './useStaffAccounts';

interface Props {
  /** The active tab. The created account gets this role — there is no field for it. */
  role: StaffRole;
  onCreate: (form: NewStaffAccount, role: StaffRole) => Promise<boolean>;
}

const EMPTY: NewStaffAccount = { displayName: '', username: '', pin: '' };

/**
 * The PIN input with its own reveal toggle.
 *
 * `type="password"` by default because these are created at a desk with people
 * around, and revealable because the organiser has to read it back to the
 * volunteer — the API never echoes a PIN once stored.
 */
function PinField({
  value,
  onChange,
  shown,
  onToggle,
}: {
  value: string;
  onChange: (next: string) => void;
  shown: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="relative">
      <input
        required
        value={value}
        type={shown ? 'text' : 'password'}
        autoComplete="off"
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('organizer.staff.pin')}
        className="w-full rounded border border-border py-2 pl-3 pr-16 text-sm"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute inset-y-0 right-2 text-xs font-semibold text-accent"
      >
        {shown ? t('organizer.staff.hidePin') : t('organizer.staff.showPin')}
      </button>
    </div>
  );
}

/**
 * Create one staff account in the role of the tab it is rendered under.
 *
 * The submit button names the role ("Create check-in account") so the implicit
 * choice is still visible: an organiser working fast on an event morning
 * reads the button, not the tab they landed on three clicks ago.
 */
export function CreateStaffAccountForm({ role, onCreate }: Props) {
  const { t } = useI18n();
  const [form, setForm] = useState<NewStaffAccount>(EMPTY);
  const [showPin, setShowPin] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (await onCreate(form, role)) {
      setForm(EMPTY);
      setShowPin(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="mt-6 grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-4"
    >
      <input
        required
        value={form.displayName}
        onChange={(event) =>
          setForm((current) => ({ ...current, displayName: event.target.value }))
        }
        placeholder={t('organizer.staff.displayName')}
        className="rounded border border-border px-3 py-2 text-sm"
      />
      <input
        required
        value={form.username}
        onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
        placeholder={t('organizer.staff.username')}
        className="rounded border border-border px-3 py-2 text-sm"
      />
      <PinField
        value={form.pin}
        onChange={(pin) => setForm((current) => ({ ...current, pin }))}
        shown={showPin}
        onToggle={() => setShowPin((current) => !current)}
      />
      <button className="rounded bg-accent px-4 py-2 text-sm font-bold text-accent-foreground">
        {t(STAFF_TAB_CREATE_KEYS[role])}
      </button>
    </form>
  );
}
