import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CI_GATES, CI_PLUMBING_STEPS, gateKey } from './gates';
import { parseWorkflowSteps } from './parse-workflow';

/**
 * Does `gates.ts` still describe the CI this repo actually runs?
 *
 * The gate-health card compares CI's answer against CI_GATES to find gates that
 * did not report. That only works while the constant is true. A gate renamed in
 * ci.yml and not here would render as permanently missing; a gate ADDED to ci.yml
 * and not here would be invisible to the card — the exact blindness the card
 * exists to end.
 *
 * So both directions are asserted, and every named step must be consciously one
 * thing or the other. Adding a step to ci.yml fails this test until someone
 * decides whether it is a gate.
 */

function findWorkflow(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../.github/workflows/ci.yml'), // cwd = apps/api
    path.resolve(process.cwd(), '.github/workflows/ci.yml'), // cwd = repo root
    path.resolve(__dirname, '../../../../../../.github/workflows/ci.yml'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not locate .github/workflows/ci.yml (looked in: ${candidates.join(', ')})`,
  );
}

/**
 * ~31 named steps across 11 jobs today. The floor sits well under, so ordinary
 * churn never trips it, but a parser that lost the step construct entirely
 * reports zero and would otherwise pass silently. Never lower this to make a
 * change pass.
 */
const MIN_NAMED_STEPS = 25;

const workflow = readFileSync(findWorkflow(), 'utf8');
const steps = parseWorkflowSteps(workflow);

describe('the workflow parser understands ci.yml', () => {
  it('finds a meaningful number of named steps', () => {
    expect(steps.length).toBeGreaterThanOrEqual(MIN_NAMED_STEPS);
  });

  it('resolves job display names, not job keys', () => {
    // `jobs.e2e.name` is "Playwright and Axe" — the jobs API reports the display
    // name, so a card keyed on the job key would join against nothing.
    const jobs = new Set(steps.map((s) => s.job));
    expect(jobs.has('Playwright and Axe')).toBe(true);
    expect(jobs.has('e2e')).toBe(false);
  });

  it('parses a step whose name is not the first key in the step', () => {
    const parsed = parseWorkflowSteps(
      ['jobs:', '  lint:', '    name: Lint', '    steps:', '      - name: Check formatting'].join(
        '\n',
      ),
    );
    expect(parsed).toEqual([{ job: 'Lint', step: 'Check formatting' }]);
  });
});

describe('CI gate coverage', () => {
  it('every gate in CI_GATES still exists in ci.yml', () => {
    const live = new Set(steps.map((s) => gateKey(s)));
    const missing = CI_GATES.map((g) => gateKey(g))
      .filter((key) => !live.has(key))
      .sort();

    expect(
      missing,
      `These gates are listed in gates.ts but no longer exist in ci.yml. A renamed step ` +
        `renders as permanently missing on the gate-health card. Re-point each one:\n` +
        missing.map((k) => `  - ${k}`).join('\n'),
    ).toEqual([]);
  });

  it('every named step in ci.yml is consciously a gate or plumbing', () => {
    const gates = new Set(CI_GATES.map((g) => gateKey(g)));
    const plumbing = new Set<string>(CI_PLUMBING_STEPS);

    const unbucketed = steps
      .filter((s) => !gates.has(gateKey(s)) && !plumbing.has(s.step))
      .map((s) => gateKey(s))
      .sort();

    expect(
      unbucketed,
      `These ci.yml steps are neither in CI_GATES nor CI_PLUMBING_STEPS. The gate-health ` +
        `card cannot see a gate nobody listed. Add each to CI_GATES, or to ` +
        `CI_PLUMBING_STEPS if it is setup rather than a quality gate:\n` +
        unbucketed.map((k) => `  - ${k}`).join('\n'),
    ).toEqual([]);
  });

  it('plumbing entries name steps that ci.yml actually has', () => {
    const live = new Set(steps.map((s) => s.step));
    const dead = CI_PLUMBING_STEPS.filter((step) => !live.has(step)).sort();

    expect(dead, `CI_PLUMBING_STEPS names steps no job runs`).toEqual([]);
  });

  it('no gate is listed twice', () => {
    const keys = CI_GATES.map((g) => gateKey(g));
    expect(keys).toEqual([...new Set(keys)]);
  });
});
