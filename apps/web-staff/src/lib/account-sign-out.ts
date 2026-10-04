import { apiRequest } from '@myclash/api-client';

/**
 * Sign the ACCOUNT out, then send the queue again (ruling 244a).
 *
 * The server asks an account before a PIN: a tablet where somebody's own
 * MyClash account is signed in (one login for every myclash site of that
 * browser) has every hit refused when that account has no scoring role, though
 * its PIN could score. With the account signed out, the next drain is answered
 * for the PIN session, which has its own cookie and stays.
 *
 * The drain runs whatever the sign-out answered: offline or refused, the bar
 * then says what is true of the queue now.
 */
export async function signAccountOut(
  apiUrl: string,
  engine: { drain(): Promise<void> },
): Promise<void> {
  await apiRequest<unknown>(apiUrl, '/api/v1/auth/logout', { method: 'POST' });
  await engine.drain();
}
