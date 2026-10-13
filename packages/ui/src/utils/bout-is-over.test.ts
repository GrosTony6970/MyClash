import { describe, expect, it } from 'vitest';
import { boutIsOver } from './bout-is-over';

describe('boutIsOver', () => {
  it('is over when its row is completed and its clock has ended', () => {
    expect(boutIsOver('completed', 'ended')).toBe(true);
  });

  it('is not over when a correction reopened it: paused, its clock still ended', () => {
    expect(boutIsOver('paused', 'ended')).toBe(false);
  });

  it('is not over when its row is completed and its clock never ended', () => {
    expect(boutIsOver('completed', 'idle')).toBe(false);
    expect(boutIsOver('completed', 'halted')).toBe(false);
  });

  it('is not over when either word is missing', () => {
    expect(boutIsOver(undefined, 'ended')).toBe(false);
    expect(boutIsOver('completed', null)).toBe(false);
  });
});
