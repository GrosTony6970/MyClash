import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { acceptedLegalShape } from '../../../common/legal/accepted-legal.schema';

const oAuthSessionSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    mode: z.enum(['admin_login', 'organizer_signup', 'person_claim', 'public_login']),
    personId: z.uuid().optional(),
    orgName: z.string().optional(),
    orgSlug: z.string().optional(),
    next: z.string().optional(),
    /**
     * Optional at the schema level and required at the mode level: only
     * `organizer_signup` is account creation this endpoint can recognise as
     * such. A first-ever Google *login* also mints an account, but GoTrue has
     * already done that by the time we are called and there is nothing here to
     * distinguish it from a returning user — those are caught by `pendingLegal`
     * on /me and asked by the banner instead.
     */
    acceptedTerms: acceptedLegalShape.acceptedTerms.optional(),
    acceptedPrivacy: acceptedLegalShape.acceptedPrivacy.optional(),
  })
  .strict();
export class OAuthSessionDto extends createZodDto(oAuthSessionSchema) {}
