import { describe, expect, it } from 'vitest';
import { eventVisibility } from './event-visibility';

describe('eventVisibility', () => {
  it('draft is hidden and can be published', () => {
    expect(eventVisibility('draft')).toEqual({
      isPublic: false,
      canToggle: true,
      mode: 'publish',
    });
  });

  it('published is public and can be hidden', () => {
    expect(eventVisibility('published')).toEqual({
      isPublic: true,
      canToggle: true,
      mode: 'unpublish',
    });
  });

  it('running is public but not toggleable here (lifecycle status)', () => {
    expect(eventVisibility('running')).toEqual({
      isPublic: true,
      canToggle: false,
      mode: null,
    });
  });

  it('completed is public but not toggleable here', () => {
    expect(eventVisibility('completed')).toEqual({
      isPublic: true,
      canToggle: false,
      mode: null,
    });
  });

  it('archived is hidden and not toggleable here', () => {
    expect(eventVisibility('archived')).toEqual({
      isPublic: false,
      canToggle: false,
      mode: null,
    });
  });
});
