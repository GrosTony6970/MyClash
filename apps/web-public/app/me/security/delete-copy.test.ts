import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';

/**
 * Deleting the account deletes the photos she sent from her personal space (ruling 462). Both
 * boxes of the Security page say so, in both languages: "Your data" and the red delete box she
 * presses (ruling 489).
 */
describe('the Security page names the photos an account deletion takes', () => {
  const cases = [
    {
      locale: 'en',
      security: en.publicApp.security,
      photos: /the photos you sent from your personal space/u,
    },
    {
      locale: 'fr',
      security: fr.publicApp.security,
      photos: /photos (que vous avez )?envoyées depuis votre espace personnel/u,
    },
  ];

  for (const { locale, security, photos } of cases) {
    it(`in ${locale}, the delete box and "Your data" both name them`, () => {
      expect(security.deleteSubtitle).toMatch(photos);
      expect(security.dataRetentionBody).toMatch(photos);
    });
  }
});
