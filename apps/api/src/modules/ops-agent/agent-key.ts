import { createHash } from 'node:crypto';

/**
 * The ops agent's key: `mca_` plus 32 random bytes in base64url (43 characters).
 *
 * The prefix is not a secret. It lets the door's guard refuse a login token or a typo before it
 * reads the table, and it lets a person tell this key from any other string in `.env`. The deploy
 * seed (`scripts/bootstrap-ops-agent.mjs`) holds the same pattern; it lives outside the API.
 */
export const AGENT_KEY_PATTERN = /^mca_[A-Za-z0-9_-]{43}$/;

export function isAgentKey(value: string): boolean {
  return AGENT_KEY_PATTERN.test(value);
}

/** The stored form: sha256 hex. The raw key is never written anywhere by the API. */
export function hashAgentKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
