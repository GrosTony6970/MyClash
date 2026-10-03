/**
 * push-delivery.ts — one alert, sent to every phone address an account saved.
 *
 * An account saves the address of each browser that turned phone alerts on. An address dies when
 * that browser turns them off, is reset, or the phone is thrown away, and the push service then
 * answers 404 or 410 for it, for good. Such an address is removed here, when an alert finds it.
 *
 * The answer is how many phones rang. One dead or unreachable address does not fail the alert
 * the other phones got. With no phone rung and none unreachable, the reader has no phone alert
 * set up, and the caller sends the email. A push service that cannot be reached is not a dead
 * address: nothing is removed, and when no phone rang the job fails, as it always did.
 */
import type { Logger } from '@nestjs/common';
import type { SupabaseService } from '../modules/supabase/supabase.service';

type Db = SupabaseService['service'];

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  severity?: 'info' | 'warning' | 'alert';
}

interface PushSender {
  send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: PushPayload,
  ): Promise<void>;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
}

interface PushDeps {
  db: Db;
  sender: PushSender;
  logger: Logger;
}

/** What a send throws: `web-push` puts the push service's answer on its error. */
type PushFailure = Error & { statusCode?: number };

/** The push service says the address is gone for good. */
const isGone = ({ statusCode }: PushFailure): boolean => statusCode === 404 || statusCode === 410;

/** What went wrong, for the log: `web-push` words every refusal alike, the status tells. */
const said = ({ message, statusCode }: PushFailure): string =>
  statusCode ? `${message} ${statusCode}` : message;

/**
 * Removed by the row ids this alert read. Such a row may have moved to another account since
 * (ruling 238); it is as dead there. An address the push service called gone does not come back:
 * a browser that turns alerts on again gets a new address.
 * Best effort: a removal that fails is said, and the next alert finds the address dead again.
 */
async function removeDead({ db, logger }: PushDeps, userId: string, ids: string[]): Promise<void> {
  const { error } = await db.from('push_subscriptions').delete().in('id', ids);
  if (error) {
    logger.warn(`Dead push subscriptions of ${userId} not removed: ${error.message}`);
  } else {
    logger.log(`Removed ${ids.length} dead push subscriptions of ${userId}`);
  }
}

/** Sends the alert to every phone of the account. How many rang. */
export async function ringPhones(
  deps: PushDeps,
  userId: string,
  payload: PushPayload,
): Promise<number> {
  const { data, error } = await deps.db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh_key, auth_key')
    .eq('user_id', userId);
  if (error) throw new Error(`Failed to load push subscriptions: ${error.message}`);
  const phones = (data ?? []) as PushSubscriptionRow[];

  const answers = await Promise.all(
    phones.map(async (phone) => {
      const keys = { p256dh: phone.p256dh_key, auth: phone.auth_key };
      try {
        await deps.sender.send({ endpoint: phone.endpoint, keys }, payload);
        return null;
      } catch (reason) {
        return { id: phone.id, reason: reason as PushFailure };
      }
    }),
  );
  const refused = answers.filter((answer) => answer !== null);
  const dead = refused.filter(({ reason }) => isGone(reason));
  const unreached = refused.filter(({ reason }) => !isGone(reason));
  const rang = phones.length - refused.length;

  if (dead.length > 0) {
    await removeDead(
      deps,
      userId,
      dead.map(({ id }) => id),
    );
  }
  const [first] = unreached;
  if (first) {
    const why = said(first.reason);
    if (rang === 0) throw new Error(`No phone of ${userId} reached: ${why}`);
    deps.logger.warn(
      `${unreached.length} of ${phones.length} phones of ${userId} not reached: ${why}`,
    );
  }
  return rang;
}
