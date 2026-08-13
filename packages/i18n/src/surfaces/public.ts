/**
 * The public site's share of the dictionary: `publicApp`, plus the chrome the
 * sign-in and legal pages need.
 *
 * It does NOT include `admin` or `organizer`. It used to, for four stray keys
 * on the league index and one badge — 212KB of JSON for five strings, moved out
 * in the commit before this one.
 */
import { app as enApp } from '../messages/en/app.js';
import { common as enCommon } from '../messages/en/common.js';
import { navigation as enNavigation } from '../messages/en/navigation.js';
import { metadata as enMetadata } from '../messages/en/metadata.js';
import { offline as enOffline } from '../messages/en/offline.js';
import { scoring as enScoring } from '../messages/en/scoring.js';
import { test as enTest } from '../messages/en/test.js';
import { statusHelp as enStatusHelp } from '../messages/en/statusHelp.js';
import { actions as enActions } from '../messages/en/actions.js';
import { auth as enAuth } from '../messages/en/auth.js';
import { legal as enLegal } from '../messages/en/legal.js';
import { publicApp as enPublicApp } from '../messages/en/publicApp.js';
import { app as frApp } from '../messages/fr/app.js';
import { common as frCommon } from '../messages/fr/common.js';
import { navigation as frNavigation } from '../messages/fr/navigation.js';
import { metadata as frMetadata } from '../messages/fr/metadata.js';
import { offline as frOffline } from '../messages/fr/offline.js';
import { scoring as frScoring } from '../messages/fr/scoring.js';
import { test as frTest } from '../messages/fr/test.js';
import { statusHelp as frStatusHelp } from '../messages/fr/statusHelp.js';
import { actions as frActions } from '../messages/fr/actions.js';
import { auth as frAuth } from '../messages/fr/auth.js';
import { legal as frLegal } from '../messages/fr/legal.js';
import { publicApp as frPublicApp } from '../messages/fr/publicApp.js';

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
    actions: enActions,
    auth: enAuth,
    legal: enLegal,
    publicApp: enPublicApp,
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
    actions: frActions,
    auth: frAuth,
    legal: frLegal,
    publicApp: frPublicApp,
  },
} as const;
