'use client';

import { useEffect, useState } from 'react';
import { readFindBrowse } from '@/lib/fightbook/read-fightbook';
import { usePagedList } from './use-paged-list';

/** The name box waits this long after the last key before it reads. */
export const NAME_DEBOUNCE_MS = 250;

/** The name the box asks for, once typing pauses. Under 2 letters it narrows nothing: everyone. */
export function useNameFilter(text: string): string {
  const [name, setName] = useState('');
  useEffect(() => {
    const trimmed = text.trim();
    const timer = setTimeout(() => setName(trimmed.length >= 2 ? trimmed : ''), NAME_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return name;
}

/**
 * All of FightBook for the current search (a name and a weapon), page by page: `usePagedList`
 * keyed by both, so a new name or weapon starts again at page 0 and an old answer lands nowhere.
 */
export function useFightBookBrowse(apiUrl: string, name: string, weapon: string) {
  return usePagedList(
    `${apiUrl}|${name}|${weapon}`,
    (page, signal) => readFindBrowse(apiUrl, name, weapon, page, signal),
    (card) => card.fighter.globalPersonId,
  );
}
