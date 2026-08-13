/**
 * The whole English dictionary, composed from one module per namespace.
 *
 * Importing THIS pulls every namespace. That is right for the server, for the
 * package's own tests and for anything that walks the tree — and wrong for a
 * browser bundle, which is what the per-surface entries in src/surfaces/ are
 * for. A client module that imports the composed root ships all 15 namespaces
 * in both locales, which is the ~181KB the split exists to stop.
 */
import { app } from './app.js';
import { publicApp } from './publicApp.js';
import { metadata } from './metadata.js';
import { actions } from './actions.js';
import { common } from './common.js';
import { navigation } from './navigation.js';
import { offline } from './offline.js';
import { scoring } from './scoring.js';
import { auth } from './auth.js';
import { legal } from './legal.js';
import { admin } from './admin.js';
import { leagueWorkspace } from './leagueWorkspace.js';
import { statusHelp } from './statusHelp.js';
import { organizer } from './organizer.js';
import { test } from './test.js';

export const en = {
  app,
  publicApp,
  metadata,
  actions,
  common,
  navigation,
  offline,
  scoring,
  auth,
  legal,
  admin,
  leagueWorkspace,
  statusHelp,
  organizer,
  test,
} as const;
