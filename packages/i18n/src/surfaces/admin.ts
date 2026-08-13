/**
 * The organiser workspace's share: `admin`, `organizer` and `leagueWorkspace`
 * on top of everything the other surfaces use.
 *
 * This is the surface that saves least — web-admin genuinely reads about 80% of
 * the dictionary, so the split is worth ~29KB gzip here against ~168KB on the
 * pad. It is included so every app resolves its messages the same way, not
 * because the saving alone would justify it.
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
import { admin as enAdmin } from '../messages/en/admin.js';
import { organizer as enOrganizer } from '../messages/en/organizer.js';
import { leagueWorkspace as enLeagueWorkspace } from '../messages/en/leagueWorkspace.js';
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
import { admin as frAdmin } from '../messages/fr/admin.js';
import { organizer as frOrganizer } from '../messages/fr/organizer.js';
import { leagueWorkspace as frLeagueWorkspace } from '../messages/fr/leagueWorkspace.js';

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
    admin: enAdmin,
    organizer: enOrganizer,
    leagueWorkspace: enLeagueWorkspace,
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
    admin: frAdmin,
    organizer: frOrganizer,
    leagueWorkspace: frLeagueWorkspace,
  },
} as const;
