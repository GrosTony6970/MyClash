import { describe, expect, it } from 'vitest';
import { tournamentPillClasses } from './tournament-pill-classes';

describe('tournamentPillClasses', () => {
  it('uses the configured tournament colour for an active registration', () => {
    const classes = tournamentPillClasses({ color: 'purple', registrationState: 'active' });
    expect(classes).toContain('purple');
    expect(classes).not.toContain('emerald');
  });

  it('falls back to green when an active tournament has no configured colour', () => {
    const classes = tournamentPillClasses({ color: null, registrationState: 'active' });
    expect(classes).toContain('emerald');
  });

  // Quiet by colour, not by fade: at 60% the waitlist pill was 2.2:1 (known-deviations D29).
  it('renders a grey pill at full ink for a waitlist registration (colour ignored)', () => {
    const classes = tournamentPillClasses({ color: 'purple', registrationState: 'waitlist' });
    expect(classes.split(' ')).toContain('text-slate-600');
    expect(classes).not.toContain('opacity');
    expect(classes).not.toContain('purple');
  });
});
