const oauthCodeRuns = new Map<string, Promise<unknown>>();

export function runOAuthCodeOnce<T>(code: string, complete: () => Promise<T>): Promise<T> {
  const existing = oauthCodeRuns.get(code) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = Promise.resolve().then(complete);
  oauthCodeRuns.set(code, promise);
  return promise;
}
