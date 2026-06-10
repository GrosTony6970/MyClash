/**
 * Maps an event's `status` to its public-visibility + toggle state, so the
 * overview card and the events list agree on one rule.
 *
 * Public visibility mirrors the public site filter + the `events_select_public`
 * RLS policy: an event is shown publicly when its status is published, running
 * or completed. The visibility toggle only flips draft ↔ published (the
 * publish/unpublish endpoints); running/completed/archived are lifecycle
 * states, not a simple toggle, so they're surfaced read-only.
 */
export interface EventVisibility {
  /** Shown on the public site? */
  isPublic: boolean;
  /** Can the visibility be toggled here (draft ↔ published only)? */
  canToggle: boolean;
  /** The publish/unpublish endpoint suffix to POST, or null when not toggleable. */
  mode: 'publish' | 'unpublish' | null;
}

const PUBLIC_STATUSES = new Set(['published', 'running', 'completed']);

export function eventVisibility(status: string): EventVisibility {
  return {
    isPublic: PUBLIC_STATUSES.has(status),
    canToggle: status === 'draft' || status === 'published',
    mode: status === 'draft' ? 'publish' : status === 'published' ? 'unpublish' : null,
  };
}
