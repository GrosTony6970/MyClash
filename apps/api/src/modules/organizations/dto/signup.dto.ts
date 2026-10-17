import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { acceptedLegalShape } from '../../../common/legal/accepted-legal.schema';

/** Reserved slugs that cannot be used as organization slugs. */
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'app',
  'www',
  'myclash',
  'super',
  'staff',
  'support',
  'help',
  'about',
  'blog',
  'docs',
  'status',
  'legal',
  'privacy',
  'terms',
] as const;

/**
 * A club's name and address, as every sign-up door takes them: the form, the
 * mailed link's door and the Google sign-up (operator ruling 305).
 */
export const signupClubShape = {
  orgName: z.string().min(2).max(100),
  /**
   * URL-safe slug for the organization. Auto-suggested from orgName on the
   * frontend, editable by the user. Must be unique and not reserved.
   * Pattern: lowercase letters, digits, hyphens only. 3–50 chars.
   */
  orgSlug: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, digits, and hyphens'),
};
export const signupClubSchema = z.object(signupClubShape);

const signupSchema = z
  .object({
    // ── Step 1: Account ──────────────────────────────────────────────────────
    // No password, no method: the mailed link opens "choose your password", and the
    // password is chosen once the address is proven (ruling "Pre-takeover").
    email: z.email(),
    displayName: z.string().min(2).max(100),

    // ── Step 2: Organization ─────────────────────────────────────────────────
    ...signupClubShape,

    // ── Agreement ────────────────────────────────────────────────────────────
    // Required, not optional: this is the only place an organiser account comes
    // into existence, so a signup without an acceptance is one we cannot later
    // evidence. The versions are checked against the published registry.
    ...acceptedLegalShape,
  })
  .strict();
export class SignupDto extends createZodDto(signupSchema) {}

/**
 * The organiser's "choose your password" page sends the code of the sign-up mail, the password,
 * and what the mailed link carries: the club, checked as the form checks it BEFORE the code is
 * spent (ruling 305: a link edited by hand made a club under any name), and the versions she
 * accepted (checked at the form; recorded once the account is proven).
 */
const signupChoosePasswordSchema = z
  .object({
    token_hash: z.string().min(10).max(2048),
    // No lower bound: `validatePassword` says which rules failed.
    password: z.string().max(256),
    ...signupClubShape,
    ...acceptedLegalShape,
  })
  .strict();
export class SignupChoosePasswordDto extends createZodDto(signupChoosePasswordSchema) {}

const checkSlugSchema = z
  .object({
    slug: z
      .string()
      .min(3)
      .max(50)
      .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, digits, and hyphens'),
  })
  .strict();
export class CheckSlugDto extends createZodDto(checkSlugSchema) {}
