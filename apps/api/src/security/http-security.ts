export type CookieEnvironment = string | undefined;

export interface SessionCookieOptionsInput {
  env?: CookieEnvironment;
  expires?: Date;
  maxAge?: number;
  /**
   * Cookie `Domain` (e.g. `.myclash.fr`). When set, the cookie is shared across
   * all subdomains (app/admin/scoring/api) so a login that lands on a different
   * subdomain than the one that set the cookie stays authenticated. Omit for a
   * host-only cookie (the default, used in dev).
   */
  domain?: string;
}

export function buildCorsOrigins(domain: string): string[] {
  return [
    `https://${domain}`,
    `https://app.${domain}`,
    `https://admin.${domain}`,
    `https://scoring.${domain}`,
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3003',
  ];
}

export function isProductionEnvironment(env: CookieEnvironment): boolean {
  return env === 'production';
}

export function buildSessionCookieOptions({
  env = process.env['NODE_ENV'],
  expires,
  maxAge,
  domain,
}: SessionCookieOptionsInput = {}): Record<string, unknown> {
  return {
    httpOnly: true,
    secure: isProductionEnvironment(env),
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
    ...(expires ? { expires } : {}),
    ...(maxAge ? { maxAge } : {}),
  };
}

export function buildClearCookieOptions(
  env: CookieEnvironment = process.env['NODE_ENV'],
  domain?: string,
): Record<string, unknown> {
  // The clear options MUST match the domain the cookie was set with, otherwise
  // the browser keeps the original (domain-scoped) cookie and logout silently
  // fails.
  return {
    secure: isProductionEnvironment(env),
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
  };
}
