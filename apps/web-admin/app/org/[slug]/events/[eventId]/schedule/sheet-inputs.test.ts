import { describe, expect, it } from 'vitest';
import { TIME_PATTERN, sheetValid } from './sheet-inputs';

/** A sheet of two boxes, a time and a length, built as the planner builds them. */
function sheet(time: string, length: string) {
  const form = document.createElement('form');
  const timeBox = document.createElement('input');
  Object.assign(timeBox, { type: 'text', pattern: TIME_PATTERN, required: true, value: time });
  const lengthBox = document.createElement('input');
  Object.assign(lengthBox, { type: 'number', min: '1', step: '1', required: true, value: length });
  form.append(timeBox, lengthBox);
  return { timeBox, lengthBox };
}

describe('sheetValid', () => {
  it('passes a sheet whose every box passes', () => {
    expect(sheetValid(sheet('12:30', '7').lengthBox)).toBe(true);
  });

  it('holds a valid edit back while another box is half-typed', () => {
    // The save sends the whole sheet, so this edit would be refused along with
    // the half-typed time.
    expect(sheetValid(sheet('12:3', '7').lengthBox)).toBe(false);
  });

  it('holds an edit back while a length reads 0', () => {
    expect(sheetValid(sheet('12:30', '0').timeBox)).toBe(false);
  });
});
