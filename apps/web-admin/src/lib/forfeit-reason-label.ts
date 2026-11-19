/**
 * One i18n key per `match_forfeits.reason` (the five forfeit reasons and the three override
 * reasons of migration 0177). The engine owns which reasons exist; this owns what each is called.
 * Literal values so the i18n reverse sweep can see them.
 *
 * Shared by a bout's own page and the post-event debrief, so one reason cannot carry two names.
 */
export const FORFEIT_REASON_LABEL_KEY: Readonly<Record<string, string>> = {
  injury: 'organizer.bracketPage.forfeitReasonInjury',
  voluntary: 'organizer.bracketPage.forfeitReasonVoluntary',
  black_card_1: 'organizer.bracketPage.forfeitReasonBlackCard1',
  black_card_2: 'organizer.bracketPage.forfeitReasonBlackCard2',
  conduct_violation: 'organizer.bracketPage.forfeitReasonConduct',
  referee_decision: 'organizer.bracketPage.overrideReasonRefereeDecision',
  admin_correction: 'organizer.bracketPage.overrideReasonAdminCorrection',
  technical_failure: 'organizer.bracketPage.overrideReasonTechnicalFailure',
};
