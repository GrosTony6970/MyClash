export type CookieEnvironment = string | undefined;

export interface SessionCookieOptionsInput {
  env?: CookieEnvironment;
  expires?: Date;
  maxAge?: number;
  /**
   * Cookie `Domain` (e.g. `.myclash.fr`). When set, the cookie is shared across
   * all subdomains (app/admin/staff/api) so a login that lands on a different
   * subdomain than the one that set the cookie stays authenticated. Omit for a
   * host-only cookie (the default, used in dev).
   */
  domain?: string;
}

export function buildCorsOrigins(domain: string): string[] {
  return [
    // In production the marketing site IS the apex, so this entry already
    // covers its call to /public/site-stats. Dev is the exception below.
    `https://${domain}`,
    `https://app.${domain}`,
    `https://admin.${domain}`,
    `https://staff.${domain}`,
    // Dev only, and harmless in production: `marketing.myclash.fr` does not
    // exist and resolves nowhere, so listing it grants nothing. Dev puts the
    // marketing site on its own subdomain because `myclash.localhost` is
    // already taken by web-public, which means the apex entry above does not
    // cover it and its stats band would silently fail CORS locally.
    `https://marketing.${domain}`,
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
