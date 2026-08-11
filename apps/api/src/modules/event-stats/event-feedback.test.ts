import { describe, expect, it } from 'vitest';
import { summariseFeedback, MIN_SEGMENT_SIZE, type FeedbackRow } from './event-feedback';

function row(overrides: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    respondentRole: 'fighter',
    rating: 4,
    comment: null,
    isAttributed: false,
    ...overrides,
  };
}

function rows(count: number, overrides: Partial<FeedbackRow> = {}): FeedbackRow[] {
  return Array.from({ length: count }, () => row(overrides));
}

describe('summariseFeedback', () => {
  it('averages to one decimal, which is all the sample supports', () => {
    const summary = summariseFeedback([row({ rating: 4 }), row({ rating: 5 }), row({ rating: 5 })]);
    expect(summary.totalResponses).toBe(3);
    expect(summary.averageRating).toBe(4.7);
  });

  it('handles an event nobody answered without dividing by zero', () => {
    expect(summariseFeedback([])).toEqual({
      totalResponses: 0,
      averageRating: 0,
      segments: [],
      comments: [],
    });
  });

  it('breaks down by role once a segment is big enough', () => {
    const summary = summariseFeedback([
      ...rows(MIN_SEGMENT_SIZE, { respondentRole: 'fighter', rating: 4 }),
      ...rows(MIN_SEGMENT_SIZE, { respondentRole: 'referee', rating: 2 }),
    ]);
    expect(summary.segments).toEqual([
      { role: 'fighter', responses: 3, averageRating: 4 },
      { role: 'referee', responses: 3, averageRating: 2 },
    ]);
  });

  it('SUPPRESSES a segment small enough to name the person who answered', () => {
    // One referee answering makes "referees: 1, avg 2" a signature. This is the
    // failure that would betray someone who answered believing it was anonymous.
    const summary = summariseFeedback([
      ...rows(4, { respondentRole: 'fighter', rating: 5 }),
      row({ respondentRole: 'referee', rating: 1 }),
    ]);
    expect(summary.segments.map((s) => s.role)).toEqual(['fighter', 'other']);
    expect(summary.segments.find((s) => s.role === 'referee')).toBeUndefined();
    expect(summary.segments.find((s) => s.role === 'other')).toEqual({
      role: 'other',
      responses: 1,
      averageRating: 1,
    });
  });

  it('still counts a suppressed response in the total and the overall average', () => {
    // Suppression hides WHO, never the answer itself — dropping it would let a
    // lone critical voice vanish from the headline number.
    const summary = summariseFeedback([
      ...rows(4, { respondentRole: 'fighter', rating: 5 }),
      row({ respondentRole: 'referee', rating: 1 }),
    ]);
    expect(summary.totalResponses).toBe(5);
    expect(summary.averageRating).toBe(4.2);
  });

  it('leaves a comment unattributed unless the respondent opted in', () => {
    const summary = summariseFeedback([
      row({ comment: 'Ran late all day', isAttributed: false, respondentName: 'Jean Dupont' }),
    ]);
    expect(summary.comments).toEqual([
      { rating: 4, comment: 'Ran late all day', attributedTo: null },
    ]);
  });

  it('names a respondent who did opt in', () => {
    const summary = summariseFeedback([
      row({ comment: 'Great pistes', isAttributed: true, respondentName: 'Jean Dupont' }),
    ]);
    expect(summary.comments[0]!.attributedTo).toBe('Jean Dupont');
  });

  it('trusts the FLAG, not the presence of a name', () => {
    // If a name reaches this layer by any other route on an unattributed row,
    // it must still not be shown.
    const summary = summariseFeedback([
      row({ comment: 'x', isAttributed: false, respondentName: 'Leaked Name' }),
    ]);
    expect(JSON.stringify(summary)).not.toContain('Leaked Name');
  });

  it('drops whitespace-only comments rather than rendering empty quotes', () => {
    expect(summariseFeedback([row({ comment: '   ' })]).comments).toEqual([]);
  });
});
