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

  it('renders a dimmed grey pill for a waitlist registration (colour ignored)', () => {
    const classes = tournamentPillClasses({ color: 'purple', registrationState: 'waitlist' });
    expect(classes).toContain('opacity-60');
    expect(classes).not.toContain('purple');
  });
});
