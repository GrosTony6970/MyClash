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

const signupSchema = z
  .object({
    // ── Step 1: Account ──────────────────────────────────────────────────────
    email: z.email(),
    displayName: z.string().min(2).max(100),
    /**
     * 'magic_link' — send a magic link; account is implicitly verified on click.
     * 'password'   — create with password; email verification required before
     *                creating events.
     */
    method: z.enum(['magic_link', 'password']),
    /** Required when method='password'. */
    password: z.string().min(8).max(128).optional(),

    // ── Step 2: Organization ─────────────────────────────────────────────────
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

    // ── Agreement ────────────────────────────────────────────────────────────
    // Required, not optional: this is the only place an organiser account comes
    // into existence, so a signup without an acceptance is one we cannot later
    // evidence. The versions are checked against the published registry.
    ...acceptedLegalShape,
  })
  .strict();
export class SignupDto extends createZodDto(signupSchema) {}

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
