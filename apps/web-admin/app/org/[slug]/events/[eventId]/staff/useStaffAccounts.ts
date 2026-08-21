'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StaffRole } from '@myclash/types';
import { apiRequest, type ApiResult } from '@myclash/api-client';
import { getPublicApiUrl } from '@/lib/api-url';
import { useI18n } from '@myclash/next-i18n/client';
import { createAccountProblem } from './create-account-feedback';
import { pinProblem } from './pin-feedback';
import type { EventInfo, Lice, StaffAccount } from './types';

export interface NewStaffAccount {
  displayName: string;
  username: string;
  pin: string;
}

interface StaffSnapshot {
  event: EventInfo | null;
  accounts: StaffAccount[];
  lices: Lice[];
}

/**
 * Every read and write on this page, on the admin's Supabase session cookie.
 *
 * `base` is a PATH, not a URL: `apiRequest` takes the origin separately, and
 * `getPublicApiUrl()` is a pure read of an inlined literal, so calling it per
 * request costs nothing and keeps the one owner of that value the only one.
 */
function staffRequest<T>(
  base: string,
  path: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
): Promise<ApiResult<T>> {
  return apiRequest<T>(getPublicApiUrl(), `${base}${path}`, init);
}

/**
 * Pure I/O — fetches and parses, touches no state.
 *
 * At module scope rather than inside the hook so the mount effect can call it
 * directly: `react-hooks/set-state-in-effect` is an ERROR here (max-warnings 0)
 * and it flags any setState-containing function invoked synchronously in an
 * effect body, whether or not the write is actually behind an await. Keeping
 * the fetch state-free means the effect is honest about doing no synchronous
 * state work, rather than being written around the rule.
 *
 * `apiRequest` never throws, so the accounts read is the one that decides
 * whether there is a snapshot at all — it throws here on purpose, because the
 * caller's `.catch` is what puts the page into its load-error state. The event
 * and the lices stay best-effort: neither is worth blanking the roster over.
 */
async function fetchStaffSnapshot(base: string): Promise<StaffSnapshot> {
  const [event, accounts, lices] = await Promise.all([
    staffRequest<EventInfo>(base, ''),
    staffRequest<StaffAccount[]>(base, '/staff-accounts'),
    staffRequest<Lice[]>(base, '/lices'),
  ]);
  if (!accounts.ok) throw new Error('staff failed');
  return {
    event: event.ok ? event.data : null,
    accounts: accounts.data,
    lices: lices.ok ? lices.data : [],
  };
}

/**
 * Every read and write the event-staff page makes.
 *
 * ONE accounts fetch serves all three tabs — the partition happens in the
 * browser. The list is already scoped to a single event and an event has tens
 * of staff accounts, not thousands, so a per-role endpoint would add a round
 * trip and a cache-invalidation problem to save nothing.
 *
 * Split into three hooks below (reads / lifecycle writes / configuration
 * writes) because one hook holding all of it ran past the 50-line function
 * limit, and baselining something that is only long because it does three jobs
 * is how that baseline stops meaning anything.
 */
export function useStaffAccounts(eventId: string) {
  const base = `/api/v1/events/${eventId}`;
  const data = useStaffData(base);
  const lifecycle = useStaffLifecycleWrites(base, data.load);
  const config = useStaffConfigWrites(base, data.load);

  return {
    ...data,
    ...lifecycle,
    ...config,
    error: data.error ?? lifecycle.error ?? config.error,
  };
}

/** The page's server state, plus the one refetch every mutation ends with. */
function useStaffData(base: string) {
  const { t } = useI18n();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [lices, setLices] = useState<Lice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((snapshot: StaffSnapshot) => {
    // The event is only ever widened, never nulled, on a refetch: losing the
    // slug would blank every sign-in link and QR code on the page.
    if (snapshot.event) setEvent(snapshot.event);
    setAccounts(snapshot.accounts);
    setLices(snapshot.lices);
  }, []);

  /** Refetch after a mutation, so the three tab counts stay true. */
  const load = useCallback(() => fetchStaffSnapshot(base).then(apply), [base, apply]);

  useEffect(() => {
    let cancelled = false;
    fetchStaffSnapshot(base)
      .then((snapshot) => {
        if (!cancelled) apply(snapshot);
      })
      .catch(() => {
        if (!cancelled) setError(t('organizer.staff.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base, apply, t]);

  return { event, accounts, lices, loading, error, load };
}

/** Writes that change whether an account exists, is usable, and what job it does. */
function useStaffLifecycleWrites(base: string, load: () => Promise<void>) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  /**
   * The role comes from the caller (the active tab), never from the form.
   * An organiser on the Gear check tab creates a gear account with no field to
   * get wrong — that is the whole point of splitting the form per tab.
   */
  const createAccount = useCallback(
    async (form: NewStaffAccount, role: StaffRole): Promise<boolean> => {
      setError(null);
      const res = await staffRequest(base, '/staff-accounts', {
        method: 'POST',
        body: { ...form, role },
      });
      if (!res.ok) {
        setError(createAccountProblem(res, t));
        return false;
      }
      await load();
      return true;
    },
    [base, load, t],
  );

  const toggleStatus = useCallback(
    (account: StaffAccount) =>
      patchAccount(base, account, {
        status: account.status === 'active' ? 'disabled' : 'active',
      }).then(load),
    [base, load],
  );

  const setRole = useCallback(
    (account: StaffAccount, role: StaffRole) => patchAccount(base, account, { role }).then(load),
    [base, load],
  );

  return { error, createAccount, toggleStatus, setRole };
}

/**
 * PATCH one account. Used by both status toggling and re-roling, which are the
 * same request with a different key.
 *
 * Re-roling exists so an organiser can move a mis-tabbed account rather than
 * recreate it: there is no delete verb here — only disable — so without it a
 * volunteer created on the wrong tab would be stranded with a PIN and a
 * sign-in link that lead nowhere useful. Lice assignments survive the move on
 * purpose (see `updateAccount` in staff.service.ts).
 */
function patchAccount(
  base: string,
  account: StaffAccount,
  body: Record<string, unknown>,
): Promise<ApiResult<unknown>> {
  return staffRequest(base, `/staff-accounts/${account.id}`, { method: 'PATCH', body });
}

/** Writes that configure an existing account: its credential and its pistes. */
function useStaffConfigWrites(base: string, load: () => Promise<void>) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const resetPin = useCallback(
    async (account: StaffAccount, pin: string) => {
      setError(null);
      setNotice(null);
      // Checked before the request because the reset prompt is the generic
      // masked `usePrompt` — it has nowhere to render a live rule — and a
      // rejected PIN would otherwise come back as an unexplained 400.
      const problem = pinProblem(pin, t);
      if (problem !== null) {
        setError(problem);
        return;
      }
      // The new PIN is never echoed back, so a silent failure here is
      // indistinguishable from a typo at the tablet an hour later.
      const res = await staffRequest(base, `/staff-accounts/${account.id}/reset-pin`, {
        method: 'POST',
        body: { pin },
      });
      if (res.ok) setNotice(t('organizer.staff.resetPinDone'));
      else setError(t('organizer.staff.resetPinError'));
    },
    [base, t],
  );

  const setAccountLices = useCallback(
    async (account: StaffAccount, liceId: string, checked: boolean) => {
      const liceIds = checked
        ? [...account.liceIds, liceId]
        : account.liceIds.filter((existing) => existing !== liceId);
      await staffRequest(base, `/staff-accounts/${account.id}/lices`, {
        method: 'PUT',
        body: { liceIds },
      });
      await load();
    },
    [base, load],
  );

  return { error, notice, resetPin, setAccountLices };
}
