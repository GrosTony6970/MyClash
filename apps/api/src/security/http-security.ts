export type CookieEnvironment = string | undefined;

export interface SessionCookieOptionsInput {
  env?: CookieEnvironment;
  expires?: Date;
  maxAge?: number;
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
}: SessionCookieOptionsInput = {}): Record<string, unknown> {
  return {
    httpOnly: true,
    secure: isProductionEnvironment(env),
    sameSite: 'lax',
    path: '/',
    ...(expires ? { expires } : {}),
    ...(maxAge ? { maxAge } : {}),
  };
}

export function buildClearCookieOptions(
  env: CookieEnvironment = process.env['NODE_ENV'],
): Record<string, unknown> {
  return {
    secure: isProductionEnvironment(env),
    sameSite: 'lax',
    path: '/',
  };
}
