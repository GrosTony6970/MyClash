import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages } from '@myclash/i18n';
import type { TranslatorValues } from '../types/translator';
import {
  isKnownStatus,
  statusLabel,
  statusLabelKey,
  type StatusLabelDomain,
  type StatusOf,
} from './status-label';

const MIGRATIONS = resolve(__dirname, '../../../db/migrations');

/** The value list of a CHECK constraint, as the newest migration that writes it says. */
function checkList(constraint: string): string[] {
  let found: string[] | null = null;
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    const at = sql.search(new RegExp(`${constraint}\\s+CHECK`));
    if (at < 0) continue;
    const list = /IN\s*\(([^)]*)\)/i.exec(sql.slice(at))?.[1] ?? '';
    found = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
  }
  if (!found) throw new Error(`no migration writes ${constraint}`);
  return found.sort();
}

/** Every club member role, as the newest `has_org_role` lists them for `read_only`. */
function ladderOfOrgRoles(): string[] {
  let found = '';
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    const rung = /WHEN 'read_only'\s+THEN role IN \(([^)]*)\)/.exec(sql);
    if (rung) found = rung[1]!;
  }
  return [...found.matchAll(/'([^']+)'/g)].map((match) => match[1]!).sort();
}

/** Every value of a domain, as the helper knows it. */
const STATES: { [Domain in StatusLabelDomain]: ReadonlyArray<StatusOf<Domain>> } = {
  match: ['scheduled', 'running', 'paused', 'completed', 'voided'],
  clock: ['idle', 'running', 'halted', 'ended'],
  event: ['draft', 'published', 'running', 'completed', 'archived'],
  tournament: ['draft', 'published', 'running', 'completed', 'archived'],
  registration: ['registered', 'checked_in', 'withdrawn', 'disqualified', 'waitlist'],
  claim: ['unclaimed', 'guest_active', 'claimed'],
  orgRole: ['owner', 'admin', 'editor', 'scorekeeper', 'referee', 'workshop_lead', 'read_only'],
  staffRole: ['scoring', 'checkin', 'gear'],
  swissRound: ['pending', 'running', 'completed'],
  poolState: ['in_progress', 'completed'],
  aiDraft: ['draft', 'ready', 'failed', 'applied', 'rejected'],
  scan: ['running', 'completed', 'failed'],
  leagueUserRole: ['owner', 'admin'],
  leagueOrgRole: ['owner', 'admin', 'member'],
  leagueAttachment: ['requested', 'approved', 'rejected', 'removed'],
  personRole: ['competitor', 'referee', 'workshop_lead'],
  refereeAssignment: ['assigned', 'pending', 'confirmed'],
  color: [
    'red',
    'blue',
    'green',
    'yellow',
    'purple',
    'orange',
    'black',
    'white',
    'amber',
    'violet',
    'teal',
    'gold',
    'silver',
    'bronze',
    'slate',
    'grey',
    'brown',
    'pink',
  ],
};

function wordIn(tree: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree);
}

describe('statusLabelKey', () => {
  it('has a word in English and in French for every state of every domain', () => {
    for (const domain of Object.keys(STATES) as StatusLabelDomain[]) {
      for (const status of STATES[domain]) {
        const key = statusLabelKey(domain, status as never);
        expect(typeof wordIn(messages.en, key), `${key} en`).toBe('string');
        expect(typeof wordIn(messages.fr, key), `${key} fr`).toBe('string');
      }
    }
  });

  it('knows exactly the states the database allows for a bout', () => {
    expect([...STATES.match].sort()).toEqual(checkList('match_status_check'));
    expect(checkList('match_status_check').every((status) => isKnownStatus('match', status))).toBe(
      true,
    );
  });

  it('knows exactly the states the database allows for an Event', () => {
    expect([...STATES.event].sort()).toEqual(checkList('events_status_check'));
    // `tournaments.status` has no CHECK: the API's Event and Tournament DTOs take these same five.
    expect([...STATES.tournament].sort()).toEqual(checkList('events_status_check'));
  });

  it('knows exactly the states the database allows for a Registration and a claim', () => {
    expect([...STATES.registration].sort()).toEqual(checkList('registration_status_check'));
    expect([...STATES.claim].sort()).toEqual(checkList('persons_claim_status_check'));
  });

  it('knows exactly the club member roles the access ladder names', () => {
    expect([...STATES.orgRole].sort()).toEqual(ladderOfOrgRoles());
  });

  it('calls a workshop lead an Instructor, as HIERARCHY.md does', () => {
    expect(wordIn(messages.en, statusLabelKey('orgRole', 'workshop_lead'))).toBe('Instructor');
    expect(wordIn(messages.fr, statusLabelKey('orgRole', 'workshop_lead'))).toBe('Instructeur');
  });

  it('knows exactly the states the database allows for a League attachment', () => {
    expect([...STATES.leagueAttachment].sort()).toEqual(
      checkList('league_tournament_links_status_check'),
    );
  });

  it('says a paused bout and a halted clock with the same word, as ruled', () => {
    const word = (key: string) => wordIn(messages.en, key);
    expect(word(statusLabelKey('match', 'paused'))).toBe('Paused');
    expect(word(statusLabelKey('clock', 'halted'))).toBe('Paused');
    expect(wordIn(messages.fr, statusLabelKey('clock', 'halted'))).toBe('En pause');
  });
});

describe('statusLabel', () => {
  const t = (key: string, values?: TranslatorValues) => (values ? key : `<${key}>`);

  it('words a state read as a plain string', () => {
    expect(statusLabel('match', 'running', t)).toBe('<common.status.match.running>');
    expect(statusLabel('clock', 'ended', t)).toBe('<common.status.clock.ended>');
  });

  it('shows a value the domain does not know as it is', () => {
    expect(statusLabel('match', 'ready', t)).toBe('ready');
    expect(isKnownStatus('match', 'toString')).toBe(false);
  });
});
