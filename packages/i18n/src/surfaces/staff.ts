/**
 * The scoring pad's share of the dictionary.
 *
 * The pad reads 235 `scoring` keys and a handful of chrome. Before the split it
 * shipped all 6,418 keys in both locales — 181KB gzip on every page, of which it
 * read 4%. It is also the app on venue wifi, in a Scorekeeper's hand.
 *
 * `statusHelp` is here because packages/ui is one CJS barrel with no
 * tree-shaking: whatever status-help.ts imports, every app that touches
 * @myclash/ui ships. Give packages/ui subpath exports and this can drop out.
 */
import { app as enApp } from '../messages/en/app.js';
import { common as enCommon } from '../messages/en/common.js';
import { navigation as enNavigation } from '../messages/en/navigation.js';
import { metadata as enMetadata } from '../messages/en/metadata.js';
import { offline as enOffline } from '../messages/en/offline.js';
import { scoring as enScoring } from '../messages/en/scoring.js';
import { test as enTest } from '../messages/en/test.js';
import { statusHelp as enStatusHelp } from '../messages/en/statusHelp.js';
import { app as frApp } from '../messages/fr/app.js';
import { common as frCommon } from '../messages/fr/common.js';
import { navigation as frNavigation } from '../messages/fr/navigation.js';
import { metadata as frMetadata } from '../messages/fr/metadata.js';
import { offline as frOffline } from '../messages/fr/offline.js';
import { scoring as frScoring } from '../messages/fr/scoring.js';
import { test as frTest } from '../messages/fr/test.js';
import { statusHelp as frStatusHelp } from '../messages/fr/statusHelp.js';

export const messages = {
  en: {
    app: enApp,
    common: enCommon,
    navigation: enNavigation,
    metadata: enMetadata,
    offline: enOffline,
    scoring: enScoring,
    test: enTest,
    statusHelp: enStatusHelp,
  },
  fr: {
    app: frApp,
    common: frCommon,
    navigation: frNavigation,
    metadata: frMetadata,
    offline: frOffline,
    scoring: frScoring,
    test: frTest,
    statusHelp: frStatusHelp,
  },
} as const;
