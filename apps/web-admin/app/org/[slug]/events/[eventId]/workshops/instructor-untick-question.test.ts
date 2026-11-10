import { describe, expect, it } from 'vitest';
import { instructorUntickQuestion } from './instructor-untick-question';

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

describe('instructorUntickQuestion (561)', () => {
  it('asks nothing when no unticked line holds anything', () => {
    expect(instructorUntickQuestion([], t as never)).toBeNull();
  });

  it('names every unticked instructor whose line would lose its details', () => {
    const question = instructorUntickQuestion(['Paul', 'Marie'], t as never);
    expect(question?.description).toContain('"names":"Paul, Marie"');
    expect(question?.danger).toBe(true);
  });
});
