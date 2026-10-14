import { describe, expect, it } from 'vitest';
import { pinPromptOptions } from './pin-feedback';

/** O27 (ruled 2026-10-14): the reset-PIN box names the person and the rule, and checks as typed. */
const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;

describe('pinPromptOptions', () => {
  const options = pinPromptOptions({ display_name: 'Ana Roux' }, t);

  it('names whose PIN it is, and states the rule', () => {
    expect(options.title).toBe('organizer.staff.resetPinFor {"name":"Ana Roux"}');
    expect(options.description).toBe('organizer.staff.pinHint');
    expect(options.fieldLabel).toBe('organizer.staff.newPin');
  });

  it('masks the PIN and offers to show it', () => {
    expect(options.masked).toBe(true);
    expect(options.revealable).toEqual({
      show: 'organizer.staff.showPin',
      hide: 'organizer.staff.hidePin',
    });
  });

  it('refuses a PIN the server would refuse, and takes a good one', () => {
    expect(options.validate?.('12')).toBe('organizer.staff.pinHint');
    expect(options.validate?.('123456')).toBe('organizer.staff.weakPin.sequence');
    expect(options.validate?.('482916')).toBeNull();
  });
});
