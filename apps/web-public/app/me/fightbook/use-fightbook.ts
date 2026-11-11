'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  FightBookBlock,
  FightBookSettings,
  IncomingSparRequest,
  MySpars,
} from '@myclash/types';
import {
  readBlocks,
  readFightBookSettings,
  readInbox,
  readMySpars,
  type FightBookRead,
} from '@/lib/fightbook/read-fightbook';
import { signInAgainHere } from '@/lib/sign-in-return';

export interface FightBookData {
  settings: FightBookSettings;
  inbox: IncomingSparRequest[];
  spars: MySpars;
  blocks: FightBookBlock[];
}

export type FightBookState =
  { status: 'loading' } | { status: 'failed' } | ({ status: 'ready' } & FightBookData);

const NOTHING = { inbox: [], spars: { spars: [], sent: [] }, blocks: [] };

/** null: aborted, or gone to sign in. */
async function load(apiUrl: string, signal: AbortSignal): Promise<FightBookState | null> {
  const settings = await readFightBookSettings(apiUrl, signal);
  const outcome = settle([settings]);
  if (outcome !== 'data' || settings.kind !== 'data') return outcome === 'failed' ? FAILED : null;
  if (!settings.data.hasProfile) return { status: 'ready', settings: settings.data, ...NOTHING };
  if (!settings.data.enabled) {
    // Off still shows the spars agreed (ruling 666): nothing else.
    const spars = await readMySpars(apiUrl, signal);
    const off = settle([spars]);
    if (off !== 'data' || spars.kind !== 'data') return off === 'failed' ? FAILED : null;
    return { status: 'ready', settings: settings.data, ...NOTHING, spars: spars.data };
  }
  const [inbox, spars, blocks] = await Promise.all([
    readInbox(apiUrl, signal),
    readMySpars(apiUrl, signal),
    readBlocks(apiUrl, signal),
  ]);
  const all = settle([inbox, spars, blocks]);
  if (all !== 'data') return all === 'failed' ? FAILED : null;
  if (inbox.kind !== 'data' || spars.kind !== 'data' || blocks.kind !== 'data') return FAILED;
  return {
    status: 'ready',
    settings: settings.data,
    inbox: inbox.data,
    spars: spars.data,
    blocks: blocks.data,
  };
}

const FAILED: FightBookState = { status: 'failed' };

/** One verdict for several reads: aborted wins, then sign in (it leaves the page), then failed. */
function settle(reads: FightBookRead<unknown>[]): 'data' | 'failed' | 'aborted' {
  if (reads.some((r) => r.kind === 'aborted')) return 'aborted';
  if (reads.some((r) => r.kind === 'signin')) {
    signInAgainHere();
    return 'aborted';
  }
  return reads.some((r) => r.kind === 'failed') ? 'failed' : 'data';
}

/**
 * The FightBook page's data: the switch first, then, when it is on, the Inbox, My spars and the
 * blocked list together; when it is off, My spars only. `reload` reads all again (after the switch changes); `update` patches the
 * ready state from a write's own answer, so a tap does not re-read and flash the whole page.
 */
export function useFightBook(apiUrl: string) {
  const [state, setState] = useState<FightBookState>({ status: 'loading' });
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void load(apiUrl, controller.signal).then((next) => {
      if (next) setState(next);
    });
    return () => controller.abort();
  }, [apiUrl, asked]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAsked((n) => n + 1);
  }, []);

  const update = useCallback((change: (data: FightBookData) => Partial<FightBookData>) => {
    setState((current) =>
      current.status === 'ready' ? { ...current, ...change(current) } : current,
    );
  }, []);

  return { state, reload, update };
}
