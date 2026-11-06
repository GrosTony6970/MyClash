import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import {
  PHOTO_CAPTION_MAX,
  PHOTO_MAX_BYTES,
  PHOTO_NAME_MAX,
  type PhotoMode,
  type PhotoUploadRefusal,
} from '@myclash/types';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { readUploadParts, type UploadLimit } from '../../common/read-upload';
import { MeEventsService } from '../me/me-events.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PhotoRefusalError, stripJpeg } from './jpeg-strip';
import { accountPhotoName } from './photo-account';
import { PHOTO_STORE, photoObjectKeys, type PhotoStore } from './photo-bucket';
import { makePreview } from './photo-preview';
import { photosUnavailable } from './photo-refusals';
import { photoTokenMatches } from './photo-token';
import { photoUploadWindow } from './photo-window';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PHOTO_UPLOAD: UploadLimit = {
  maxBytes: PHOTO_MAX_BYTES,
  tooLarge: 'Photo exceeds the 12 MB size limit.',
};
/** Photos processed at once: about 50 MB each, inside the one 1 GB API (design, "Concurrency cap"). */
export const PHOTO_UPLOAD_SLOTS = 4;
export const DEVICE_PHOTOS_PER_HOUR = 20;
/** A signed-in sender's hour per Event, the phone's number (design Goal 11). */
export const ACCOUNT_PHOTOS_PER_HOUR = 20;
export const EVENT_PHOTOS_PER_HOUR = 300;
export const EVENT_PHOTO_BYTES = 15 * 1000 ** 3;

/**
 * Who sends: a phone from the QR link (its token, its cookie id), or a signed-in person from her
 * personal space (design Goal 11). A QR upload stays anonymous even when its sender is signed in.
 */
export type PhotoSender =
  { kind: 'phone'; token: unknown; deviceId: string } | { kind: 'account'; reader: PublicReader };

/** The row's sender columns, and the name an account's photo carries (null: read the typed one). */
type PhotoSource =
  | { device_id: string; uploader_user_id: null; name: null }
  | { device_id: null; uploader_user_id: string; name: string };

interface PhotoEvent {
  id: string;
  start_date: string;
  end_date: string;
  timezone: string | null;
  photo_mode: PhotoMode;
  photo_token_version: number;
}

/** Every code below is a `PhotoUploadRefusal`: the phone page translates each one by name. */
const refuse = (
  Kind: new (body: object) => HttpException,
  code: PhotoUploadRefusal,
  message: string,
) => new Kind({ message, code });
const tooMany = (code: PhotoUploadRefusal, message: string) =>
  new HttpException({ message, code }, HttpStatus.TOO_MANY_REQUESTS);

/**
 * A photo sent from an Event's QR link, or from a signed-in person's personal space (design Goal
 * 11): checked, stripped of everything hidden, previewed, stored, recorded (design, "The server").
 *
 * Every refusal that does not need the file comes first, cheapest first, and the file is read only
 * once they all pass: the token (a phone), the mode, the window, "one of her Events" and her name
 * (an account), the bucket, a processing slot, the limits. The account's membership read is the
 * whole "my events" read: accepted at 20 photos an hour per account.
 *
 * The races, named:
 * - Two uploads may read the counts before either writes, so a cap can be passed by at most
 *   PHOTO_UPLOAD_SLOTS photos. Accepted (design: "not locked").
 * - The slot counter lives in this process. One API container serves HTTP; the `worker`
 *   container boots the same app but serves none, so one counter holds. If the worker ever serves
 *   HTTP, the memory budget doubles.
 */
@Injectable()
export class PhotoUploadService {
  private readonly logger = new Logger(PhotoUploadService.name);
  private readonly secret: string;
  private inFlight = 0;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore | null,
    private readonly myEvents: MeEventsService,
  ) {
    this.secret = config.getOrThrow<string>('PHOTO_TOKEN_SECRET');
  }

  async upload(
    eventId: string,
    sender: PhotoSender,
    req: FastifyRequest,
  ): Promise<{ id: string; status: 'waiting' | 'approved' }> {
    const event = await this.readEvent(eventId);
    const source = await this.admit(event, sender);
    if (!this.store) throw photosUnavailable();
    if (this.inFlight >= PHOTO_UPLOAD_SLOTS) {
      throw new OperationalUnavailableException({
        code: 'photos_busy',
        message: 'Many photos are arriving at once; retrying shortly.',
      } satisfies { code: PhotoUploadRefusal; message: string });
    }
    this.inFlight += 1;
    try {
      await this.checkLimits(event.id, source);
      return await this.receive(event, source, req, this.store);
    } finally {
      this.inFlight -= 1;
    }
  }

  /**
   * Each sender's own checks, in the order the QR path always had: the phone's token first; then
   * the mode and the window for both; then, for an account, "one of her Events" and her name.
   */
  private async admit(event: PhotoEvent, sender: PhotoSender): Promise<PhotoSource> {
    if (
      sender.kind === 'phone' &&
      !photoTokenMatches(this.secret, event.id, event.photo_token_version, sender.token)
    ) {
      throw refuse(ForbiddenException, 'photo_link_invalid', 'This photo link is not valid.');
    }
    if (event.photo_mode === 'off') {
      throw refuse(ForbiddenException, 'photos_off', 'This Event does not take photos.');
    }
    const window = photoUploadWindow(event);
    const now = Date.now();
    if (!window || now < window.opensAt.getTime() || now >= window.closesAt.getTime()) {
      throw refuse(
        ForbiddenException,
        'photos_window_closed',
        'Photos are not open for this Event.',
      );
    }
    if (sender.kind === 'phone') {
      return { device_id: sender.deviceId, uploader_user_id: null, name: null };
    }
    return this.member(event, sender.reader);
  }

  /**
   * "One of her Events" is the personal space's own list (design: one predicate for both), and
   * her name is her profile's, else her sign-up name (ruling 458). A read that fails is a 503,
   * never "not your event" (ruling 461).
   */
  private async member(event: PhotoEvent, reader: PublicReader): Promise<PhotoSource> {
    const mine = await this.myEvents.listMyEvents(reader).catch((err: unknown) => {
      this.logger.warn(`My events not read: ${err instanceof Error ? err.message : String(err)}`);
      throw photosUnavailable();
    });
    if (!mine.some((entry) => entry.event.id === event.id)) {
      throw refuse(
        ForbiddenException,
        'photo_not_your_event',
        'Photos are sent from a personal space only to its own Events.',
      );
    }
    const name = await accountPhotoName(this.supabase, reader.userId);
    if (name === null) {
      throw refuse(ForbiddenException, 'photo_no_name', 'A photo carries its sender’s name.');
    }
    return { device_id: null, uploader_user_id: reader.userId, name };
  }

  private async readEvent(eventId: string): Promise<PhotoEvent> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, start_date, end_date, timezone, photo_mode, photo_token_version')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Event not found');
    return data as PhotoEvent;
  }

  private async checkLimits(eventId: string, source: PhotoSource): Promise<void> {
    const { data, error } = await this.supabase.service.rpc('event_photo_usage', {
      p_event_id: eventId,
      p_device_id: source.device_id,
      p_user_id: source.uploader_user_id,
    });
    if (error) throw new Error(error.message);
    const usage = (Array.isArray(data) ? data[0] : data) as {
      event_last_hour: number;
      event_bytes: number;
      sender_last_hour: number;
    };
    if (source.uploader_user_id !== null && usage.sender_last_hour >= ACCOUNT_PHOTOS_PER_HOUR) {
      throw tooMany('photo_account_limit', 'This account has sent its photos for this hour.');
    }
    if (source.device_id !== null && usage.sender_last_hour >= DEVICE_PHOTOS_PER_HOUR) {
      throw tooMany('photo_device_limit', 'This phone has sent its photos for this hour.');
    }
    if (usage.event_last_hour >= EVENT_PHOTOS_PER_HOUR) {
      throw tooMany('photo_event_limit', 'This Event has received its photos for this hour.');
    }
    // The file is not read yet, so count it at its largest: the read cannot pass the cap.
    if (Number(usage.event_bytes) + PHOTO_UPLOAD.maxBytes > EVENT_PHOTO_BYTES) {
      throw tooMany('photo_event_storage_full', 'This Event has no room for more photos.');
    }
  }

  private async receive(
    event: PhotoEvent,
    source: PhotoSource,
    req: FastifyRequest,
    store: PhotoStore,
  ): Promise<{ id: string; status: 'waiting' | 'approved' }> {
    const { buffer, fields } = await readUploadParts(req, PHOTO_UPLOAD);
    if (!buffer) throw refuse(BadRequestException, 'photo_missing', 'No photo was sent.');
    // An account's photo carries her name, whatever name was sent (design Goal 11).
    const name = source.name ?? textField(fields['name'], PHOTO_NAME_MAX);
    const caption = textField(fields['caption'], PHOTO_CAPTION_MAX);
    const tag = await this.readTag(event.id, fields['tournamentId'], fields['workshopId']);
    const { original, preview } = await this.processPhoto(buffer);

    const id = randomUUID();
    const keys = photoObjectKeys(event.id, id);
    await this.storeBoth(store, keys, original, preview);

    const status = event.photo_mode === 'live' ? 'approved' : 'waiting';
    const { error } = await this.supabase.service.from('event_photos').insert({
      id,
      event_id: event.id,
      ...tag,
      status,
      uploader_name: name,
      caption,
      device_id: source.device_id,
      uploader_user_id: source.uploader_user_id,
      ...keys,
      byte_size: original.length,
      crc32: crc32(original),
    });
    if (error) {
      await this.removeQuietly(store, [keys.original_key, keys.preview_key]);
      throw new Error(`Photo row not written: ${error.message}`);
    }
    return { id, status };
  }

  /** A Tournament or a Workshop of this Event, or none; never both. */
  private async readTag(
    eventId: string,
    tournamentId: string | undefined,
    workshopId: string | undefined,
  ): Promise<{ tournament_id: string | null; workshop_id: string | null }> {
    const invalid = () =>
      refuse(
        BadRequestException,
        'photo_tag_invalid',
        'The tag is not a Tournament or Workshop of this Event.',
      );
    const tournament = tournamentId?.trim() || null;
    const workshop = workshopId?.trim() || null;
    if (tournament && workshop) throw invalid();
    const id = tournament ?? workshop;
    if (!id) return { tournament_id: null, workshop_id: null };
    if (!UUID.test(id)) throw invalid();
    const { data, error } = await this.supabase.service
      .from(tournament ? 'tournaments' : 'workshops')
      .select('id')
      .eq('id', id)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) throw new Error(`Photo tag not checked: ${error.message}`);
    if (!data) throw invalid();
    return { tournament_id: tournament, workshop_id: workshop };
  }

  /**
   * Both images or neither. On any failure both keys are removed: a write that timed out on our
   * side may still have been kept by the bucket, and deleting a missing key is a no-op.
   */
  private async storeBoth(
    store: PhotoStore,
    keys: { original_key: string; preview_key: string },
    original: Buffer,
    preview: Buffer,
  ): Promise<void> {
    try {
      await store.put(keys.original_key, original);
      await store.put(keys.preview_key, preview);
    } catch (err) {
      this.logger.warn(`Photo not stored: ${err instanceof Error ? err.message : String(err)}`);
      await this.removeQuietly(store, [keys.original_key, keys.preview_key]);
      throw photosUnavailable();
    }
  }

  /** The stripped original and its preview. A fault that is not the photo's own is logged. */
  private async processPhoto(bytes: Buffer): Promise<{ original: Buffer; preview: Buffer }> {
    try {
      const original = stripJpeg(bytes).bytes;
      return { original, preview: await makePreview(original) };
    } catch (err) {
      if (err instanceof PhotoRefusalError) {
        throw refuse(UnprocessableEntityException, err.code, err.message);
      }
      this.logger.warn(`Photo not read: ${err instanceof Error ? err.message : String(err)}`);
      throw refuse(UnprocessableEntityException, 'photo_corrupt', 'The photo could not be read.');
    }
  }

  /** Best effort: a leftover object is logged by key, never lets the caller think it was kept. */
  private async removeQuietly(store: PhotoStore, keys: string[]): Promise<void> {
    for (const key of keys) {
      await store.remove(key).catch((err: unknown) => {
        this.logger.error(
          `Orphan photo object ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }
}

/** Trimmed text, or null when empty. Counted in characters, as Postgres' char_length does. */
function textField(value: string | undefined, max: number): string | null {
  const text = value?.trim() ?? '';
  if (text === '') return null;
  if ([...text].length > max) {
    throw refuse(BadRequestException, 'photo_text_too_long', `Keep it to ${max} characters.`);
  }
  return text;
}
