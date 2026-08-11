import { describe, expect, it } from 'vitest';
import {
  classifyQueryError,
  QUERY_ERROR_CODE_SETS,
  severityFor,
  type QueryErrorClass,
} from './classify';

describe('classifyQueryError', () => {
  /**
   * The disjointness guard. Two sets claiming one code would make the classifier
   * depend on the order of its own `if`s, which is exactly the kind of silent
   * drift the S4a forfeit/override partition test was added to prevent.
   */
  it('never lets one code belong to two classes', () => {
    const seen = new Map<string, QueryErrorClass>();
    for (const [name, codes] of Object.entries(QUERY_ERROR_CODE_SETS)) {
      for (const code of codes) {
        expect(seen.has(code), `${code} is claimed by both ${seen.get(code)} and ${name}`).toBe(
          false,
        );
        seen.set(code, name as QueryErrorClass);
      }
    }
  });

  it('classifies every listed code as the set that lists it', () => {
    for (const [name, codes] of Object.entries(QUERY_ERROR_CODE_SETS)) {
      for (const code of codes) {
        expect(classifyQueryError(code, 400), `${code} should be ${name}`).toBe(name);
      }
    }
  });

  it.each([
    ['42703', 'an undefined column'],
    ['PGRST200', 'a relationship the schema cache does not have'],
    ['PGRST201', 'an ambiguous embed'],
  ])('treats %s (%s) as a contract defect', (code) => {
    expect(classifyQueryError(code, 400)).toBe('contract');
    expect(severityFor('contract')).toBe('error');
  });

  it.each([
    ['PGRST116', 'single() row count'],
    ['23505', 'unique violation'],
    ['42501', 'an RLS denial'],
  ])('treats %s (%s) as runtime, not a defect', (code) => {
    expect(classifyQueryError(code, 406)).toBe('runtime');
    expect(severityFor('runtime')).toBe('warning');
  });

  /**
   * A statement timeout says the database was busy, not that the SQL was wrong.
   * Bucketing "any 5xx" as a contract defect would page the operator about load.
   */
  it('treats a statement timeout as operational, not a contract defect', () => {
    expect(classifyQueryError('57014', 500)).toBe('operational');
    expect(severityFor('operational')).toBe('warning');
  });

  it('treats a codeless 5xx as operational — that is a gateway, not PostgREST', () => {
    expect(classifyQueryError(null, 502)).toBe('operational');
    expect(classifyQueryError(null, 503)).toBe('operational');
  });

  /** Fail loud: a code nobody has triaged surfaces rather than disappearing. */
  it('defaults an unrecognised code to contract', () => {
    expect(classifyQueryError('PGRST999', 400)).toBe('contract');
    expect(classifyQueryError(null, 400)).toBe('contract');
  });
});
