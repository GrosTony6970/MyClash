# Quick wins and quality-of-life list — MyClash

## Context

The operator asked for a check of the app, a list of quick wins and quality-of-life improvements,
then a second sweep and, for each correction, what it would bring.

Two sweeps, six read-only passes, covered the pad and staff sign-in (`apps/web-staff`), the TV
screens, the organiser app (`apps/web-admin`) and the public app with its personal space
(`apps/web-public`). The second sweep also settled the 20 open questions of the first: 17 are now
confirmed or refuted in code, and are folded in below.

Every item has a file and line. ✔ = re-read by me, or confirmed by the second pass tracing it to
the API. The rest rest on one citation and get re-read when their slice starts. **Nothing was run
in a browser.**

This file is a menu, not one slice. Each row is one commit (hard rule 9). The operator picks.

## How to use this file

Written on 2026-10-08 against `6814d8731`. Line numbers drift: re-read the cited lines before a
slice starts. The commit that closes a row strikes the row through here and adds its short hash.
Built so far: P1 to P4, then O1, O2, O3, T1, F1, F2 and ruling 1, then P5, P6, P10 and P18, all
on 2026-10-09. A struck row carries its commit.

Size: **S** = under about one hour, **M** = about half a day.

---

## The ten to do first

| Pick   | Why this one                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| ~~P1~~ | ~~A hit that does not save says nothing. The official believes a point is recorded and it is not.~~ Done `3a16b775`.  |
| ~~P2~~ | ~~The Space bar starts the clock behind the "Round complete" screen.~~ Done `88c3520e` (pad) and `d1db074f` (server). |
| ~~P3~~ | ~~A bout opened with no network says "deleted or rescheduled" and never recovers by itself.~~ Done `b9745c05`.        |
| ~~P4~~ | ~~The piste bout list opened with no network spins for ever.~~ Done `4511bc52`.                                       |
| ~~O1~~ | ~~One slip on a status menu announces results to every follower, and that cannot be unsent.~~ Done `4f4a4993`.        |
| ~~O2~~ | ~~One click on a workshop's × deletes its whole sign-up list.~~ Done `42ed9406`.                                      |
| ~~O3~~ | ~~A message to every participant leaves on one click.~~ Done `eceb8c88`.                                              |
| ~~T1~~ | ~~The piste TV stops following its piste after the first bout.~~ Done `aa38439a`.                                     |
| ~~F1~~ | ~~A guest whose schedule fails to load is told to sign in, with no link and no retry.~~ Done `6eb64916`.              |
| ~~F2~~ | ~~A bout after midnight disappears under its own day chip.~~ Done `30011b27`.                                         |

---

## P — the pad, during a bout (`apps/web-staff`)

| #       | Today                                                                                                                                                                    | Fix                                                                                      | What it brings                                                                                          | Where                                                                                                 | Size |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---- |
| ~~P1~~  | ~~✔ A hit that fails to save on the device says nothing. The error is stored and never shown; its text is English only.~~ Done `3a16b775`.                               | Show it as an alert beside the clock, en + fr.                                           | The official knows at once that the point is not recorded, and taps again instead of finding out later. | `src/hooks/useScoringSubmit.ts:91` (nothing reads `submit.error`)                                     | S    |
| ~~P2~~  | ~~✔ During the pause between rounds, Space resumes the clock behind the "Round complete" screen. The server accepts it.~~ Done `88c3520e` (pad) and `d1db074f` (server). | Give the two overlays the shared `Modal`, which the Space handler already respects.      | No phantom resume/halt in the bout's timeline, and no clock running while nobody fights.                | `src/components/MatchView.tsx:547, 735-737, 780-782`; `apps/api/.../matches/clock.service.ts:159-174` | S–M  |
| ~~P3~~  | ~~✔ A bout opened or reloaded with no network says "Match unavailable — it may have been deleted". It stays after wifi returns.~~ Done `b9745c05`.                       | A "no connection, bout not loaded yet" state, a Retry button, and a re-read on `online`. | The official stops hunting for a "deleted" bout and gets back to it the second the network returns.     | `app/matches/[matchId]/page.tsx:95-98, 148-150, 248`; `src/offline/sync.ts:446-447`                   | S    |
| ~~P4~~  | ~~✔ The piste bout list opened with no network shows "Loading" for ever.~~ Done `4511bc52`.                                                                              | Clear `loading` on the offline return; say "no connection".                              | The official knows it is the wifi, not a broken tablet.                                                 | `src/hooks/useLiceMatches.ts:44` returns before the `try`, so `:59` never runs                        | S    |
| ~~P5~~  | ~~Going offline mid-bout removes the Next / Previous tiles and the "Next match" button.~~ Done `8097d978`.                                                               | Keep the last good neighbours when a refetch fails.                                      | The table moves to the next bout without going back to the list.                                        | `packages/ui/src/hooks/useAdjacentMatches.ts:71-76`                                                   | S    |
| ~~P6~~  | ~~Any failure loading the assigned pistes sends the official to the login page.~~ Done `b1e77724`.                                                                       | Redirect on 401/403 only, as `useLiceMatches.ts:31-33` already rules.                    | A restarting server no longer logs a whole table out.                                                   | `app/lices/page.tsx:79-84`                                                                            | S    |
| ~~P7~~  | ✔ The tablet sleeps during a bout. Done `6beb6156`.                                                                                                                      | One `useWakeLock` hook in `packages/ui/src/hooks`, shared with T7.                       | No unlocking the tablet while two fighters wait.                                                        | no `wakeLock` anywhere in the repo                                                                    | S    |
| ~~P8~~  | ✔ A downward swipe reloads the pad, which with no network lands on P3. Done `a2843380`.                                                                                  | `overscroll-behavior: none` on the pad.                                                  | A scroll gesture can no longer throw the official out of the bout.                                      | `src/styles/globals.css`                                                                              | S    |
| ~~P9~~  | ✔ Reset asks a French official to type the English words `RESET MATCH`, in exact capitals. A trailing space blocks it. Done `525a2bb9`.                                  | Trim and upper-case what is typed; say why the button is disabled.                       | The safeguard still stops accidents, without stopping the person who means it.                          | `src/components/MatchCorrectionsDrawer.tsx:403`; `apps/api/.../matches.service.ts:1201`               | S    |
| ~~P10~~ | ~~A list penalty that resolves to a red or black card is issued with one tap inside a scrolling list.~~ Done `4c44c421`.                                                 | Confirm red and black, as the direct-card path does; keep yellow one-tap.                | A scroll that lands as a tap cannot disqualify a fighter.                                               | `ScoringColumn.tsx:466-474, 507`; `DirectCardPanel.tsx:186`                                           | S    |
| ~~P11~~ | The sync bar's Retry and "Review refused" buttons are about 20px tall. Done `c2987aaf`.                                                                                  | Grow the bar to a 44px row when it needs the operator.                                   | The one button that recovers unsent exchanges can be hit first time.                                    | `src/components/SyncBar.tsx:18-21, 139`                                                               | S    |
| ~~P12~~ | Back, "Match actions", display and theme buttons in the pad header are under 44px. Done `f2a777dc`.                                                                      | `min-h-[44px]`, as `LiceHeader.tsx:39` already has.                                      | Fewer missed and wrong taps under time pressure.                                                        | `MatchHeader.tsx:126, 206, 220`; `src/theme/ThemeSwitcher.tsx:65-78`                                  | S    |
| ~~P13~~ | ✔ Nothing sounds or vibrates when time runs out; the numeral turns red. Done `f80cc191`.                                                                                 | Vibrate + short beep at expiry; a 10ms vibrate on a registered tap.                      | The official watches the fighters, not the tablet.                                                      | `ScoringCenterControls.tsx:384-398`                                                                   | S    |
| ~~P14~~ | "Is it synced?" text is 11–12px. Done `a74bc1a8`.                                                                                                                        | Raise to `text-sm` / `text-base`.                                                        | Readable at arm's length.                                                                               | `ScoringColumn.tsx:241`; `ScoringCenterControls.tsx:411, 567-576`                                     | S    |
| ~~P15~~ | The penalty search keeps its text after a card is issued. Done `de395d40`.                                                                                               | Clear on success; label and 44px height.                                                 | The next penalty starts from a clean list.                                                              | `ScoringColumn.tsx:152, 182-206`                                                                      | S    |
| ~~P16~~ | The piste list shows no count of unsent or refused exchanges. Done `eed5c3fd`.                                                                                           | Use the existing `SyncBar` there.                                                        | The official sees between bouts that something is still waiting to go out.                              | `app/lices/[liceId]/_components/LiceHeader.tsx:8-23`                                                  | S–M  |
| ~~P17~~ | The last piste is not remembered. Done `f25f5866`.                                                                                                                       | Remember it, following `src/lib/last-event.ts`.                                          | One tap less every time the pad is reopened.                                                            | `app/page.tsx:53`                                                                                     | S    |
| ~~P18~~ | ~~The corrections drawer rewrites an exchange as "no exchange" with one tap.~~ Done `97230507`.                                                                          | Confirm the rewrite; 44px targets.                                                       | A slip in the drawer cannot erase a scored hit.                                                         | `MatchCorrectionsDrawer.tsx:143-146, 335-342`                                                         | S    |
| ~~P19~~ | Only Space has a keyboard shortcut. Done `4dc33a4e`.                                                                                                                     | Add undo and Double to the same handler.                                                 | A laptop table scores without the mouse.                                                                | `MatchView.tsx:525-563`                                                                               | S–M  |
| ~~P20~~ | The doubles counter reads `2/3` and explains itself only on hover. Done `45d70354`.                                                                                      | A visible "Doubles" caption.                                                             | A new official is not left guessing on a touch screen.                                                  | `ScoringCenterControls.tsx:509-516`                                                                   | S    |

## S — staff sign-in (`apps/web-staff/app/login`)

| #      | Today                                                                                                                        | Fix                                                                                | What it brings                                                                             | Where                                        | Size |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- | ---- |
| ~~S1~~ | Wrong PIN, too many tries, no network and no Event chosen all show the same sentence. Done `a5139aa6`.                       | Branch on the failure kind (`failureMessage` exists); en + fr.                     | A volunteer stops retyping a correct PIN into a lockout, and the organiser is not fetched. | `useStaffPinLogin.ts:51-52`                  | S    |
| ~~S2~~ | Autocorrect rewrites the username; the fallback field is labelled "Event slug". Done `501586fc`.                             | `autoCapitalize="none" autoCorrect="off"`, autocomplete hints, label "Event code". | Sign-in works first time on a borrowed tablet.                                             | `StaffPinForm.tsx:48-62`; `fields.tsx:45-56` | S    |
| ~~S3~~ | The organiser email form prints "POST /api/v1/auth/magic-link failed (400)" and has no heading or way back. Done `e9c2564d`. | `failureMessage`, a heading, a "use another address" button.                       | Volunteers stop typing their email into the wrong form.                                    | `MagicLinkForm.tsx:36, 42-83`                | S    |
| ~~S4~~ | The Event picker shows the stored date string as-is. Done `9fe349e6`.                                                        | Format it in the UI language.                                                      | Today's Event is found at a glance among similar names.                                    | `src/components/EventPicker.tsx:154`         | S    |

## T — TV and projector screens

| #      | Today                                                                                                                                     | Fix                                                                                          | What it brings                                                                   | Where                                                                                                      | Size |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---- |
| ~~T1~~ | ~~Five seconds after a bout ends, the piste TV jumps to a per-Match address. It then follows Match ids, not the piste.~~ Done `aa38439a`. | Have the piste screen pass its own address through the existing `buildNextDisplayHref` prop. | A bout moved to another piste no longer strands the TV until someone walks over. | `packages/ui/src/components/TVScoreboard.tsx:144`; `next-display-href.ts:13`; `lice-display-client.tsx:80` | S    |
| ~~T2~~ | A French hall reads "MATCH ENDED", "Next match in 3…", "NEXT ▸", and a pill saying `halted`. Done `9a5c16d0`.                             | Seven strings to en + fr keys.                                                               | The hall reads the screen in its own language.                                   | `TVScoreboard.tsx:354, 372, 632, 656, 663, 667, 687`                                                       | S    |
| ~~T3~~ | The "next up" names are in phone-sized type. Done `dbfc2fa8`.                                                                             | Use the existing stage type scale.                                                           | The next two fighters see they are up from the warm-up area, without a call-out. | `TVScoreboard.tsx:341-343, 362, 371-378`; scale at `packages/ui/src/theme.css:139-143`                     | S    |
| ~~T4~~ | The public piste TV cannot swap red and blue sides. The organiser popup can. Done `b421fd68`.                                             | A swap button in `DisplayControls`, same stored key.                                         | Spectators stop giving a point to the wrong fighter.                             | `display-view.tsx:29-47`; `DisplayControls.tsx:123-136`                                                    | S    |
| ~~T5~~ | No fullscreen button; the laptop driving the TV can sleep. Done `b5701493`.                                                               | Fullscreen button + the wake-lock hook from P7.                                              | Setup is one tap, and the screen does not go black mid-Pool.                     | no `requestFullscreen` in the repo                                                                         | S    |

## F — fighter and spectator, public pages (`apps/web-public/app/e/[eventSlug]`)

| #       | Today                                                                                                                                             | Fix                                                                                       | What it brings                                                                 | Where                                                                                                     | Size |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---- |
| ~~F1~~  | ~~✔ A guest whose schedule fails to load is told to sign in. No link, no retry.~~ Done `6eb64916`.                                                | Tell a 401 from a failure: Retry for one, sign-in and "find my name" links for the other. | A fighter with weak signal retries, instead of thinking they have no schedule. | `my-schedule/page.tsx:213, 231-234, 246-258`                                                              | S    |
| ~~F2~~  | ~~✔ A bout at 00:30 local time gets its own day chip, and tapping the chip hides it. West of UTC the chip shows the wrong day.~~ Done `30011b27`. | Filter on the same Event-zone day key the grouping uses.                                  | No fighter misses a late bout because the app hid it.                          | `my-schedule/page.tsx:283` (raw ISO prefix) vs `:227, 304-306`; label `:412-415`                          | S    |
| ~~F3~~  | Bouts on the guest schedule cannot be tapped. Done `b165694a`.                                                                                    | Link each card to the Match page.                                                         | Score and exchanges are one tap from "my next bout".                           | `my-schedule/page.tsx:448-460`                                                                            | S    |
| ~~F4~~  | ✔ The live board shows who fights but no score. The server sends the score; the page drops it. Done `e4746521`.                                   | Reuse `home/_components/LiveMatchCard.tsx`.                                               | "What's the score on piste 3?" is answered on the phone.                       | `live/page.tsx:11-19, 85-91`; `apps/api/.../schedule/live-state.service.ts:27-29`                         | S    |
| ~~F5~~  | The live board says "Updates automatically" after it has stopped. Done `969ae48a`.                                                                | The freshness chip the Match page already has.                                            | Nobody trusts a frozen score.                                                  | `live/page.tsx:115-117, 339`                                                                              | S–M  |
| ~~F6~~  | While the Event runs, "Live now" is the last block on the Event home. Done `b129dfb8`.                                                            | Move it under the header when the Event is running.                                       | The first screen answers what people came for.                                 | `home/PublicHome.tsx:321`                                                                                 | S    |
| ~~F7~~  | The Event home has no door to "my schedule" or "find my name". Done `b129dfb8`.                                                                   | One card near the top.                                                                    | A first-time guest reaches their bouts in two taps, not five.                  | only inbound link: `src/components/public-personal-decision.ts:59`                                        | S    |
| ~~F8~~  | Guest pages show times in the phone's time zone. Done `5b8d5d98`.                                                                                 | `formatInZone` with the Event zone, as elsewhere.                                         | A fighter travelling from abroad does not arrive an hour late.                 | `my-schedule/page.tsx:117`; `people/[personId]/page.tsx:314, 348`; `live/page.tsx:40`                     | S    |
| ~~F9~~  | ✔ A followed fighter's upcoming bouts show no piste. The server sends it. Done `a71e71a7`.                                                        | Add the field to the page's type and render it.                                           | A friend or coach knows where to go.                                           | `people/[personId]/page.tsx:44-57, 303-320`                                                               | S    |
| ~~F10~~ | The guest schedule loads once and never says how old it is. Done `d471d5c5`.                                                                      | Reuse `useMySchedule` and its "Updated HH:MM" badge.                                      | The schedule survives a dead zone, and says when it was last right.            | `my-schedule/page.tsx:202-236`; `src/components/me/hooks.ts:73-117`                                       | M    |
| ~~F11~~ | After sign-in the fighter always lands on `/me`. `?next=` is sent and ignored. Done `e2b4b82a`.                                                   | Read `next`, validate with the existing `isOwnSitePath`.                                  | Sign-in returns you to the page you were on.                                   | `login/page.tsx:67`; `login/auth-requests.ts:94, 128`                                                     | S–M  |
| ~~F12~~ | On login, Enter does nothing; an empty field fails silently. Done `521423e7`.                                                                     | A real `<form onSubmit>` and an "enter your email" message.                               | Sign-in works from the phone keyboard and with a password manager.             | `login/page.tsx:61, 80, 113, 123, 274-331`                                                                | S    |
| ~~F13~~ | A mistyped Event link gives a near-blank page. The app has no not-found page. Done `d8f6dd25`.                                                    | `notFound()` on a missing Event; one localised 404 with a way home.                       | A wrong QR code or link says so, and offers the way back.                      | `_components/EventHeader.tsx:68`; `home/PublicHome.tsx:104`                                               | S–M  |
| ~~F14~~ | Error pages offer "Try again" only. Done `cb4f4b28`.                                                                                              | Add a link to the Event home or `/`.                                                      | No dead end when the retry also fails.                                         | `error.tsx:26-35`; `app/me/error.tsx:22-31`                                                               | S    |
| ~~F15~~ | ✔ Tabs read "Longsword Open · MyClash — MyClash", "Home — fal-2026", "Match 12". Done `729cbcba`.                                                 | Drop the suffix; resolve the Event name once in the layout; name the two fighters.        | Shared links and browser history read like the Event, not like an address.     | `layout.tsx:26-28`; `t/[tournamentSlug]/page.tsx:52, 59`; `match/[matchId]/page.tsx:119`                  | S–M  |
| ~~F16~~ | League, login and personal-space pages share the generic site title. Done `729cbcba`.                                                             | A root title template and per-page titles.                                                | Several open tabs can be told apart.                                           | no `metadata` in `app/leagues/*`, `app/login/page.tsx`, `app/me/layout.tsx`                               | S    |
| ~~F17~~ | Referee roles appear as raw English (`main referee`). Done `4a535cd7`.                                                                            | One en/fr label map.                                                                      | French referees read their role in French.                                     | `my-schedule/page.tsx:505`; `people/[personId]/page.tsx:344`                                              | S    |
| ~~F18~~ | `/live`, `/my-schedule`, `/pass` and a person's page have no back link. Done `b8652b16`.                                                          | Add the existing `BackLink`.                                                              | One tap back to the Event home.                                                | `live/page.tsx:248`; `people/[personId]/page.tsx:192-205`                                                 | S    |
| ~~F19~~ | No share button on Match or Tournament pages. Done `22794702`.                                                                                    | Generalise `src/components/fighter/ShareProfile.tsx` to any address.                      | "Watch my bout" is one tap to send.                                            | only that component exists                                                                                | S–M  |
| ~~F20~~ | No add-to-calendar. NOT built: ruled out.                                                                                                         | A client-side `.ics` of the schedule.                                                     | The phone reminds the fighter, with the app closed.                            | no `.ics` in the repo                                                                                     | M    |
| ~~F21~~ | League ranking names are plain text; a fighter's full history is undated and cannot be opened. Done `d2f5292a`.                                   | Send the fighter slug and link it; show the date; link each bout.                         | From a rank to the fighter to the bout, without searching.                     | `leagues/[slug]/StandingsGroups.tsx:125-127`; `fighters/[slug]/_components/MatchHistoryModal.tsx:115-143` | S    |

## M — the signed-in personal space (`apps/web-public/app/me`, `app/profile`)

| #      | Today                                                                                                            | Fix                                                        | What it brings                                                   | Where                                                          | Size |
| ------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | ---- |
| ~~M1~~ | ~~Profile save says "saved" while it drops a half-typed start year and incomplete medal rows.~~ Done `db94b485`. | Validate both before saving, as the birth date already is. | No medal found missing from a public profile weeks later.        | `profile/fighter/FighterProfileClient.tsx:649-655, 688-689`    | S    |
| ~~M2~~ | ~~A refused photo shows its reason a full form-length below the photo button.~~ Done `34918926`.                 | Show it under the photo, or as a toast.                    | The fighter knows why at once, and picks another file.           | same file `:567-627` set, `:1163` render                       | S    |
| ~~M3~~ | ~~Typing "delete" shows as DELETE but the button stays dead.~~ Done `932c6da9`.                                  | Store the upper-cased value.                               | Account deletion — a GDPR right — is not a dead end on a phone.  | `me/security/page.tsx:210, 280`                                | S    |
| ~~M4~~ | ~~Switching profile tab discards unsaved edits.~~ Done `dda07e4c`.                                               | A dirty flag and `useConfirm` before the switch.           | Nobody retypes a bio after glancing at another tab.              | `me/profile/ProfileTabs.tsx:86-92`                             | M    |
| ~~M5~~ | ~~The notification inbox has no dates, and says "empty" while loading or signed out.~~ Done `de65be0c`.          | Show the time; add loading and sign-in states.             | "Piste 3 delayed 20 min" can be told from this morning's notice. | `notifications/NotificationSettingsClient.tsx:24, 98, 277-298` | S    |
| ~~M6~~ | ~~An instructor's attendee list never retries after one failed load.~~ Done `805d8b1f`.                          | Clear the error flag on reopen.                            | The roster arrives on the second tap, not after a full reload.   | `me/instructor/InstructorDashboard.tsx:~560-575`               | S    |
| ~~M7~~ | ~~Referee history is ordered by number of bouts, not by date.~~ Done `0c886b5b`.                                 | Sort by the latest bout.                                   | Yesterday's bouts come first.                                    | `profile/referee/RefereeProfileClient.tsx:243`                 | S    |
| ~~M8~~ | ~~The security page is blank while loading; Enter does not submit.~~ Done `c0db46e5`.                            | A spinner and a real `<form>`.                             | Password managers and keyboards work.                            | `me/security/page.tsx:51-72, 129-160`                          | S    |

## O — the organiser (`apps/web-admin/app/org/[slug]/events/[eventId]`, shortened to `EV`)

| #      | Today                                                                                                                                                                                                | Fix                                                                                  | What it brings                                                                  | Where                                                                                                          | Size  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----- |
| ~~O1~~ | ~~✔ Picking "completed" in a Tournament's status menu applies at once and notifies followers that results are out. The server accepts any change. Switching back does not unsend.~~ Done `4f4a4993`. | Confirm before `completed` and `archived`, naming what will be sent.                 | No false "results published" from a slip of the mouse.                          | `EV/tournaments/page.tsx:175-184, 393`; `EV/page.tsx:208-215, 722`; `apps/api/.../events.service.ts:793`       | S     |
| ~~O2~~ | ~~One click on a placed Workshop's × deletes the session and every enrolment with it. No confirm, no undo.~~ Done `42ed9406`.                                                                        | `useConfirm` (already on that page), stating the enrolment count.                    | A mis-click while dragging cannot wipe a sign-up list on the day.               | `EV/workshops/WorkshopScheduleBoard.tsx:777-788, 896-903`; `page.tsx:828-837`                                  | S     |
| ~~O3~~ | ~~✔ A message to every participant goes out on one click. No confirm, no count.~~ Done `eceb8c88`.                                                                                                   | `useConfirm`, naming the audience and severity.                                      | No half-written or mis-targeted message to the whole hall.                      | `EV/notifications/page.tsx:103-122`                                                                            | S     |
| O4     | ✔ Broadcast failure and success look the same: one grey line.                                                                                                                                        | Split error from notice, or `useToast`.                                              | The organiser knows whether the hall was told.                                  | `EV/notifications/page.tsx:128, 131`                                                                           | S     |
| O5     | ✔ "Specific persons" has no select-all: 40 people is 40 clicks.                                                                                                                                      | "Select all shown" on the filtered list.                                             | Messaging one club or one Pool takes seconds.                                   | `EV/notifications/page.tsx:144-151, 210-241`                                                                   | S     |
| O6     | All three planning boards open on day 1, never on today.                                                                                                                                             | Default to the Event's "today" when it is one of its days.                           | On day 2 nobody drops a Pool onto yesterday.                                    | `EV/schedule/useScheduleData.ts:239`; `EV/workshops/WorkshopScheduleBoard.tsx:130`; `EV/referees/page.tsx:589` | S     |
| O7     | Pools, Swiss, print and archive forget the Tournament on refresh; dashboard links for Tournament #4 open #1.                                                                                         | Read and write `?tournamentId`, as the bracket page does; add it to the links.       | The organiser stays on the Tournament they are running.                         | `EV/pools/page.tsx:199`; `EV/swiss/page.tsx:87`; `EV/print/page.tsx:127`; `EV/page.tsx:669-699`                | S     |
| O8     | A refused referee assignment shows its reason behind the open picker.                                                                                                                                | Show it inside the picker.                                                           | The organiser sees why and picks someone else, instead of clicking again.       | `EV/referees/page.tsx:987, 1344, 1434-1443`                                                                    | S     |
| O9     | The referee picker has no search.                                                                                                                                                                    | An autofocused filter input.                                                         | A named referee is two keystrokes away.                                         | `EV/referees/_components/CandidatePicker.tsx:42-79`                                                            | S     |
| O10    | A failed load of one Tournament's penalty reviews looks like "nobody to review".                                                                                                                     | Show the existing error banner, naming the Tournament.                               | A pending disqualification is not missed because of a network blip.             | `EV/penalties/page.tsx:104`                                                                                    | S     |
| O11    | Dismissing a penalty review is one click beside "Confirm DQ"; resolved rows carry no date.                                                                                                           | Confirm on dismiss; disable while saving; show the date.                             | A mis-tap does not quietly close a disqualification case.                       | `EV/penalties/page.tsx:208-214, 228-243`                                                                       | S     |
| O12    | ✔ The new-Event wizard loses four steps of input on refresh or on "Back".                                                                                                                            | `useConfirm` when the form differs from empty.                                       | No retyping of dates, venue and pistes after a stray click.                     | `org/[slug]/events/new/page.tsx:856, 1125, 1222`                                                               | S     |
| O13    | In the same wizard, a retry after a partial failure says "slug already taken".                                                                                                                       | Remember the created Event and skip that step on retry.                              | No confusing error, and no half-built Event nobody knows about.                 | `org/[slug]/events/new/page.tsx:988-1009, 1038-1041`                                                           | S–M   |
| O14    | The Tournament wizard says "created" straight after a failed publish.                                                                                                                                | Word it "saved as draft" when publish failed.                                        | Nobody believes a draft Tournament is live.                                     | `EV/tournaments/new/_wizard/WizardShell.tsx:54-60`                                                             | S     |
| O15    | Tournament settings tabs drop unsaved edits on tab switch; the page never names the Tournament.                                                                                                      | Keep tabs mounted; show the name.                                                    | Settings are not lost, nor applied to the wrong Tournament.                     | `EV/tournaments/[tournamentId]/settings/page.tsx:51-65, 96-104`                                                | M     |
| O16    | Adding walk-ins closes the window after each person; Enter does not save.                                                                                                                            | "Save and add another"; a real `<form>`.                                             | A queue at the desk moves at typing speed.                                      | `EV/persons/page.tsx:466-479, 624, 1559-1902`                                                                  | S–M   |
| O17    | CSV import: the final screen counts skipped and invalid rows without listing them; reasons come in English from the server.                                                                          | List the rows (the data is already in the report); send a reason code and translate. | The organiser knows whom to add by hand, in their language.                     | `EV/persons/import/page.tsx:589, 606-611`; `apps/api/.../persons/csv-import.service.ts:131-178`                | S + M |
| O18    | CSV import: the dashed box does not accept a dropped file, and there is no template.                                                                                                                 | Drop handlers; a "Download template" link.                                           | Fewer failed first imports from misspelt headers.                               | `EV/persons/import/page.tsx:337-357`                                                                           | S     |
| O19    | The roster has no export, and its filters are lost on refresh.                                                                                                                                       | CSV of the filtered list via `escapeCsvCell`; filters in the address.                | A check-in list for the desk in one click.                                      | `EV/persons/page.tsx:152-157, 1004-1021`                                                                       | M     |
| O20    | The Pool standings CSV garbles accents in Excel and has English headers.                                                                                                                             | Mirror `EV/finalranking/page.tsx:117-123`.                                           | "Géraldine" opens as "Géraldine".                                               | `EV/pools/_tabs/StandingsTab.tsx:163-170, 183`                                                                 | S     |
| O21    | "Print / PDF" does nothing under a popup blocker, on final ranking and on referee pay.                                                                                                               | The message the print pack already shows.                                            | The organiser allows popups, instead of thinking print is broken at the awards. | `EV/finalranking/page.tsx:131`; `EV/compensation/page.tsx:231`                                                 | S     |
| O22    | The print pack prints one Tournament at a time.                                                                                                                                                      | An "All Tournaments" option.                                                         | One print job at 8 a.m. instead of four.                                        | `EV/print/page.tsx:308-325`                                                                                    | M     |
| O23    | Archive restore: after previewing file A, choosing file B keeps A's preview and restores B.                                                                                                          | Clear the preview when the file changes.                                             | Nobody restores an archive they never looked at.                                | `EV/archive/page.tsx:121, 289-296`                                                                             | S     |
| O24    | Saving referee pay rates gives no confirmation.                                                                                                                                                      | `toast.success` on each save.                                                        | No reloading to check that money settings were kept.                            | `EV/compensation/plan/page.tsx:228-292`                                                                        | S     |
| O25    | Removing a piste from a venue is instant and a refusal is silent; Enter does not add a piste, there or on the schedule board.                                                                        | The `confirm()` already in that file; a toast; Enter-to-add.                         | Six pistes are six "type, Enter"; none vanishes by accident.                    | `org/[slug]/venues/page.tsx:521-554, 654-699`; `EV/schedule/grid.tsx:1754-1794`                                | S     |
| O26    | The schedule board forgets Blocks / Detailed view on reload. Its four other settings are kept.                                                                                                       | A fifth entry in `useSchedulePrefs`.                                                 | One click less after every reload on the day.                                   | `EV/schedule/grid.tsx:424`; `useSchedulePrefs.ts:30-33`                                                        | S     |
| O27    | The reset-PIN prompt shows neither the PIN rule nor whose PIN it is.                                                                                                                                 | Pass the hint and the name (`PromptDialog` takes `description`).                     | The PIN is right first time, for the right person.                              | `EV/staff/StaffRoleSection.tsx:36`                                                                             | S     |
| O28    | ✔ Match detail is a dead end. The page already receives the Tournament and Pool; it does not use them.                                                                                               | One more breadcrumb.                                                                 | Back to the Pool in one click after checking a bout.                            | `EV/matches/[matchId]/page.tsx:85-134, 505-518`                                                                | S     |
| O29    | Pool matches have no name filter.                                                                                                                                                                    | A name filter and "hide completed".                                                  | "When does Martin fight?" is answered without scrolling 60 rows.                | `EV/pools/_tabs/MatchesTab.tsx:106-115`                                                                        | M     |

## X — one class of bug across all three apps (hard rule 6)

| #   | Today                                                                                  | Fix                                           | What it brings                                                    | Where                                                                                                                                                          | Size |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| X1  | Statuses and roles appear as raw English enums (`running`, `halted`, `workshop_lead`). | One label helper per domain, en + fr.         | A French organiser reads French; nobody asks what "halted" means. | `EV/tournaments/page.tsx:406`; `EV/page.tsx:464`; `EV/pools/_tabs/MatchesTab.tsx:775`; `org/[slug]/settings/page.tsx:182`; pad `ScoringCenterControls.tsx:354` | M    |
| X2  | A fighter with no name shows as an id fragment (`Reg 1a2b3c4d`).                       | "Unknown fighter", en + fr.                   | No code read aloud at the table.                                  | `EV/bracket/page.tsx:538`; `EV/pools/_tabs/MatchesTab.tsx:230`; `EV/persons/page.tsx:840`                                                                      | S    |
| X3  | Breadcrumbs show the organisation's slug, not its name.                                | Use the name the Events list already loads.   | The organiser reads their club's name.                            | `EV/tournaments/page.tsx:250`; `EV/persons/page.tsx:985`                                                                                                       | S    |
| X4  | Platform admin pages have hardcoded English headings.                                  | Move to keys, as `admin/ai/page.tsx:71` does. | The admin area follows the same rule as the rest.                 | `admin/leagues/page.tsx:273-275`; `admin/clubs/page.tsx:786`; `admin/feature-flags/page.tsx:133`                                                               | S    |
| X5  | Search boxes and form fields with a placeholder and no accessible name.                | `aria-label` from the placeholder key.        | Screen-reader users can tell the fields apart.                    | `t/[tournamentSlug]/PoolMatchesView.tsx:248-254`; `EV/staff/CreateStaffAccountForm.tsx:40-88`                                                                  | S    |

---

## Needs the operator's ruling before it is built

1. **"End match" is one tap, and Re-open does not work offline** (✔ `ScoringCenterControls.tsx:437-445, 630-636`).
   Story: the official means Pause, hits End match just under it, and the wifi is down — the bout
   stays ended until the network returns. A confirm only when neither the cap nor the time is
   reached would not slow a normal end. Ruling needed: confirm, or leave it.
2. **A bout cannot be started offline** (✔ `MatchView.tsx:288`, hit buttons gated at `:429-432`).
   The pad says "No connection" and nothing queues. Hits and undo work offline; the clock does not.
   That is a design change, not a quick win — named here because hard rule 3 says full offline.
3. **Show a bout's names from the local cache when opened with no network** (extension of P3).
   `src/offline/cached-reads.ts` says "serve no stale scoring data", so this reverses a written
   decision.
4. **"Next match" offline, for a bout never opened**, lands on "We could not check who is signed
   in" with a Retry that loops (✔ `public/sw.js:108-113`, `app/page.tsx:46-49`). The fix depends
   on ruling 3.
5. **`/e/[slug]/people` is orphaned** (✔ no link reaches it). Remove it, or link it from F7?

### Rulings — operator, 2026-10-08

| #   | Ruling    | What it means                                                                                                                                                                                                                                |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Yes**   | "End match" asks for confirmation when neither the cap nor the time is reached. A normal end stays one tap. Done `e0f9096f`.                                                                                                                 |
| 2   | **Yes**   | A bout can be started with no network. A design change: it needs its own plan before any code.                                                                                                                                               |
| 3   | **Yes**   | A bout opened with no network shows its names from the local cache, with the score marked unconfirmed. This reverses "serve no stale scoring data" in `apps/web-staff/src/offline/cached-reads.ts`; that comment changes in the same commit. |
| 4   | **Yes**   | "Next match" with no network reaches the next bout. Built on ruling 3.                                                                                                                                                                       |
| 5   | **Later** | `/e/[slug]/people` stays as it is for now.                                                                                                                                                                                                   |

### Rulings — operator, 2026-10-09 (while P1 to P4 were built)

| #   | Asked with this story                                                                                                                                                     | Ruling                                                                                                                                                                                                                            | Done                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 6   | Round 1 just ended. A second tablet on the same bout still shows a live Resume, taps it, and the server starts the clock while nobody fights.                             | **Yes**: the server refuses a clock Start or Resume while a round waits for "Start round N+1". Halt, End, Reopen and Reset stay.                                                                                                  | `d1db074f`               |
| 7   | The clock is at 0:00, Space opens the "clock should not restart" warning, and Space presses the focused button. Which button takes the focus?                             | **Close**: a second Space only closes the warning. On the round-break screen the only button is "Start round N+1".                                                                                                                | `88c3520e`               |
| 8   | The pad's tests cannot render a screen. How is "the alert is on screen" or "Space sends nothing" proved?                                                                  | **Pure functions, text pins, and one stubbed browser spec per row** in `tests/a11y/pad-*.spec.ts`. No React test setup for the pad.                                                                                               | `4511bc52` to `d1db074f` |
| 9   | For ruling 3. The wifi is down, the official swipes down by mistake and the pad reloads. The tablet remembers the bout from its last good read. What may the official do? | **Keep scoring**: the full bout screen opens from the tablet's memory, hits and cards go to the queue, and a notice says the score is the last one confirmed plus this tablet's hits. The clock waits for the network (ruling 2). | not built                |

### Rulings — operator, night of 2026-10-09 (rulings 2 and 3 are planned as one design)

The operator asked "any way to keep the clock going even offline?". That is ruling 2. The answer
to the order of work was **plan the clock first, build nothing yet**: rulings 2 and 3 get one
plan, and no code before it is approved. Ruling 4 is planned after, and asked again.

| #   | Asked with this story                                                                                                                                            | Ruling                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | On Sunday, with no wifi, an official opens a bout of Saturday. The tablet still has its copy, "running, 3-2".                                                    | **It opens, with its date shown.** The notice says the day and time the copy was read. The pad blocks nothing by the age of a copy.                                                                                                            |
| 11  | No wifi for an hour. A pool bout reaches its time, 5-3, and the official presses End match.                                                                      | **End on the tablet, confirm later.** The pad checks the rules it knows, shows the bout as ended and not confirmed, and the table moves on. The End goes out with the queue. A refused End puts the bout back to paused and sits in the inbox. |
| 12  | Tablet A, offline, starts the clock at 10:00 and stops it at 10:01. Tablet B, online, started it at 10:00:05. A's presses reach the server while the clock runs. | **Drop what is already true, hold the rest.** A press that asks for the state the clock is in is taken as done. A press that still makes sense is applied. A press that fits nothing is held in the inbox with its reason.                     |
| 13  | A best-of-3 bout with no wifi stops at "Start round 2". A level bout at time stops at "Extra time".                                                              | **A whole bout of any format runs offline**: Start, Halt, Resume, End, "Start round N+1" and the level-bout steps. Reopen, Reset, the time adjustment and the other corrections still need the network.                                        |
| 14  | No wifi. The official opens the next bout from the tablet's copy; the server has it as "scheduled".                                                              | **It may be started.** The hits follow the Start in the queue, in order. A Start the server refuses later is held in the inbox with the hits behind it.                                                                                        |

**The plan** for rulings 2 and 3 is `C:\Users\Tony\.claude\plans\offline-bout-plan.md` (on the
operator's machine, not in the repo): six slices. The operator said "go, in that order" on
2026-10-10, and two more rulings:

- **A press the server refuses stops the rows of its own bout behind it.** The inbox shows one
  line, which says how many hits wait behind it. Other bouts keep sending.
- **Open: does the clock use the queue with a good network too, or only with none?** The operator
  was torn. Ruled on 2026-10-10, below.

Four rulings on 2026-10-10, at the start of slice 3. The first was asked with a working model of
the two choices on a screen:

| Asked with this story                                                                                                                                     | Ruling                                                                                                                                                                                         | Done       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| The wifi is slow: 3 seconds per answer. The official taps Start as the fight begins. With a network, does the press wait for the server?                  | **Act at once.** The clock moves on the tap, always, and the press is sent behind. One path for wifi and no wifi. A refusal comes a moment later: the clock goes back, and the reason is said. | `d89978bf` |
| An Event finished on Sunday. On Monday a tablet sends a clock press from Sunday, and the person signed in is a super admin.                               | **Refused to everybody**, a super admin included, as slice 2 built it.                                                                                                                         | `eea8c8e6` |
| A tablet is left in a bag for a week with a Halt in its queue. Next Saturday it finds wifi and sends the press.                                           | **The server refuses a press made more than one day before its send.** The tablet itself still blocks nothing by age (ruling 10).                                                              | `dd079586` |
| An official opens three bouts, signs out and hands the tablet over. The tablet still holds the copy of each bout: the two names, the clubs and the score. | **The copies stay.** The next official at the table can open a bout with no network.                                                                                                           | no change  |

**Slice 1 is built: `2c281b70`.** A bout the tablet has read opens with no network, from the
tablet's copy, and takes hits and cards.

**Slice 2 is built: `eea8c8e6`.** The server takes a clock press that a tablet sends late: a Start,
a Halt, a Resume or an End, with an id the tablet made and the tablet's times of the press and of
the send. It is pushed with slice 3.

**Slice 3 is built: `dd079586`, `b1e5f718`, `28a02965`, `92ff7da4`, `d89978bf`, `fd814eea`.**
The clock runs on the tablet. Start, Pause, Resume and End match act on the tap and go through the
tablet's queue with the hits, in the order of the bout. End match shows the tablet's own result,
marked "not confirmed", until the server's row says the bout is completed. A press the server
refuses is held in the inbox, is said at the clock, and stops the rows of its bout behind it.
The last piece is `fd814eea`: a hit and a card send their send time too. The server stops the
clock by itself in three places (a hit or a card at the cap, a round that closes, the forfeit of a
black card), and it now writes that End or Halt at the time of the hit or the card, not at the
time of arrival. Before, a black card given with no network while the clock ran made the bout's
active time too long by the whole time with no network.
Slices 4 to 6 are not started.

**The lists of hits and cards are kept on the tablet: `adacd5c9`** (2026-10-10). A bout opened
with no network lists the hits and the cards of the tablet's last good read, under the ones the
queue holds.

Named while the lists were kept, and not fixed (each one checked in code by a review):

- The bout and its lists are kept by separate reads. When a list is kept and the bout's read of
  the same moment is not, a hit whose answer was lost reads in the list and not in the score. The
  score on the copy is then one hit low until the network is back, and "End match" reads that
  score. Written in `docs/ARCHITECTURE.md` 10.4.
- A list route answers an empty list, not a refusal, to a caller it does not know. A read made
  with a session that has ended on a hidden Event replaces a good kept list with an empty one.
- The notice of a copy gives one date, the bout's. The lists can be from another read.
- A pad reloaded with no network numbers its next hit from its own queue. When another tablet
  scored the bout before, the number can collide, and the pad sends the hit once more under a number
  read from the server. The kept list now holds the number to start from; nothing reads it.
- A double that another tablet took back after the last good read still counts on the copy.

Three rulings on 2026-10-10, before slice 4 (rounds with no network):

| Asked with this story                                                                                                                                                           | Ruling                                                                                                                                                                                                                                                                                              | Done                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| A best-of-3 bout, no wifi. Red reaches the cap in round 1. With wifi the server says "round over". The server judges with the Tournament's ruleset, which is not on the tablet. | **The tablet closes the round at the cap**, or at the doubles limit, from the score it shows, marked "not confirmed". The official taps "Start round 2". When the server counts another way, "Start round 2" is held with the rest of its bout behind it, and the screen goes back to the server's. | server `6ceb204b`, pad not built |
| No wifi: hit 1, hit 2, hit 3, "End match". The server refuses hit 2. Hit 3 and the End still went, and the bout ended on the server without hit 2.                              | **A held hit stops the rows of its own bout behind it**, as a held clock press does. One line in the inbox says how many wait. Retry or Discard frees them. Other bouts keep sending. This replaces the older ruling for hits.                                                                      | `c626976b`                       |
| A session has ended and the queue holds only a Pause. The bar says "HITS NOT SENT".                                                                                             | **"ENTRIES NOT SENT"**, in the four sentences of the bar, with the matching French ("SAISIES NON ENVOYÉES").                                                                                                                                                                                        | `06694b47`                       |

Named while "a held hit stops its bout" was built, and not fixed (each one checked in code by a
review):

- A refusal about a whole bout now shows one row at a time. An Event closes with 12 rows of one
  bout unsent: the inbox lists one row and "11 wait behind it". Each Discard sends the next row,
  which is refused in turn, so the official confirms 12 Discards. Before, the inbox listed the 12.
  The same holds for a tablet off its piste and for a locked bout.
- The result screen ("ended on this tablet, not confirmed") covers the bar's Review button and
  the notice at the clock. With an End that waits behind a refused row, the official must Close
  the result first. It was so for a refused clock press already.
- With a held row of a bout and queued rows of that bout only, nothing is sent, so a session that
  has ended is not seen until a row of another bout is sent.
- A bout that holds one row a new send can cure and one it cannot: Retry on the bar puts the first
  back in the queue, where it waits behind the second. Discard of the second frees it.
- An undo of a hit that is out and is then refused removes the held hit, and its bout stays on
  hold until the next send starts.
- A hit queued between the two steps of a Discard is not sent by that Discard. The next press
  sends it.
- The bar counts a refused card as a "hit", and says "the match" when refused hits are of two
  matches.

Two rulings on the evening of 2026-10-10, while the server side of slice 4 was planned:

| Asked with this story                                                                                                                                                               | Ruling                                                                                                                                                                                                                         | Done                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| A best-of-3 bout, no wifi. Round 1 runs out of time at 3-2 and the official taps "End round". Today that button needs the server.                                                   | **The tablet takes "End round" on time, as it takes "End match".** The round closes for the leader, marked "not confirmed". A refusal is held with the bout's rows behind it. A level round goes to the level steps (slice 5). | server `e0c6059e`, pad not built |
| The official taps "Start round 2". The server opens round 2 and fails to put the clock back to 0:00. It opened the round anyway, with round 1's time on the clock, and told nobody. | **The server refuses, and the tablet sends again.** Nothing opens with a wrong clock. This also changes the button as it works with wifi: the official sees an error and taps again.                                           | `6ceb204b`                       |

**Slice 4a is built: `6ceb204b` and `e0c6059e`** (2026-10-10). The server takes a "Start round N+1"
and an "End round" that a tablet made with no network and sends later: once, at the time of the
tap. A hit or a card sent while a round waits is refused with a code. Nothing on a screen changes
yet: the tablet's side is slice 4b.

Named while slice 4a was built, and not fixed (each one checked in code by a review):

- An "End round" tapped before somebody reopened that round, and sent after, closes the round
  again when the server never took it. A press the server already took does not.
- A late "End round" closes the round for the leader the SERVER reads when the press arrives. A
  hit voided on another device meanwhile can give the round to the other fighter than the tablet
  showed.
- Two tablets that send "Start round 2" within a few milliseconds: the second can put a clock
  the first one already started back to zero.
- When the server opens a round and then fails to read the score again, the score of the closed
  round stays on the bout until the next hit.
- "Start round" and "End round" pressed with wifi on an archived Event are refused in English
  with no code. The clock's buttons already were.
- A best-of bout moves its winner on in the bracket only when the server ends the clock. That
  step can fail in silence, and a second send of the press does not repair it. It was so before.
- The tablet has no words yet for the two new refusals (`round_not_waiting`, `round_not_open`).
  They are slice 4b.

Three rulings on the night of 2026-10-10, before the tablet's side of slice 4 (slice 4b):

| Asked with this story                                                                                                                                                                                                                 | Ruling                                                                                                                                                                           | Done      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| No wifi, best-of-3. Red reaches the cap in round 1. The tablet opens "Round 1 complete" by its own count; the server has not seen it.                                                                                                 | **The screen of today, plus one line under the score: "Closed on this tablet, not confirmed."** The line goes when the server has confirmed the round.                           | not built |
| Same bout, round 2. Red reaches the cap again: 2 rounds to 0, decided on the tablet, still with no wifi.                                                                                                                              | **The result screen, as after "End match" with no network** (ruling 11): marked "ended on this tablet, not confirmed", with the rounds won and "Next match". The table moves on. | not built |
| Best-of-3, round 1, clock at 0:00, red leads 3-2. The official taps Resume; the warning "the clock should not restart" has an "End match" button. Today it ends the WHOLE bout with no winner and no round closed, with wifi as well. | **On a best-of bout that button reads "End round" and ends the round**, as the "End round" button does. A level round gets the sentence it gets today.                           | not built |

**Slice 4b is planned** (the plan file's section 14: seven commits) **and its first two commits
are built.** `5c9dd3b6`: the rule "is this round over by itself, and for whom" is one function
apart from its score, for the server and soon the tablet. `a67198c1`: the doubles chip of the
pad counts the doubles of the open round of a best-of bout, and shows the doubles limit only
where the server applies it (a Pool and a Swiss round); the "DOUBLE LOSS" banner reads how the
bout ended, as the TV does. Before, in round 2 of a best-of-3 with two doubles in round 1, the
chip read 2/4 in warning colours, and a bracket bout showed a limit that ends no bracket bout.

Named while the doubles chip was fixed, and not fixed (each one checked in code by a review):

- ~~A Tournament whose ruleset has no doubles limit still shows one on the pad: the route that
  gives the pad its rules does not drop it, and the server's scorer does.~~ Done `35c028b2`.
- The chart of a finished bout, on the pad, on the TV and on the public Match page, writes
  "doubles 1/4" on a bracket bout: it reads the limit with no phase.
- The chip's tooltip says "per match" in both languages. In a best-of bout it is per round.
- A bout read without its names (the second read did not land on weak wifi) has no phase on the
  pad. The chip then shows no limit on a Pool bout until the next read. That bout also reads as
  a single round, and with the default rules.

**Commits 3 and 4 of slice 4b are built** (2026-10-11). `35c028b2`: the route that gives the pad
its rules answers the doubles limit the server scores with. For the points-cap ruleset, and for a
club's own copy of it, the pad shows no limit now, as the server applies none. The route and the
scorer build the match format with the same two functions. `688a9747` (pushed with commit 5):
"Start round N" and "End round" are a fourth kind of row in the tablet's
queue. Such a row is kept and sent as a clock press is: it takes no number of the bout's
sequence, it never passes a hit of its bout that was not sent, and no row of its bout passes it.
A refusal holds it in the inbox with its button, its round and its reason, and the rest of its
bout waits behind it. Each hit and card is queued with the round open on the tablet.

**Commit 5 of slice 4b is built: `d43507ed`** (2026-10-11). A best-of bout runs on the tablet
with no network. Red reaches the cap in round 1: the round-break screen opens at once, from the
score on the tablet, with the line "Closed on this tablet, not confirmed." "Start round 2" works:
the score and the clock go to zero and round 2 is played. "End round" gives the round to the
leader the same way. When the series is decided on the tablet the result screen opens, not
confirmed, with the rounds won. When the network is back the tablet sends the bout in the order
it happened. When the server counts another way, the screen goes back to the server's round: a
refused "Start round 2" is held in the inbox with the bout behind it, and with nothing refused
the screen takes the server's answer at the next read of the bout. The undo stops at a round the
tablet closed. A level round at its time still needs the network: the tablet says why.

Two choices in commit 5 are MINE, not the operator's. Say so if either is wrong:

- The result screen of a best-of bout shows the ROUNDS WON (2 – 0), before and after the server
  confirms it. Before, a confirmed best-of bout showed the points of its last round there (5 – 3).
  Ruling 2 of the night of 2026-10-10 said "with the rounds won" for the tablet's own result; one
  screen must not change its number when the server confirms it.
- Under reverse scoring (a bout that counts down from the cap) the tablet closes no round and
  opens none by itself. The score the tablet adds up there is not the server's score. With no
  network such a bout stops at the end of its round, as every best-of bout did before.

Named while commit 5 was built, and not fixed (each one checked in code by a review):

- The round-break screen cannot be closed. A hit tapped by mistake that takes a fighter to the
  cap cannot be undone there. After "Start round 2", with no network the undo stops at the closed
  round, and with a network it asks the server to cancel that hit. Question for the operator:
  does the round-break screen get an "Undo last entry" button?
- A tablet reloaded while it sends a bout of several rounds shows the rounds it had closed as
  0 – 0 with no winner until the bout is read again.
- With a queue of several bouts, the screen of one bout can stay for a moment on what it showed
  after its own rows are sent. It takes the server's answer at the next read.
- The corrections drawer still takes a card on a bout whose series is decided.
- ~~Left for the next commit of the plan: the resume warning's "End match" on a best-of bout still
  ends the bout with no winner.~~ Done `ef32a780`: it reads "End round" and ends the round.

**Commit 6 of slice 4b is built: `ef32a780`** (2026-10-11). Best-of-3, the clock at 0:00, red
leads. The official taps Resume and the warning "the clock should not restart" opens. Its second
button now reads "End round" and gives the round to the leader, as the "End round" button does;
its sentence asks "or end the round?". Before, it read "End match" and completed the bout with no
winner and no round closed, with wifi too. A bout of one round keeps "End match".

Named while commit 6 was built, and not fixed (each one checked in code by a review):

- The warning opens in the last seconds of the time too (the soft zone), and "the time is
  finished" starts at 0:00 only. A LEVEL round halted at 0:03: Resume, the warning, "End round",
  and the pad answers "level, but the time is not finished". A bout of one round does the same.
- The unstable Space test `tests/a11y/pad-space-behind-dialogs.spec.ts:100` failed once here with
  a new sign: the button read "Resume", Space was pressed, and the pad sent a clock START. The
  key handler read a clock from before the read of the bout. That is a fault of the pad, not of
  the test: for the work on the unstable tests.

Four rulings on 2026-10-11, at the start of the session:

| Asked with this story                                                                                                                                                              | Ruling                                                                                                                                                                             | Done       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| An organiser generates the Pools under ruleset A, then switches the Tournament to ruleset B before the first bout. The table is computed with B and every bout is scored with A.   | **The bouts not yet started take the Tournament's new ruleset.** Bouts started or finished keep theirs. A bout made through the "create a match" route takes its Tournament's too. | `e3316812` |
| A best-of-3 ends, red won two rounds, the last one 5-3. The result screen shows the rounds won (2 – 0); before `d43507ed` a confirmed bout showed the last round's points (5 – 3). | **Both**: the rounds won as the large number, and the points of each round in a small line under it.                                                                               | `a008f197` |
| Reverse scoring (a bout that counts down from the cap), best-of-3, no wifi. The tablet closes no round and opens none by itself there.                                             | **Build the countdown on the tablet**: such a bout runs with no network as any best-of bout does. A slice of its own, with its plan.                                               | `cf490fbb` |
| Red is at 4 of 5; the official means blue and taps red. "Round 1 complete" opens with one button, and the wrong hit cannot be taken back there.                                    | **The round-break screen gets "Undo last entry".** "Start round N" stays its first button.                                                                                         | `d9076f71` |

The "create a match" route (`POST /phases/:phaseId/matches`) has no button in any of the three
apps: only a direct call of the API reaches it. It stamped `TF_v1` unless the caller named a
ruleset; since `e3316812` it stamps the ruleset of its Tournament and takes none from the caller.

**The countdown on the tablet is built: `04269986` and `cf490fbb`** (2026-10-11). A bout that
counts down starts each fighter at the cap, a hit takes its points off the opponent, and the
fighter at zero loses.

- `04269986`, every countdown bout, of one round too: an unsent hit takes its points off the
  opponent's number at once. Before, with no network, red hit for 2 at 10 – 10 and the tablet
  read 12 – 10 until the hit was sent, where the server says 10 – 8. "End match" and the result
  screen read that wrong score. The small line under a number now says what the tablet holds of
  THAT number ("includes -2 not yet sent", under the opponent of the hitter).
- `04269986`: a countdown bout nobody has hit yet reads 10 – 10 on the tablet. Before it read
  0 – 0, as the TV and the public page still do (ruling below).
- `cf490fbb`: a best-of countdown bout runs with no network. A fighter reaches zero and the
  round-break screen opens, "Closed on this tablet, not confirmed." "Start round 2" puts both
  numbers back to the cap. The series is decided on the tablet, and the bout goes to the server
  in its own order when the network is back.

Two rulings on 2026-10-11, with the plan of the countdown:

| Asked with this story                                                                                                                                                                | Ruling                                                                                                                                                | Done       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A countdown bout, cap 10. Until the first hit the server's row says 0 – 0, so the tablet, the TV and the public page show 0 – 0; after red's first hit for 2 they jump to 10 – 8.    | **All screens read 10 – 10 from the Start, in a commit of its own**: the server computes the score when the bout starts. With its own recon and plan. | `19943e0c` |
| Best-of-3, round 1 ends on "End round" at red 2 – 0. On the round-break screen, with a network, "Undo last entry" cancels one hit: the screen reads 1 – 0 and stays up with no word. | **Undo and say so**: the undo still cancels the hit, and the screen says which hit was cancelled and that the round stays closed. A slice of its own. | `641cccaf` |

**A bug found while the countdown was planned, NOT fixed** (read in code, not run). Countdown,
afterblow mode "full", a phase that cannot end level (a bracket). Red and blue each have 1 point
left, and one afterblow takes both to zero. The round stays open, and no later hit can make a
leader: both scores are held at zero (`packages/rules/src/match-format.ts:611-614`, `:473`).
Only a card moves the score. On the tablet that round reads cap to cap, and each later hit shows
for a moment and goes back.

I then ran the engine on that story: red has 1 point left, blue has 2, one afterblow of 3 each
way. Both read 0 – 0. A Pool bout ends as a draw, whatever the points. A bracket bout stays
open, and two more hits leave it open at 0 – 0.

Two rulings on the afternoon of 2026-10-11, on that bug:

| Asked with this story                                                                                                                                          | Ruling                                                                                                                                                                                                                | Done                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Countdown from 5. Red has 1 point left, blue has 2. Red strikes for 3 and blue answers with an afterblow of 3: both are out of points (red at -2, blue at -1). | **The fighter less far below zero wins** (blue), in a Pool and in a bracket. The screens still stop at 0 – 0. A true tie (both as far below): a Pool bout is a draw, a bracket bout goes on and the next hit decides. | `c7cedc92`, `538b0e96`             |
| Which of the faults named with the countdown go into the same work?                                                                                            | **Three**: the reopened 0 – 0 bout, the round opened with its score not counted, the server's stale comment. With the ruling above on 0 – 0 before the first hit.                                                     | `538b0e96`, `b416adc0`, `b0d511d6` |

**The plan** of these rulings and of "all screens read 10 – 10 from the Start" is
`C:\Users\Tony\.claude\plans\countdown-zero-plan.md` (on the operator's machine, not in the
repo): seven commits, reviewed, NOT built. The operator asked for a handover with it; the next
session shows it and builds on "go". One thing in it differs from what the operator was told:
for the reopened 0 – 0 bout I offered "the server counts the score again at Reopen". That is
wrong. The server's 0 – 0 is right for such a bout, and a recount would end it again at once.
The fault is on the tablet, which reads every 0 – 0 in play as "not scored yet"; the plan fixes
it there, once the server counts the score at Start.

**Both at zero, and the score at Start, are built** (2026-10-11 evening): `c7cedc92` the rule,
`cff49b85` the server's tests, `19943e0c` the count at Start, `b416adc0` a resent "Start round",
`538b0e96` the tablet, `b0d511d6` the comment.

- Countdown, both fighters out of points on one afterblow: the bout, or the round, ends at once
  for the fighter less far below zero. The screens read 0 – 0 and name the winner. A true tie is a
  draw in a Pool; in a bracket the bout goes on and the next hit ends it. Before: a draw in a Pool
  whatever the points, and a bracket bout that could not end.
- The tablet does the same with no network. A round of a best-of bout closes for that fighter. A
  bout of one round is ended by the official: "End match" no longer asks "end now?" and no longer
  answers "the time is not finished", and the result screen names the winner, not "Draw".
- The TV and the public page read 10 – 10 from the Start of a countdown bout, not 0 – 0.
- A bout that ended 0 – 0 at the doubles limit and is reopened reads 0 – 0 on the tablet, not
  10 – 10.
- A "Start round 2" whose count failed on the server is repaired when the tablet sends it again.

Four things differ from the plan. Say so if one is wrong:

- The two tablet commits of the plan are ONE commit (`538b0e96`): they share one file and one doc.
- The plan review of the build session found that the plan did not cover a bout of ONE round on
  the tablet (the most common bout). It is built, with a browser story for a Pool and a bracket.
- The plan said: the tablet reads a 0 – 0 in play as real "when the server's list holds a hit of
  that round". The review found a hall story where that is wrong: the tablet's copy of the bout
  is from before the Start, the list already holds the first hit, and the tablet would close the
  round at its next unsent hit. The rule built is narrower: a 0 – 0 in play is real when the list
  of that round EXPLAINS it (both fighters earned the cap or more, or the doubles reach a limit
  that wipes the board).
- The plan said: a resent "Start round" counts again when the bout is in that round. The review
  found that this could complete a series a referee had just reopened. It counts again only
  while that round holds no hit and no card.

**A bug found beside this work, NOT fixed, and a question for the operator.** I ran the built
engine. A Pool bout that counts down reaches the doubles limit: both scores are wiped to 0 – 0.
The engine asks the point cap first, and under countdown 0 – 0 reads as "both at zero", so the
bout ends as a DRAW with the reason "first to points". The same bout counting up ends as a LOSS
FOR BOTH with the reason "max doubles". The Pool table then gives each fighter a draw where the
format says a double loss. It was so before this work. Question: in a bout that counts down, does
the doubles limit come before the point cap, as it does in effect when a bout counts up?

Four rulings on the evening of 2026-10-11, each a slice with its own recon and plan:

| Asked with this story                                                                                                                                                                                                          | Ruling                                                                                                                                                                                                   | Done       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A Pool bout that counts down, doubles limit 3. Red hits once, then three doubles: the board is wiped to 0 – 0, and the bout ends as a draw ("first to points"). Counting up, the same bout is a loss for both ("max doubles"). | **A loss for both**: in a bout that counts down the doubles limit is asked before the point cap, and the bout ends as the format's doubles outcome says.                                                 | `6b30e5bc` |
| An Event closes with 12 unsent entries of one bout on a tablet. The inbox shows one line, "11 wait behind it", and the official confirms 12 Discards, one after the other.                                                     | **Add "Discard all of this bout"**: one more button on that line, with one question that says how many entries go. One entry at a time stays possible.                                                   | `8dab2ce0` |
| Best-of-3, no wifi. "End round" is tapped on round 2 at 10:05. At 10:10 a referee reopens round 2 on another device. At 10:20 the first tablet sends its old "End round", and the server closes round 2 again.                 | **Refuse it**: the server refuses an "End round" and a "Start round" tapped before the bout's last Reopen, as it does for a press from before a Reset. The tablet holds it in the inbox with its reason. | `f2da59d8` |
| A Tournament has 150 bouts not started. The organiser saves the scoring pad's settings with nothing changed for the bouts: the server writes the 150 bouts again, and every screen gets 150 change notices.                    | **Write only the bouts that differ**: a bout not started is written only when its ruleset stamp differs from its Tournament's.                                                                           | `79757c14` |

**The doubles limit in a bout that counts down, and "End match" at the limit, are built**
(2026-10-11 night): `6b30e5bc` the rule, `a49a6e07` the server's tests, `c081faa9` the tablet.

One more ruling, asked with the plan of the first row above:

| Asked with this story                                                                                                                                                                                                                               | Ruling                                                                                               | Done       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- |
| A Pool bout of one round, no wifi, doubles limit 3. The official taps the third double, then "End match". The tablet shows "blue wins 2 – 1, not confirmed"; with the wifi back the server says "loss for both, 0 – 0". Counting up and down alike. | **In this slice**: the tablet's End at the doubles limit says what the format says, "not confirmed". | `c081faa9` |

- Server: a Pool or Swiss bout that counts down and reaches its doubles limit ends as the format
  says (a loss for both, a draw, or the result stands), with that reason. A round of a best-of
  bout the same. Before: a draw "first to points", or a WIN for the fighter a card had left
  ahead on the wiped board. A bout that counts up is decided as before.
- The order "point cap, then doubles limit" was written twice (a round, and a bout of one
  round). It has one owner now, `roundOutcome`.
- Tablet, a bout of one round at its doubles limit: "End match" ends it at once, with no
  question and no refusal, and the result screen says "Double loss", 0 – 0, "not confirmed".
  Before, a level board with time left was REFUSED ("the time is not finished"): with no
  network that bout could not be ended at all. The plan's recon found it; the ruling's story
  did not name it.
- Tablet, the result screen of any bout the server ended as a loss for both says "Double loss".
  It said "Draw", and with a card on the wiped board (-1 – 0) it named the leader as the winner.
  The cold review found the second one.
- The tablet still ends no bout of one round by itself, and does not stop hits after the last
  double: it behaves as at the cap. This is my choice, said with the plan, not a ruling.

Named while the doubles limit was built, and not fixed:

- A card on a wiped board: the server's row reads 0 and -1, the tablet's own result reads
  0 – 0 until the server confirms. Both say "Double loss".
- A best-of series whose every round was a double loss, decided on the tablet: the result
  screen says "Draw, 0 – 0" until the server confirms "Double loss".
- Under the format "draw at the limit", a round the tablet closed keeps its points on the
  round-break screen where the server writes 0 – 0 (`pad-series.ts`, the `wiped` test).
- A tablet that has not read the bout's phase, or its Tournament's rules, judges the limit
  with what it has: no limit, or the default limit of 4. The server decides.
- Countdown with the format "result stands": after a correction that leaves both fighters at
  zero AND the doubles at the limit, the bout is a draw, not "less far below zero". It cannot
  happen in live play.
- TF_v1 keeps version 1.0.0 though its end decision changed for bouts that count down. Bouts
  stored with the old reason are not rewritten.
- No cold review ran after the review's three fixes; the falsifier did (62 breaks, all red,
  and one line it showed to change nothing was removed).

**"Discard all of this match" in the inbox is built** (2026-10-11 late): `8dab2ce0`.

- A line of the inbox with entries of its bout waiting behind it has a third button, "Discard
  all of this match". One question says how many entries go ("Discard the 12 entries of this
  match?"). On yes the refused entries and the waiting entries of that bout leave the tablet in
  one step, and none is sent. Retry and Discard of one entry work as before.
- A line with nothing behind it does not have the button: its Discard is the same act.
- The cold review found one fault, fixed in the same commit. The bout's screen read "an entry
  is refused" and the waiting entries through two reads. After the discard, a best-of bout
  could close a round on entries the tablet no longer held, and keep that round-break screen
  with no network. The two are one read now (`usePendingOutbox`).

My choices, said with the plan, not rulings:

- The tablet deletes and asks the server nothing. An entry that met a server fault earlier, and
  that the server did take, stays on the server; the bout's list shows it at the next read.
  The 12 single Discards re-sent it and learned that.
- The deleted entries are not written to the tablet's list of undos: the tablet voids nothing
  on the server for them.

Named while "Discard all" was built, and not fixed:

- The score of an "End match" that was discarded stays in the screen's memory. It shows for a
  moment if the server then ends the bout by itself (a deciding hit), until the bout is read
  again (`endScoreOf`, `offline/pad-clock.ts`). The Discard of one held End has the same fault.
- Two tabs of the pad on one tablet: each has its own send, so one tab can delete an entry the
  other is sending. It was so before, for every action of the inbox.
- A listener of the engine's state that throws right after a refusal makes the send file that
  entry as "no network", and the next entry of the bout passes the refused one
  (`sync.ts`, `sendEntry`). Far-fetched; found by the review, older than this work.
- A confirmed "Discard all" whose line another tab already dealt with deletes nothing and says
  nothing: the list is read again and the line is gone.
- No browser story runs a best-of bout through "Discard all": the fault the review found is
  held by a text pin of the one read, not by a story (the order of two reads cannot be forced
  in a browser).

**A press made before the bout was put back in play is refused: built** (2026-10-12):
`f2da59d8` the server, `183123f3` the tablet's words.

Two rulings on 2026-10-12, asked with the plan of that row:

| Asked with this story                                                                                                                                                                                                            | Ruling                                                                                                       | Done       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------- |
| A Pool bout of one round, a tablet with no wifi. "End match" is tapped at 10:05. Another tablet had ended the bout, and a referee reopens it at 10:10. At 10:20 the old "End match" arrives, and the server ends the bout again. | **The clock's presses too**: Start, Pause, Resume and "End match" follow the same rule, in this slice.       | `f2da59d8` |
| Best-of-3. A hit at the cap closes round 2 on tablet B. Tablet A taps "End round 2" with no wifi. The referee on B undoes that hit: the server puts round 2 back in play by itself. A's old "End round 2" then closes it again.  | **The undo too, now**: a round or a bout the server puts back in play after a correction counts as a Reopen. | `f2da59d8` |

- The server notes on the bout the moment it was last put back in play. Three things write
  it: a Reopen, a Start, a Pause or a Resume that takes the bout out of "completed"; a
  correction that hands a finished bout back to the referee; a correction that takes away what
  closed a round.
- A clock press or a round press that a tablet made before that moment, and sends after it, is
  refused. The tablet holds it in the inbox with its reason, in English and in French, and
  offers Discard alone: no new send can cure it.
- A press the server already holds is answered as before. A press that asks for what is
  already true is "done" as before. A hit or a card is never refused by this rule: the bout
  keeps its fight.

Four things differ from the ruling's words, or from what I told the operator. Say so if one is
wrong:

- **A field on the bout, not a line in the timeline.** The option the operator picked said "the
  server writes a line". The field is written in the same write that puts the bout back in
  play, so it cannot be lost between two writes. It needs migration `0222`, and the time shows
  in the public read of a bout.
- **A forfeit taken back does not count.** It puts the bout back as it was before the forfeit.
  A tablet that fought the bout with no wifi, under a forfeit recorded by mistake, keeps its
  presses. The plan review found this.
- **A Reopen on a bout that is not completed does not count.** It moves the clock alone. It is
  the Reopen that "Start round N+1" makes itself, and the Reopen a referee presses on a clock
  a forfeit ended, once the forfeit is taken back. The cold review found the second case.
- A forfeit recorded by mistake and undone with the clock's own Reopen, on the completed bout,
  does count: that door cannot tell it from a Reopen to correct a hit. Use "take the forfeit
  back" for a forfeit recorded by mistake.

Named while this was built, and not fixed:

- A tablet whose time of day is corrected forwards between a press and its send says a press
  older than it is. After a Reopen, such a press can read as "before" and be refused. The rule
  for a Reset has the same limit.
- The moment can move back. A tablet's late card (scored at 10:06) that puts a round back in
  play overwrites the moment of a Reopen made after it (10:10). A stale press of 10:08 from a
  third device then passes. It needs two tablets with no wifi on one bout.
- The corrections drawer can undo a hit, with a network, while an older round press of the same
  tablet still waits. That press is then held with Discard alone; before, it was held with
  Retry.
- A press and a Reopen in the same moment: the server reads the bout, the Reopen lands, the
  server writes the press. Every rule of a late press has this window of some milliseconds.
- The clock can put a bout back in play with its winner kept: a bout completed between the
  clock's read and its write of a Start, a Pause or a Resume (`ClockService.writeBout` has no
  "not completed" filter; `setStatus` has one). Older than this work.
- A forfeit taken back can leave a bout "running" with an ended clock. Older than this work.
- A person's Start, Pause or Resume on a completed best-of bout does not put back the round
  that ended the series; only Reopen does. Older than this work.
- The comment of `reopenClosedRound` says the clock stays halted. For a series the round had
  won, the clock is ended.
- No browser story holds a refused CLOCK press with this reason: the round press has one, the
  clock press has the unit tests.

Named while this was built, and not fixed (each one checked in code by a review):

- A bout decided "less far below zero", reopened with no correction, then ended with "End match":
  the End reads the bout's row, which is 0 – 0 with no winner. A Pool bout is then a draw. The
  first correction of the sheet counts it right again.
- The tablet cannot know how far under zero a side went for points the server already holds at
  zero. It knows only what its own unsent hits add.
- A Start with no id (no tablet sends one) whose count fails leaves the TV at 0 – 0 until the
  first hit. The failure is in the server's log.
- A card given before the Start whose own count failed: the row stays 0 – 0 and the Start does
  not count it (the sheet is not empty). The first hit repairs it.
- `PATCH /matches/:id/status` puts a bout to "running" with no clock and no count. Only the
  deployed-stack tests use it.
- The tablet adds up the server's list of a round as it adds its own hits. A ruleset that gives
  every hit one fixed value counts another way, and the server decides.
- When the tablet's list of hits is older than its copy of the bout, a real 0 – 0 reads cap to
  cap until the list lands.

Named while the countdown was built, and not fixed (each one checked in code by a review):

- A bout that the doubles limit ended at 0 – 0, or a Pool bout drawn at 0 – 0, that somebody
  reopens: the server's row is 0 – 0 and in play until the next hit. A countdown bout then reads
  cap to cap on the tablet.
- When the server opens a round and then fails to count the score again, the bout's row holds
  the closed round's score in the new round. A tablet that holds an entry of that round then
  closes it at once. It is so for a bout that counts up too.
- The server's own comment says a tablet with no network cannot have moved past a round
  (`apps/api/src/modules/penalties/penalties.service.ts:987-991`). That is no longer true.
- `Generic_PointsCap` and a club's formula ruleset give every hit one fixed value on the server;
  the tablet adds the value of the button. The tablet predicts, the server decides.

**The bouts not yet started take their Tournament's ruleset: `e3316812`** (2026-10-11). When an
organiser changes a Tournament's ruleset (the Tournament form, the audited change during an
Event, "Customise this format", the penalty rules), the server writes the new ruleset on every
bout of that Tournament that has not started. A bout that started, or is finished, keeps the one
it was fought under. A bout put back to "not started" by a reset, or by a bracket result taken
back, takes the Tournament's ruleset of that moment.

Named while this was built, and not fixed (each one checked in code by a review):

- ~~A forfeit taken back on a bout that was never started puts it back to "not started" with the
  ruleset it had.~~ Fixed, `6e96acc1`.
- A bout started on a tablet with no network is "not started" for the server. A change of the
  Tournament's rules at that moment moves it, and its hits are scored with the new ruleset when
  they arrive.
- The engine is read from the bout, and the settings of the ruleset (win bonus, match format) are
  read from the Tournament at the moment of each hit. After an audited change during an Event, a
  bout started before it is scored with the old engine and the new settings. It was so before.
- ~~Every save of the scoring pad's settings or of the match format writes each bout not yet
  started again, also when nothing changed for it.~~ Fixed, `79757c14`.
- Pools generated in the same seconds as a change of ruleset can land on the old ruleset. The
  next save of the Tournament's rules repairs them.

**A save writes only the bouts that differ: `79757c14`** (2026-10-12), with four more pieces the
operator added that day ("all four").

- A save of a Tournament's rules that changes nothing for its bouts writes no bout. Before, it
  wrote every bout not started: one change notice per bout on every screen. It also made a league
  read as "results changed since the ranking", because every write moves a bout's last-changed
  time and the league reads that time. The ruling's story did not name the league.
- Two doors gave a Tournament a new hash and left its bouts not started on the old one:
  "acknowledge the rules changed" on the settings page, and a change of the Event's default
  penalty rules. Both move the bouts now (`a9cdf706`).
- A forfeit taken back gives a bout that goes back to "not started" its Tournament's ruleset of
  that moment, as a reset does. A bout the forfeit found started keeps its own (`6e96acc1`).
- A Tournament's own hash is written only when it changed. A write of it that the database
  refuses is logged; the save still answers "saved" (ruled 2026-10-12). The settings page then
  shows its "rules changed" banner, and "acknowledge" writes the hash again (`6fef9f6a`).
- The filter was proved once against the real PostgREST (v14.16), with the real function: the
  API's test double cannot prove a filter string. The database of that run held the three tables
  with their real columns, not the whole set of migrations.

The cold review found one fault in my forfeit piece, fixed before the commit. A ruleset read that
failed for a later Pool bout of a withdrawal left the first bout restored, and every next try was
refused ("the match has been replayed"). Every ruleset is now read before the take-back writes
anything.

Named while this was built, and not fixed:

- "Acknowledge the rules changed" answers "done" also when the write of the hash failed. The
  failure is in the log now, and the banner comes back at the next read of the page.
- When the Tournament's row cannot be read at the moment its hash is computed, the hash is
  written as empty over a good one. Older than this work.
- Two saves of one Tournament's rules at the same moment: each writes the stamp it read, and the
  later write wins. Older than this work.
- A take-back of a withdrawal reads the ruleset of every Pool bout that goes back to "not
  started", also of a bout it then leaves alone because it is in play again.
- A change of an Event's default penalty rules gives its Tournaments a new fingerprint, and their
  bouts not yet started keep the old fingerprint. Nothing reads a bout's fingerprint today.
- A club's own ruleset can be edited or deleted once no Tournament uses it, while finished bouts
  still carry its name. The server then scores a correction of such a bout with TF_v1, and warns
  in its log.
- A read of a Tournament that fails while a bout is generated still gives that bout TF_v1, in
  silence. The new stamp refuses such a read; the older helper it sits beside does not.

**Slice 5 is built: a level bout runs with no network** (2026-10-12): `b6e3083c` the server,
`cd6ce459` the tablet. The plan is on the operator's machine
(`C:\Users\Tony\.claude\plans\pasted-content-id-02bb-repo-f-github-wild-yeti.md`).

One ruling on 2026-10-12, asked with the plan:

| Asked with this story                                                                                                                                                                                                                          | Ruling                                                                                                                        | Done       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A bracket bout, limit 3:00, fought with no pause, 3 – 3. The clock runs past 0:00 and the official taps "Extra time 60s" without Pause. The clock kept running, and (read in code, not run) the minute could be lost at once: "time finished". | **Pause, 1:00 on it**: the tap pauses the clock with the extra time on it. The official taps Resume. With wifi and with none. | `b6e3083c` |

- No wifi, a bracket bout at 3 – 3 and 0:00. "Extra time 60s" works: the clock reads 1:00,
  paused. After the minute, "Sudden death" works and the skull shows. A hit, then "End match":
  the result screen, "not confirmed". A level round of a best-of bout does the same, then "End
  round". Before, the button was greyed while a press waited, or it answered "No connection",
  and the bout could not go on.
- With wifi the button is the same: it acts on the tap and is sent behind.
- When the wifi is back, the tablet sends the bout in its own order. The server takes each step
  once, at the time of the tap. A step another tablet took already is "done".
- A step the server refuses is held in the inbox with its reason, in English and in French, and
  the rest of its bout waits behind it. The clock goes back to the server's.
- Server: a step is one line of the bout's timeline, and the extra time is on that same line.
  Before, the time was a second line: when that second write failed, the step was counted and
  the time was not given.
- A held "End match" or "End round" that the server refused on a level board is now said in the
  tablet's words. It was the server's English.

Things that differ from the plan. Say so if one is wrong:

- The two server commits of the plan are ONE commit: they share one file.
- The plan said: the bout's list on the tablet draws the step as a line. No list on the tablet
  draws a clock line, so nothing is drawn. The chart of a finished bout reads the step's time.
- The two new refusals ("the board is not level", "the server counts another step") answer 400,
  not 409. The tablet holds both the same way.
- The cold review changed four things. The tablet works out the extra time with the server's own
  function. A step that waits behind a refused step does not count the refused one. A refused
  step of a completed bout, or of a round that is over, offers Discard alone. The press with no
  id (no tablet sends it now) is no longer tried again by the server after another device wrote
  at the same moment: a second try could take the NEXT step.
- No red-first run: the code went in with its tests. The falsifier is the proof (77 breaks, 76
  red; the green one showed a line that changed nothing, removed).

My choices, said with the plan, not rulings:

- The undo stops at a step the tablet still holds, as at "Start round": the entries before it
  made the board level.
- The bar counts a refused step as a refused clock press.
- In sudden death the tablet ends no bout by itself: the official presses "End match".

Named while slice 5 was built, and not fixed (each one checked in code by a review, or said so):

- The server judges "is the time finished" on its own count of the clock. A Start whose send was
  slow (a login renewed first) is placed late, so the server's clock is behind the tablet's by
  that delay. A step tapped one second after 0:00 can then be refused "time not finished", with
  Discard alone. A late "End match" on a level bout has the same limit. Suspected, not seen.
- The press with no id is still on the server, and only the deployed-stack test
  (`tests/e2e/10-scoring-pad.spec.ts`) sends it. It could be removed.
- A row another device writes in the few milliseconds between the server's read of the bout's
  last line and its own write can sort after a late step. Every late press has this window.
- With wifi a step leaves the queue at once, so the undo then can cancel the hit that made the
  board level. That is a correction a referee may make.
- In a phase with NO time limit the time is always "finished": after the step the button shows
  the next step at once, and a second tap takes it.
- A Reset of the clock and a Reopen do not put the chain back to its first step. Only a reset of
  the bout and "Start round" do. Older than this work.
- A chain that is spent refuses "End match" on a level board with the sudden-death sentence.
- No browser story holds a refused step in the INBOX (its label, its Discard question): the unit
  tests and a text pin hold them. The story holds the notice at the clock.
- The deployed-stack tests were not run for this change. Their assertions on the level chain
  were read and still hold.

**Slice 6 is built: the offline drill, the tests against the deployed stack, the written rules**
(2026-10-12): `c5477a8d` the bar and the retry, `8949b7cc` the drill, `7c386e80` the tests, `562c3e07` the documents.
The plan is on the operator's machine
(`C:\Users\Tony\.claude\plans\pasted-content-id-170d-repo-f-github-quiet-castle.md`).

Three rulings on 2026-10-12, asked with the plan:

| Asked with this story                                                                                                                                                                                                                                                                                  | Ruling                                                                                                                                                                                                      | Done                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| An official taps "Practice going offline", opens a bout, taps Start, two hits and Pause. The banner says only "hits". With 1 or 2 entries the bar is red "SYNC ERROR"; with 3 it is grey. When the drill ends nothing is sent. An Undo, a Reopen, a forfeit or a correction really reaches the server. | **All of it**: the words name every entry; the queue is sent when the drill ends; a send that met only "no network" says OFFLINE, in a real hall too; the direct presses answer "no connection" in a drill. | `c5477a8d`, `8949b7cc` |
| The build at the address of the deployed-stack tests is from 2026-08-25. No test starts or ends a bout with no network, and none sends a press twice.                                                                                                                                                  | **Repair them and add both, written by reading.** The operator redeploys, then the tests are run and what is red is fixed.                                                                                  | `7c386e80`, not run    |
| The level step, "Start round" and "End round" still take a press with no id. No screen sends that form.                                                                                                                                                                                                | **They stay.** It is named here.                                                                                                                                                                            | no change              |

- A hall with wifi and no internet, one unsent hit: the bar is grey "OFFLINE", as with ten. It was
  red "SYNC ERROR" with a Retry. Red is for a fault the server answered, and while the inbox holds
  a refused entry.
- The tablet tries again by itself: while the bar says OFFLINE and entries wait, the bout screen
  sends again every 5 seconds. Before, the queue went at the next tap, at the browser's "online"
  event, or when a bout screen opened; a tablet that keeps its access point gets no such event.
- The drill's words say "entries", and name hits, cards, and the clock, round and extra-time
  presses, in English and in French.
- When the drill ends (its time, "End drill", or a tablet that wakes after it) the queue goes to
  the server in its order, with no tap.
- During a drill an Undo takes the entry off the tablet and asks the server nothing. Reopen,
  Reset, Unlock, a forfeit and each correction answer "No connection" and send nothing.
- A test counts every request the tablet's app makes, call by call, as stopped by the drill or
  left open with its reason. A new one fails it until it is named.
- The deployed-stack tests: a new one fights a whole bout with no network, a reload included
  (`tests/e2e/40-offline-bout.spec.ts`); a new one sends a Start, a "Start round 2" and a level
  step twice with one id (`39-late-presses.spec.ts`); test 10 checks that the level step is one
  line with its minute on it; test 16 asks the server's clock after each clock press. **None was
  run**: they were typechecked and collected.
- `docs/ARCHITECTURE.md` section 10 was read whole against the code. Stale: the list of the
  tablet's tables, the send diagram, the status list, 10.3. New: 10.5, the drill.

Things that are MINE, said with the plan or found by the review, not rulings. Say so if one is
wrong:

- **The 5-second retry.** Ruling 1 took the Retry button away from a tablet with 1 or 2 entries
  and wifi with no internet; the retry gives the send back. It stands still during a drill: the
  review found that each try that meets the drill counts against the entry, and the organiser's
  board shows an entry tried three times as a tablet that is stuck.
- **The bar stays red while the inbox holds a refused entry**, also when other entries met no
  network. The review found the other side of it: with three or more unsent entries the same
  tablet reads grey, because three failures in a row say OFFLINE whatever the inbox holds (older
  than this work). Question for the operator: with a refused entry in the inbox and no network,
  is the bar red or grey? **Ruled on 2026-10-13: red, always. Built `cb18a1d3`.**
- Unlock is stopped in a drill with the other direct presses.
- The two new deployed-stack tests are files of their own (39 and 40), not a second test of 06:
  06 would have crossed the 400-line budget.
- A 503 the server itself sends (not read-only mode) reads as OFFLINE with one entry, as it
  already did with three: the tablet reads any 503 as "the server is out of reach".

Named while slice 6 was built, and not fixed (each one checked in code, by me or by a review):

- During a drill the reads still reach the server (the bout, its lists, the piste's list). The
  screen "from the tablet's copy" does not show in a drill.
- The heartbeat still goes in a drill: the organiser's board reads the tablet's waiting entries.
- "End drill" in one tab leaves a second tab of the same tablet in the drill until its time.
- While the corrections drawer is open, a tap on "End drill" does not land: close the drawer
  first. Seen in the browser story.
- Each try of the retry that had an entry to send makes the bout screen read the bout again.
- No retry runs away from a bout screen: a queue left waiting on the piste list goes when a bout
  is opened, as before.
- The end of a drill by its TIME, and after sleep, has a text pin and no story: the story ends
  the drill by its button.
- Does a bout page the tablet already opened reload with no network under the real service
  worker? Not verified here (the browser stories block service workers). Test 40 settles it on
  the deployed stack.
- `apps/web-staff/src/components/MatchClock.tsx` is rendered nowhere, and
  `reconcileFromServer` (`offline/reconcile.ts`) has no caller. Both older than this work.
- The nightly run of the deployed-stack suite fails every night before any test: the public
  host serves a staging certificate.
- Test 16 confirms a card by the first sanction of the list's entry; the tablet asks on the card
  it resolved. With an earlier offence in scope the two differ.
- A French typo older than this work: "reconnecte" for "reconnecté" in the "no connection"
  sentence (`packages/i18n/src/messages/fr/scoring.ts`).

**The Space key on the tablet: `f14f8156`** (2026-10-11). Three browser tests failed now and then
(`pad-space-behind-dialogs.spec.ts:100` and `:150`, `pad-best-of-server-disagrees.spec.ts:92`, red
on CI once this session). The tests were right. For a moment after the screen changed, Space was
judged by the clock from before: it sent a Resume behind the result of a decided series, and a
Start on a halted clock. The listener is now in place before the screen is painted. All the Space
stories passed 320 times out of 320 after the fix. `tests/drag/schedule-grid.spec.ts:241`
(web-admin) is the one unstable test left, and it was not looked at.

**The points of each round are on the result screen: `a008f197`** (2026-10-11). Under the rounds
won ("2 – 0") the tablet writes one small line, "Points per round: 5 – 3 · 5 – 2", before and
after the server confirms. Not fixed, named before: a tablet reloaded while it sends a bout of
several rounds reads the rounds it had closed as 0 – 0 there until the bout is read again. No
cold review was run on this change (one line on one screen); its falsifier was.

**"Undo last entry" on the round-break screen is built: `d9076f71`** (2026-10-11). The screen has
a second button behind "Start round N". It takes the wrong hit back, with a network or with none,
and the round is in play again. One undo lands per round break: a second tap while the screen
closes takes back nothing more. The undo of the bout screen is one piece of code now, for the
controls and for this screen.

Named while the undo was built, and not fixed (each one checked in code by a review):

- A round closed by "End round" gives two answers. While that press waits on the tablet (no
  network) the undo is refused, and the screen says why. Once the server holds it, the server
  judges: with red 2 – 0, the undo cancels one hit, the screen then reads 1 – 0 and stays up with
  no word; a second undo is refused because 0 – 0 names no winner. Question for the operator:
  does the undo on the round-break screen refuse every round that "End round" closed?
- A tap on "End round" by mistake cannot be taken back on the round-break screen: the undo takes
  back a hit or a card, never a press.
- While the round-break screen is up, a reason the undo gave is drawn twice: in the screen, and
  under the controls' button behind it. A screen reader can say it twice.
- A tablet that sends an earlier hit of the bout at the same moment as the undo can keep the
  round-break screen up until the next read of the bout. Read from the code, not seen.

**The undo of a round "End round" closed says what it did: `641cccaf`** (2026-10-11). With a
network, round 1 is ended with "End round" at red 2 – 1 and the official taps "Undo last entry".
The entry is cancelled, the screen stays up on 2 – 0, and it now says: "Cancelled: #2 · Bo Blue ·
Clean hit +1. Round 1 stays closed." The entry is worded as the bout's list words it, with its
number there. Ruled with the plan: a second tap at the same round break cancels nothing more.
This answers the first point of the list above. A round the cap closed goes back in play as
before.

Named while it was built, and not fixed:

- An undo tapped in the moment after the server took "End round", before the bout is read
  again, makes the round-break screen close and open again. It then shows no line, and its one
  undo is given back, so a second tap cancels a second entry. Read from the code by the review,
  not seen. The window is one read of the bout.
- When the round on screen holds no entry, the undo cancels an entry of the round before. The
  line then names that entry and says the round on screen stays closed.
- A round the cap closed that one cancel does not take under the cap stays up with no word.
- The line is my wording of "which hit": the entry as the corrections drawer writes it. A card
  is named the same way. Not ruled.

**A bug found while commit 3 was built, NOT fixed, and a question for the operator.** A bout
keeps the ruleset it was generated with. An organiser generates the Pools of a Tournament under
one ruleset, then changes the Tournament's ruleset before the first bout (the Tournament form
allows it while no bout has started). The Pool table is then computed with the new ruleset, and
every bout is still scored with the old one: the tablet shows the new ruleset's buttons and
limits, and the server counts with the old ruleset's engine. The audited change of ruleset during
an Event leaves the bouts not yet started on the old ruleset in the same way, and a bout made by
hand is given TF_v1 whatever its Tournament says (`apps/api/src/modules/phases/match-ruleset.ts`,
`events.service.ts:3238-3298, 3510-3590`, `matches.service.ts:395-396`). Question: when a
Tournament's ruleset changes, do the bouts NOT YET STARTED take the new ruleset?

Named while commits 3 and 4 were built, and not fixed (each one checked in code by a review):

- The server reads a failed read of a club's ruleset as "no such ruleset" for 5 seconds, and
  scores with TF_v1 meanwhile. The pad's rules route then answers a doubles limit for a club's
  copy of the points-cap ruleset, and the tablet keeps that answer as fresh.
- Two more answers of the server give the doubles limit as the Tournament stores it
  (`staff.service.ts:1719, 1878`). The pad's chip does not read them.
- A late "End round" on a level round is held in the inbox with the server's English sentence,
  as a late "End match" on a level bout is today. The next commit refuses it on the tablet first.
- A hit tapped while a "Start round 2" of its bout is held in the inbox is queued with the round
  the screen shows. Nothing reads that round yet.
- A row of the queue with a round and no button named would go to the "Start round" door. Only
  one function writes such a row, and it writes both.

Also on 2026-10-10: the security scan of the marketing site's image accepts the four findings in
the Caddy binary that no Caddy release fixes (`6ffff8f0`, `apps/web-marketing/.trivyignore.yaml`).
Remove the entries at the next Caddy release. The two unstable browser tests wait until the
offline bout is done (operator). The Space key test has a sister with the same cause:
`tests/a11y/pad-space-behind-dialogs.spec.ts:100` failed with `:150` on CI run 38061928155.

Named while the last piece of slice 3 was built, and not fixed (each one checked in code):

- ~~"Edit as no exchange" on the pad is always refused: the pad sends three fields the route
  does not take, and the server answers 400.~~ Done `96818d5e`. The pad's body is typed by the
  route's own schema now.
- ~~The age of a hit or a card has no upper limit.~~ Ruled 2026-10-10 and done `2ffa26d0`: a hit
  or a card whose age reads over one day is taken, and the server stops the clock at the time of
  arrival. Under one day, a tablet whose time of day is corrected forwards between the hit and
  the send still gives an age that is too long.
- ~~Found by its browser test, which failed about one run in eight: the wifi comes back while a
  send that fails is still out, and the queue then waits on the tablet for the next press.~~ Done
  `d632ce37`.
- Two browser tests fail now and then, and CI's browser job needed three attempts on `2a2d5879`.
  `tests/drag/schedule-grid.spec.ts:241` ("Ctrl+Z re-creates a deleted programme bar") failed
  once on CI and was not looked at. `tests/a11y/pad-space-behind-dialogs.spec.ts:150` ("the
  resume warning opens on Close") fails 1 run of 40 here: the pad attaches its key listener in
  an effect, a moment after it draws the clock button, and the test presses Space inside that
  moment (`MatchView.tsx:655`).
- Another tablet's late press can be written between the server's read of the bout's last clock
  row and its own End. The End then sorts before that press, and the clock of a completed bout
  reads as paused or running. A late press has the same gap.
- The bout's end time is the time of arrival when its clock was never started or was already
  ended: only the clock's own End carries the time of the hit.
- "Scored before the last reset" still reads the tablet's time of day. With the send time it could
  read the server's time of the hit.
- The start of a round and its clock reset are still written at the time of arrival (slice 4).

Named while slice 3 was built, and not fixed (each one checked in code by a review):

- The pad judges "End match" on a level bout by its own clock. A tablet a few seconds ahead of the
  server can take an End the server then refuses as "time not finished". The End is held, and
  only Discard and a new End work.
- The age of a press is wrong in two cases, both between the press and the send: a time of day
  corrected forwards, and a time of day corrected backwards on a pad that was also reloaded.
- ~~With a session that has ended, the bar says "hits not sent" when the queue holds only a clock
  press.~~ Ruled 2026-10-10 and done: the bar's four sentences say "entries not sent".
- A double tap on Start can read as Start then Pause: the button is Pause as soon as the clock
  runs. With a fast network this was already so.
- ~~A held hit does not stop the rows of its bout. An End behind it reaches the server without it.~~
  Ruled 2026-10-10 and done `c626976b`: a held hit or card stops the rows of its own bout.
- Reopen, Reset, the end of a round and a level bout's remedy still need the network. Rounds and
  level bouts with no network are slices 4 and 5.
- `apps/web-staff/src/components/MatchClock.tsx` is used by nothing. It is older than this work.
- The deployed-stack tests (`tests/e2e/06`, `10`, `16`) were not run for this change.

Named while slice 2 was built, and not fixed (each one checked in code by a review):

- The server trusts the tablet for the age of a press (send time minus press time). A tablet whose
  clock is set between the press and the send gives a wrong age, and the age has no upper limit.
  Slice 3 must measure the age without the tablet's time of day.
- A press whose clock row is saved, and whose bout update then fails, is answered "done" at its
  next send. The failed update is an error now, where it was silent. Nothing repairs the bout.
- ~~When a hit or a card from the queue decides a bout, the server ends or halts the clock by
  itself with the time of arrival.~~ Done `fd814eea`.
- A clock press with no id, sent for an archived Event, is refused with an English sentence and no
  code. It was refused with the translated "this Event is archived" before.
- The referee statistics sort a bout's clock rows by time alone. Two rows can now hold the same
  time, and their order is then not sure there.

Named while slice 1 was built, and not fixed (each one checked in code by a review):

- ~~On a copy, the timeline, the doubles count and the card counts hold the queue alone: the lists
  of earlier hits and cards are not kept on the tablet.~~ Done `adacd5c9`: the tablet keeps both
  lists at each good read, and a copy shows them under the queue.
- ~~A hit the server took, whose answer was lost, can be counted twice on a copy.~~ Done
  `adacd5c9`: the kept list names the hit, so the queue does not add it again.
- Nothing removes a copy when somebody signs out. A copy holds the two names, the clubs and the
  score of a bout that was opened, and it opens with no network for whoever holds the tablet.
- A best-of copy that waits for its next round opens under the round-break screen, which hides the
  notice.
- A tablet whose store is blocked by another tab stays on "Loading" with no network.

Left as it is, by the operator: an organiser signed in with an account and no PIN is still sent to
the sign-in screen by the piste picker.

Named while P1 to P4 were built, and not fixed (each one checked in code by a review):

- A server failure (a 500) with no list yet shows "No next match" on the piste. On a bout's read it
  clears the bout and says "Match unavailable".
- A card's local write that fails shows a raw message or a hardcoded "Network error"
  (`ScoringColumn.tsx`). P1 fixed the hit, not the card.
- The piste's green "online" bar reads the browser alone: with wifi and no internet it says online
  above "No connection".
- Retry on the "bout not loaded" screen shows no busy state.
- On a one-column screen, P1's alert sits in the centre column, under the red one.
- A tap on the backdrop closes the resume warning. It starts nothing.
- A bout a forfeit ended between two rounds, on a clock that never ran, can no longer be reopened
  by a clock Start. Taking the forfeit back still reopens it.

Named while O1, O2, O3, T1, F1, F2 and ruling 1 were built, and not fixed (each one checked in
code by a review):

- "End round" of a best-of bout is still one tap. Ruling 1 covers "End match" only.
- A level bout that may not end as a draw is asked "End the match now?", and then the server
  refuses the End, as it did before, because its time is not finished.
- With "Specific people" and nobody picked, Send on the notifications page is live and the server
  refuses the message.
- The count of bookings on the Workshop list reads zero when its own read fails, and stops at the
  server's row limit on a very large Event. The question before a delete no longer depends on it.
- An Event the caller may not see answers the guest schedule as a failed read. Retry does not help
  there.
- The shared confirm dialog paints its buttons with raw colours, and its two default labels are
  English. Every caller of this track passes its own labels.
- The end-to-end test of the pad (`tests/e2e/16-pad-ui.spec.ts`) now answers the "End match"
  question. That suite runs against the deployed stack and was not run for this change.

Named while P5, P6, P10 and P18 were built, and not fixed (each one checked in code by a review):

- An organiser signed in with an account and no PIN passes the piste picker's first check, and is
  then sent to the sign-in screen: the list of assigned pistes asks for a PIN session.
- A bout moved to another piste while the tablet is offline keeps its Next tile until the next read
  that answers.
- A bout that ends or locks while the card question is up still takes the yes. The server refuses
  the card and the inbox holds it.
- The direct-card panel asks through the shared confirm dialog, whose buttons are under 44px. The
  penalty list and "Edit as no exchange" ask through the pad's own dialog.
- The Escape key closes the "Edit as no exchange" question and the drawer behind it.
- The other buttons of the corrections drawer are under 44px.
- The deployed-stack tests `tests/e2e/06-offline-sync.spec.ts` and `tests/e2e/16-pad-ui.spec.ts`
  now answer the card question. That suite was not run for this change.

### Rulings — operator, 2026-10-12, on the pad rows P7 to P9, P11 to P17, P19 and P20

The operator picked these twelve rows. Each was read again against the code of that day: all
twelve are still true. Eight had two reasonable behaviours and were asked. **All twelve are built
and pushed (2026-10-12, `a2843380` to `02dfefd1`).** Each row of the P table carries its commit;
what the build chose and found is under "Built on 2026-10-12", below the two lists.

| Row | Asked with this story                                                                                                                             | Ruling                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P8  | A finger drags down from the top during a bout and the browser reloads the page. On the piste list that swipe is the only refresh by hand.        | **Off on every screen of the tablet.** The piste list refreshes by itself, as today.                                                                                                                                                         |
| P9  | A French official must type RESET MATCH in exact capitals. Small letters, or a space after, leave the button dead with no word why.               | **Same words, typed loosely.** Capitals and spaces do not matter. A line says why the button is disabled. The field is emptied after a Reset and when the drawer closes. The server keeps its exact check; the tablet sends the exact words. |
| P11 | A hit is refused; the bar turns red with "Review" and "Retry", each about 20px tall.                                                              | **The bar grows to 44px only when it has a button.** It stays 24px when all is well. The screen moves once when a refusal lands; the operator accepted that.                                                                                 |
| P12 | The bout header has three theme symbols of about 16px each. Back, "Match actions" and "External display" are under 44px too.                      | **One 44px button that cycles** dark, light, auto, on the three screens that show it. The three other buttons get 44px.                                                                                                                      |
| P13 | A Pool bout, 90 seconds. At 0:00 the numeral is red and nothing else happens. A bracket bout can reach 0:00 twice, a best-of bout once per round. | **A beep and a vibration each time a running clock crosses 0:00**: regulation, extra time, each round. Never when the screen opens on a bout already past its time. A hit written on the tablet gives a 10 ms vibration. No mute setting.    |
| P16 | Bout 4 ends with 3 entries not sent. The official goes back to the piste list, which shows no count and sends nothing.                            | **The full bar on the piste list**: it counts unsent and refused entries, sends the queue when the screen opens and when the network is back, tries again by itself, and offers Retry and the refused-entries inbox.                         |
| P17 | The tablet of piste 3 is closed at lunch. At 14:00 the app shows the list of pistes again.                                                        | **Open the last piste at once**, when it is still one of the pistes of this sign-in. The back link still shows the list and never bounces. A tablet with ONE assigned piste opens it at once too. Sign-out forgets the piste.                |
| P19 | A laptop table wants Double and Undo without the mouse. French laptops are AZERTY.                                                                | **D = Double, U = Undo, no question.** D works only when the Double button is live. U does what the Undo button does. Both are ignored while a dialog is open or a field has the focus. The hint under the clock lists the three keys.       |

Four choices are MINE, said to the operator on 2026-10-12, not ruled. Say so if one is wrong:

- P7: the tablet stays awake while a bout screen is open, and says nothing when the browser
  refuses.
- P14: the lines "not yet sent" and "not confirmed", and the messages of the clock and of the
  undo, go to 14px. Other captions stay.
- P15: the penalty search empties when the card is written on the tablet, also for a quick-pick
  card; it keeps its text when the official cancels the red-card question. The field gets a name
  for screen readers, 44px, and a true "no penalty matches" sentence.
- P20: a visible word "Doubles" beside the count, with "this round" in a best-of bout. The hover
  text is corrected.

Three things the recon of these rows found, that the rows did not say (each read in code):

- P9: after a Reset, "RESET MATCH" stays typed in the drawer: the button is armed the next time
  the drawer opens.
- P20: the hover text says "per match"; in a best-of bout the count is per round.
- P16: with no network, the piste list's bar says "exchanges queued locally" whether or not the
  tablet holds anything.

Built on 2026-10-12, the twelve rows. One cold review, 112 seeded breaks (all red), the gate chain
and the browser suite (205 tests) ran over all of them.

What the review found, and is fixed:

- P19: U took the last hit off a bout that had ended, under the result screen. That screen had no
  dialog role, so the guard of the keys did not see it (`a3127b76`).
- P17: a piste reached by the Back of a bout or by a link was not remembered. The piste's own
  screen remembers it now (`0bb270a3`).
- P16: after an "End match" went out from the piste list, the bout read as live for up to 20
  seconds. The list is read again after each send (`d9fbd705`).

What the build chose, not ruled. Say so if one is wrong:

- P13: the beep is at the time limit of the phase, also in a bout whose clock counts up. Only a
  hit, a double and a "no exchange" give the 10 ms pulse; a card and a clock press give none.
- P14: the same messages on the screen between two rounds went to 14px too.
- P17: only the sign-out of the Event banner forgets the piste. A session that ends by itself
  keeps it; the next sign-in opens it only when it is one of that person's pistes.
- P19: the hint with the three keys is shown before the bout starts, as before, at 12px.
- P12: the three themes are Hybrid, Dark, Light, in that order. The ruling said "dark, light, auto".
- P7: the hook is in `packages/ui`, as this list says, for the TV screens (T7). Only the bout
  screen holds it.

Named, not fixed (each read in code):

- With no network, the bar says "exchanges queued locally" when the tablet holds nothing. It now
  shows the count beside it, on both screens. The words are unchanged.
- `ScoringColumn.tsx` shows the store's own English words, or "Network error", when a card cannot
  be written. `MagicLinkForm.tsx` has "Something went wrong". Both break hard rule 6.
- The corrections drawer never empties its "reason" field.
- D and U are read by the place of the key. On a BEPO or Dvorak keyboard the letter printed on
  that key is another one.
- The bout page still wires its three sends itself, in an order four text pins hold. The piste
  list has its own hook (`usePisteQueue`). They are two copies of the same three calls.
- Two Space presses with no time between them: a browser story needed a wait between the two.
  Not looked at: it may be the test, or a second press judged by the clock from before.
- Not checked: whether a Resume sent late and answered right at 0:00 can make the beep sound twice.

## Ruling 4, built on 2026-10-13: "Next match" with no network

Story. The wifi drops at a piste for forty minutes. Bout 1 ends and the official taps "Next
match". The tablet said "We could not check who is signed in", with a Retry that could only fail
again. Two causes: the PAGE of a bout the tablet had never opened was not on the tablet, and
neither was the BOUT (a copy was written only after its own screen had read it).

Two rulings of 2026-10-13, asked with that story:

| Asked                                                        | Ruling                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| How many bouts ahead must the table play with no wifi?       | **The whole piste.** The tablet keeps every bout of its piste and their order. A new server route is accepted.                                    |
| Three faults found beside ruling 4: which go into this work? | **All three.** A piste page opened with no wifi; the Retry that loops on the start page; the offline cache that was never renewed after a deploy. |

What the official gets:

- With no wifi, "Next match", the Next and Previous tiles and a card of the piste list open the
  bout from the tablet's copy, with the notice that says from when it is. A bout not started can
  be started and scored. It names its own next bout, to the end of the piste.
- A piste page opened or reloaded with no wifi shows the list the tablet kept, with its date.
- With no wifi the start page goes to sign-in. Its Retry no longer loops.
- After a deploy, a tablet takes the new app at its next page with a network, and its offline
  pages are complete at once (the pages of the bout, the piste, the two desks, and their scripts).

Built in sixteen commits, `9c228728` to `899c1197`:

- Server: the tiles walk a piste in the order of its list, and that order is total (`9c228728`,
  `aabf3b49`); one builder for the summary of one bout and of many (`fe0a640b`, `5bc3195f`);
  `GET /staff/lices/:liceId/bouts` (`e80dd481`).
- Tablet: it keeps its piste (`4a039791`, `678d0fc8`, `e25b69f1`); a bout opened from the tablet
  names its next bout (`1414c3c3`); the two pages open with no network from one kept shell each
  (`14f7b056`); the worker's cache follows the deploy (`1a2df9b2`, `d4e35604`); the start page
  (`d6e0241f`).
- Tests: `tests/a11y/pad-next-bout-no-network.spec.ts`, `pad-lice-no-network.spec.ts`, the
  worker's own tests (`src/offline/sw.test.ts`), and `tests/e2e/41-next-bout-no-network.spec.ts`
  (`899c1197`), WRITTEN BY READING, NOT RUN: it joins 40, 39, 10 and 16 after the redeploy, and
  needs `E2E_STAFF_URL`.

What the reviews found, and is fixed (three cold reviews, one per push):

- Two bouts of one time and one bout number had no fixed order. Every bracket bout has the same
  number for that order (its label is the bare slot), so the list and the kept piste could
  disagree.
- A bout read ahead with no rules of its Tournament opened with the default +2 and +1 buttons.
  The tablet now keeps a bout only when it holds those rules.
- A bout in play on ANOTHER tablet, read ahead, opened here at 0:00 with Start and no double
  counted. The tablet now keeps ahead a bout not started, or one whose clock it holds.
- A piste read that failed waited five minutes. It is asked again after thirty seconds.
- After a deploy, an install that the wifi cut short deleted the old, complete cache. Such an
  install now fails when a worker is already active, and is tried again at the next page.

What the falsifiers found (142 seeded breaks over three runs, all red at the end):

- A fault of my own summary builder: a bracket stored with `mainBracketSize` had "B2" as its
  round token where the round code said "SF". The comparison with the old code had missed it.
- A check that changed nothing, removed (`e25b69f1`).

Proof that no gate runs, done by hand: the REAL service worker on a production build, the server
stopped. 25 checks of 25, in the shape of production (scripts under `/staff/_next/static/`), with
a deploy in the middle. ARCHITECTURE 10.4 has the list.

What the build chose, not ruled. Say so if one is wrong:

- **Cards in a bout read ahead.** The tablet does not keep the prior cards of the fighters for a
  bout it never opened. With no wifi, a card there is worded as a first offence and not priced
  until the server takes it. The server prices it right.
- **Which bouts are kept ahead**: a bout not started whose Tournament's rules the tablet holds.
  A bout in play elsewhere, or with no rules, is not kept: its tile leads to "not loaded".
- **Every five minutes** for the piste read, thirty seconds after a read with no answer.
- **The piste picker (`/lices`) with no wifi goes to sign-in too.** (Ruled on 2026-10-13: it
  opens the last piste, as the start page does. Built `b35de7df`.) It said "could not check"
  there. It is the same decision as the start page, and what the picker already did with no
  service worker. From sign-in, only the browser's Back returns to the piste. Say if the picker
  should stay where it is.
- A bracket's bouts of one time now come in slot order on the piste list and the tiles.
- A failed read of the Tournament, the Pool or the piste inside a bout's summary is now a server
  error. Before, the summary came back with a blank weapon and default rounds.
- The real-worker probe is a script run by hand, not a CI job.

Named, not fixed (each read in code):

- ~~**An installed pad launched with no wifi lands on sign-in though it holds a piste** (ruling
  241). With the piste kept, it could open the last piste. It needs a ruling.~~ Ruled and built
  on 2026-10-13, `b35de7df`: see the next section.
- A copy read ahead while a bout was not started stays when that bout starts on another tablet.
  Opened here with no wifi, it offers Start; rulings 12 and 14 say what the server does with it.
- With no wifi, a tile whose answer came from the server before the cut is not replaced by a
  newer order the tablet read after it.
- The bar says ONLINE while the bout on screen is the tablet's copy, when the tablet kept its
  access point and only the uplink is gone.
- An organiser with an account and no PIN gets no piste kept: the piste routes refuse that
  session. The admin mount (`/staff/…`) has no service worker at all.
- `tests/e2e/06` and `40` open the pad on the admin mount by default, where no worker is served:
  they may not run under the worker they name. To check at the redeploy (`E2E_STAFF_URL`).
- The pools and bracket panels of the piste page read the network only.
- The QR scanner's decoder is loaded on first use: after a deploy it is not on the tablet until
  the desk scans once with a network.
- `/offline` is kept and never served.
- One Tournament with a stored format the schema refuses now fails the read of its whole piste.
  Every write path validates the format; only an old row or a hand-written one can do it.
- On a real tablet the level-bout button shows the default step until the rules land; a tap in
  that moment takes the default length on the tablet's clock. This was the cause of the unstable
  story of `pad-level-no-network.spec.ts`, whose wait is fixed (`c2cda563`).
- A container started by hand with no `GIT_COMMIT` serves its worker as "unknown", and two such
  starts in a row do not renew the tablets' cache. The deploy scripts now warn when the pad does
  not serve the new commit.

## Built on 2026-10-13: the app opened with no wifi, and the bar over a refused entry

Three rulings of 2026-10-13, each asked with a story:

| Asked                                                                                                              | Ruling                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| The tablet of piste 3 is opened at 14:00 with no wifi. Sign-in (which cannot work), or the piste the tablet holds? | **Open the last piste.**                                                           |
| The list of pistes with no wifi: sign-in (built with ruling 4), stay on the list, or the same as the start page?   | **The same as the start page.**                                                    |
| A refused entry is in the inbox and there is no network: red bar or grey?                                          | **Red, always.** With "Review", and the bar also says that there is no connection. |

What the official gets:

- The app opened with no wifi opens the piste the tablet last had, from the tablet's copy, with
  the line that says from when the list is. The list of pistes does the same. A tablet signed out
  with "Log out" remembers no piste and shows sign-in (`b35de7df`).
- With a refused entry in the inbox and no network, the bar is red, says the refusal and "NO
  CONNECTION", and offers "Review". It offers no Retry: nothing can be sent. The tablet tries
  again by itself every five seconds, as it does with no refused entry (`cb18a1d3`).

What ran: one cold review, 38 seeded breaks (all red), the gate chain (36 of 36), the browser
suite (218 passed), and the real service worker on a production build with the server stopped
(32 checks of 32). No API code, no migration, no route.

What the review found, and is fixed:

- With a refused entry and one or two unsent entries of other bouts, the bar was red but said
  nothing of the network and offered a Retry that could send nothing. Only three failed sends in
  a row, or a browser that says "offline", gave the ruled bar. The send engine now says
  "offline" for a pass that met a dead network, with a refused entry in the inbox too. So the
  choice "the engine is not touched" of the plan did not hold.
- The start page's function had crossed 50 lines.

What the build chose, not ruled. Say so if one is wrong:

- **The piste is opened unchecked.** (Ruled the same day, see the next section: the tablet
  remembers who had the piste.) With wifi the app opens the last piste only when it is one
  of the pistes of the sign-in. With no wifi it cannot ask, so it opens the piste the tablet
  remembers. A session that ended by itself keeps the piste; the server asks for a sign-in when
  the wifi is back, and holds every entry until then.
- A tablet that remembers a piste and holds no copy of its list opens the piste page, which says
  "no connection". Not sign-in.
- "Your Lices" tapped with no wifi comes back to the piste, with no word why. The list of pistes
  is not kept on the tablet.
- A tablet with ONE assigned piste that never opened it shows sign-in with no wifi.
- ~~Read-only mode with a refused entry stays grey.~~ Ruled red the same day and built
  (`54de2aef`): see the next section.

Named, not fixed (each read in code):

- (Fixed the same day, `2c7ebeb0` and `1120d6ce`: see the next section.) Person A works piste 3
  and never taps "Log out". Person B signs in on that tablet with a desk
  or gear account, then opens the app with no wifi: B gets A's piste. No access is crossed (the
  server refuses what B sends), but B is on the wrong screen. Keeping the account beside the
  remembered piste would close it.
- On the list of pistes, a network that drops between the sign-in read and the read of the
  pistes says "could not load" with a Retry. The Retry then opens the last piste.
- The two pages go to `/login` and `/lices/…` with no mount prefix, as the lines before mine do.
  Behind the admin address (`/staff/…`) that leaves the pad. Older than this work.
- The bar says ONLINE over a list that came from the tablet, when the tablet kept its access
  point and only the uplink is gone (named with ruling 4; the probe shows it).
- The step added to `tests/e2e/41` is WRITTEN BY READING, NOT RUN. It also changes where that
  story ends: on the piste page, whose queue must send when the network is back.
- The real-worker probe has two traps, both met this session: its server must be started with
  the `STAFF_ASSET_PREFIX` of the build (or no page runs its scripts, with no error), and its read
  of the tablet's store must not open the store before the app does.

## Built on 2026-10-13: the sign-in rows S1 to S4, and two rulings

The operator picked S1 to S4, and ruled twice, each asked with a story:

| Asked                                                                                                              | Ruling                          |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Read-only mode is on and the tablet holds a refused entry. The bar is grey. With no network it is red. Which here? | **Red, as with no network.**    |
| Anna leaves piste 3 with no "Log out". Ben signs in, then opens the app with no wifi: he lands on Anna's piste.    | **Remember who had the piste.** |

What the volunteer and the official get:

- **S1** (`a5139aa6`). The PIN sign-in says why it failed: wrong username or PIN; too many tries
  ("do not type the PIN again"); no connection; the event was not found; the account or the event
  is closed; the server has a problem. With no event chosen in the list, the screen asks for one
  and sends nothing.
- **S2** (`501586fc`, `36a1e7c8`). The keyboard leaves a username and an event code as typed. The
  field reads "Event code".
- **S3** (`e9c2564d`, `f6c52a50`, `36a1e7c8`). The email form has a heading ("MyClash account",
  "For organisers"), a sentence per cause, and "Use another address" after "Check your email".
- **S4** (`9fe349e6`, `9a46844b`). The list of events writes "Sat, August 8, 2026" / "sam. 8 août
  2026".
- **The bar in read-only mode** (`54de2aef`). Over a refused entry it is red, says the refusal and
  "MAINTENANCE", and offers Review. Its Retry stays while a hit waits.
- **Who had the piste** (`2c7ebeb0`, `1120d6ce`). The tablet keeps who it last saw signed in. When
  it sees another person, it forgets the piste: with no wifi that person gets sign-in. With wifi,
  a second person gets the list of pistes, not the first person's piste.

What ran: one cold review, 92 seeded breaks (all red at the end), the gate chain, the browser
suite. No API code, no migration, no route.

What the review found, and is fixed:

- The piste page remembered its piste as soon as it opened, for anybody. The browser's Back after
  Ben's sign-in gave him Anna's piste again, and the Back after "Log out" remembered a piste with
  nobody signed in. The page now remembers a piste only when the server gave that piste's list.
- A tablet with a PIN session AND an organiser's account: one fault of the PIN read looked like
  another person, and the piste was forgotten.
- The edge's own 404 (no route to the API) read "this event was not found". An answer with no
  body of the API is now "the connection was blocked".
- The PIN field asked the browser to keep the PIN (`current-password`). On a shared tablet the
  browser then offers one volunteer's PIN to the next.
- A date no calendar has (`2026-13-45`) rolled over to February.
- The seeded breaks found one story that passed for the wrong reason (its own 403 was still
  answered with the network "down").

What the build chose, not ruled. Say so if one is wrong:

- **One sentence for two causes, twice.** The server says 401 for an unknown username and for a
  wrong PIN, and 403 for a disabled account and for an event that is over. To tell them apart the
  server needs a code for each: small, not built.
- **The PIN field is a "one-time code" for the browser, and the username is "off".** Not looked
  at on a venue tablet. A browser may still offer to save a password field.
- "Too many tries" says "wait, up to one hour". The screen cannot read how long: the server's
  header for it is not kept by the client.
- English dates are in the US order ("August 8"), as the other dates of the pad. The rest of
  MyClash writes "8 August" for English.
- A tablet that kept a piste before this work forgets it once, at its next sign-in read.

Named, not fixed (each read in code):

- **An organiser who signs in by email link on a tablet that still holds another person's PIN
  session.** The pad asks the PIN session first, so it still sees the PIN account: the organiser
  gets that person's pistes, with wifi and without. Older than this work. Worth a ruling.
- "Choose your event first" stays on screen after the tap on an event, until the next press of
  the button.
- The list of events says "No events are set up for staff sign-in yet" when its read FAILED (no
  network, too many requests). `usePickerEvents` turns every failure into an empty list.
- `checkEmailPrefix` (fr) ends in "a" for "à", and `scoring.banner.logout` (fr) is "Se
  deconnecter".
- After "Check your email" the notice shows a second logo under the page's own, with the PIN form
  still above it.
- The lock of the PIN is ten tries an hour per account, and a GOOD sign-in counts as a try.

## Built on 2026-10-13: the TV rows T2 to T5, and two rulings

The operator picked T2 to T5, and ruled twice, each asked with a story:

| Asked                                                                                                                   | Ruling                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| A Fullscreen button drops out after every bout: the TV loads its page again to change bout, and a load ends fullscreen. | **The button, and the TV changes bout with no page load.** |
| The kiosk design note says the hidden bar of the piste TV is "exhausted". Where does "Swap sides" go?                   | **In the hidden bar.** The design note changes.            |

What the hall gets:

- **T2** (`9a5c16d0`, `d4525961`). The scoreboard's words follow the language of the hall: the
  clock pill ("En pause", no more raw `halted`), "Assaut terminé", "Prochain assaut dans 3…",
  "Dernier assaut sur cette lice", "À suivre", "Manche 2/3", "Temps total", "contre".
- **T3** (`dbfc2fa8`, `12015e8c`). On a 1080p TV the next two fighters are named in 30px (was
  14px), and the Event, the piste and the Tournament line in 18px (was 12 to 14px).
- **T4** (`b421fd68`, `a98c7068`). The hidden bar of the piste TV has "Swap sides". The screen
  keeps the choice. The card "waiting for next match" names its two fighters in the same order.
  The public TV opens not swapped, the organiser's popup swapped, both as before.
- **T5** (`091f6f2a`, `b5701493`, `9970739d`, `9ade9162`). The three TV screens stay awake. The
  piste TV's bar and the organiser's popup have a Fullscreen button. When a bout ends, a screen
  moves to the next bout with no page load, so fullscreen holds from bout to bout.

What ran: one cold review, the seeded breaks, the gate chain, the browser suite. No migration, no
route. One comment changed in the API.

What the review found, and is fixed:

- A browser that blocks site data throws when a page only names its storage. "Swap sides" named
  it while the screen was drawn: the public piste TV would have shown the error page.
- A new mount of the scoreboard for each bout put "Loading scoreboard" on the piste TV between
  two bouts. The bout that ended now stays drawn until the next one is read.
- A reopen in the same draw as the last tick of the countdown told the screen the bout was over.
- The piste TV's browser story could pass on the read its dead live channel makes when it fails,
  and not on the countdown. It now changes the piste in the countdown's last second.
- A long Event name beside two long fighters wrapped in the header.
- "Exit fullscreen, pressed" for a screen reader.
- The French pill said "Arrêté" where the tablet says "pause".

What the build chose, not ruled. Say so if one is wrong:

- **A next-up name is cut on one line, not wrapped.** Two long names wrapped made the header
  taller, and the card counts under the fighters left the bottom of the screen. The plan said
  "wrap".
- **The single-bout public TV has no Fullscreen button**: it has no bar. It stays awake, and it
  keeps a fullscreen that F11 gave it.
- T3's sizes are chosen on screenshots, not in a hall.
- The single-bout TV and the organiser's popup show "Loading scoreboard" for one read at each
  bout: they change address, and the router mounts a new address again. It replaces a page load.
- After a deploy, the next change of bout loads the page once: fullscreen drops that one time.

Named, not fixed (each read in code):

- ~~**With its live channel up, the piste TV leaves a finished bout at once.**~~ Ruled and fixed
  on 2026-10-13 (`f23cd7e2`, section "the winner's card, and ten F rows"). The sentence that
  stood here said the card was whole with the channel down or the Event hidden: that was wrong,
  any read of the piste cut it.
- The single-bout public TV has no browser story: its page reads the bout on the server, and the
  browser harness runs no API. Its address has a unit test and its wiring a text pin.
- The card "waiting for next match" still has two lines in phone sizes (the Event, the piste).
- French words of `scoring.liveMatch` with no accents ("Arrete", "Programme", "Termine").
- The tablet's own raw `halted` (row X1) can reuse the new keys `scoring.scoreboard.clockStatus`.
- `MatchScoreboard`, the organiser's preview, keeps its own fixed type sizes.

## Built on 2026-10-13: the winner's card, and ten F rows

The operator picked the F rows, and ruled three times, each asked with a story:

| Asked                                                                                                                                | Ruling                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A bout ends on a piste. With its live channel up, the piste TV shows the winner's card for under a second. What should the hall see? | **The card holds five seconds**, live channel up or down.                                     |
| A duty on the guest schedule reads "arbitre table". The server sends the organiser's own name for the role.                          | **The organiser's name for the role** ("Table", "Video"), as the signed-in schedule shows it. |
| An organiser signs in by email link on a tablet that holds a volunteer's PIN session, and is still seen as the volunteer.            | **The email link wins.** Ruled, NOT built: it gets its own plan (see "The email link wins").  |

Scope, also ruled: the ten F rows that need no design (F3, F4, F5, F8, F9, F11, F12, F14, F17,
F18). The nine others (F6, F7, F10, F13, F15, F16, F19, F20, F21) each hide a design, and get
their own plan.

What people get:

- **The piste TV** (`f23cd7e2`, `ab2421c8`). When a bout ends, its winner's card stays for the
  whole countdown, then the next bout or the waiting card shows. A bout that was only moved to
  another piste, or put back to "not started", still leaves the screen at once. A bout a
  correction reopens keeps the screen.
- **F8** (`5b8d5d98`). The guest schedule, a person's page and the live board tell a bout's time
  on the Event's clock, not the phone's.
- **F9** (`a71e71a7`). A followed fighter's bouts name their piste. A bout whose clock is halted
  is listed as live: it was in no list at all.
- **F17** (`4a535cd7`). A referee duty reads "Table", not "arbitre table".
- **F18** (`b8652b16`). The live board, the guest schedule, the pass page and a person's page
  have a link back to the Event home.
- **F3** (`b165694a`, `a472eb52`). A bout on the guest schedule, and on a person's page, opens
  the bout's page, and that page's Back returns where you came from. It says "Back", not "Back
  to match list", when you did not come from a list of bouts.
- **F4** (`e4746521`). The live board shows the score of the bout on each piste.
- **F5** (`969ae48a`, `ba92e004`). The live board says how fresh it is: "Live", "Slower updates"
  when its live channel is down, "Not updating" when three reads in a row did not land.
- **F12** (`521423e7`, `6e2c6774`). On the participant sign-in page, Enter sends the form, and an
  empty field gets a sentence ("Enter your email address.").
- **F11** (`e2b4b82a`, `1d1f0c29`). Signing in returns you to the page you came from, by
  password, by email link and by Google. Every door of the public site sends its page.
- **F14** (`cb4f4b28`). A page that failed offers a way home beside "Try again".

What ran: one cold review, the seeded breaks, the gate chain, the browser suite. No migration, no
route, no API code.

What the review found, and is fixed:

- **A bout the closing hit ended could still lose its card.** The server writes the bout as
  completed first, and its clock's end row a moment later. The screen asked once, between the
  two, and judged the bout "not over".
- **A read that never answers left the TV on the old bout.** The screen now waits five seconds
  for "is this bout over", then shows what its piste says.
- **On a slow link the piste TV took no answer at all**: each new read cancelled the one before.
- **The sign-in form lost the gaps between its fields.** The form I put around them was one
  block to the panel that spaces them.
- **Signed in from the site's home, a password landed on the home, and the email link and
  Google on the personal space.** All three land on the personal space.
- **Four pages of the personal space still forgot their page** when their login ended.
- **The live board said "Slower updates" on every page load**, until its channel had answered,
  and for ever on an Event with no piste.
- A status from a live channel that is gone was read as today's.

What the build chose, not ruled. Say so if one is wrong:

- **The last bout of a piste shows its end card for 8 seconds, not 5.** A bout with no next bout
  of its own counts nothing down, so the screen's own limit ends the wait.
- **A bout that ends with no clock (a forfeit) gets no hold.** The scoreboard draws no end card
  for it, before this work and after.
- **From a person's page the Back link of F18 goes to the Event home**, not to the participants
  list the visitor may have come from.
- **The site's home is no page to return to after sign-in**: a visitor of the home lands on the
  personal space, as before.
- **A sign-in from one piste of the live board returns to the whole board.** The door sends the
  page's path, without what follows the `?`.
- **Enter does nothing on an incomplete sign-up**, as its button, which stays off until the
  form is whole. The sentences for a weak or a mismatched password cannot show: older than this
  work.
- **The live board says "Live" whenever its channel is up**, as the bout page does. A club
  member on a hidden Event then sees scores that move every 30 seconds under "Live".
- F9's halted bout was not asked for: it was in the same lines.

Named, not fixed (each read in code):

- **A guest of a draft or a test Event sees bouts whose page answers "not found"** (F3): the
  guest schedule has no Event gate, and the bout page shows a hidden Event's bouts to its club
  and staff only.
- **Sign-up by email loses the page to return to** (F11): the confirmation link lands on the
  personal space.
- The Event home's "Live now" block and the hub's "Now live" block do not say how fresh they
  are (F5's fault, in two more places). Four readers of the live state, and three of
  "my schedule", each with types of their own.
- The guest schedule's "Live" badge is for a running clock only; a halted bout has none.
- `referee-display.ts`, a second, hard-coded map of role names, on the Tournament page.
- An unknown fighter is the literal `?` on the live board and on the live card.
- The loading page of the Event pages words its label in English for every visitor.
- `fetchEventTheme` reads a field the API does not send: the Event's hero image is never set.
- Two things of the piste TV are held by no test: an answer of the piste older than one already
  taken is dropped, and what a removed live channel says is dropped. Both were read, not run.

### The email link wins: ruled, not built

The operator ruled on 2026-10-13: an organiser who signs in by email link on a tablet that holds
another person's PIN session is seen as the organiser. The recon found that it is not a small
fix. Each point was read in code, not run:

- **The emailed link does not land on the tablet's app.** It lands on the organiser site, at an
  address that site does not have (`buildPostAuthRedirectUrl`: a `login` link goes to the admin
  host, with the path `/lices?arrive=1`).
- **The server cannot end the PIN session where the link lands.** The PIN session is a cookie of
  the tablet app's own host; the link is handled on the API's host, which never sees it.
- **An organiser with no PIN has no list of pistes on the tablet.** Every read behind that list
  asks for a PIN session; the page sends her back to sign-in.
- **A volunteer's unsent hits carry no name.** They are saved under whoever the server sees when
  they go out: the organiser, while her login is fresh; the volunteer again, about an hour later,
  with no word on screen.

It needs rulings before a plan: whose are the unsent hits, what an organiser with no PIN sees,
and whether a PIN typed on a tablet that holds an organiser's login ends that login.

## Built on 2026-10-13, evening: six of the nine F rows that hid a design

**State on 2026-10-14 00:30.** The seven commits of the evening (`dea8f0e5` to `6cbaf8bb`) are
reviewed and falsified, with eight commits of fixes and tests on top (`3e692bb4` to `50c552cb`):
see "The review and the seeded breaks" below. The gate chain is green over all of it (36 of 36).
F19 and F21 were built on 2026-10-14: see the section after this one. The plan:
`C:\Users\Tony\.claude\plans\pasted-content-id-2bfd-repo-f-github-noble-scott.md`.

The operator picked the nine rows and ruled seven times, each asked with a story:

| Asked                                                                                                                     | Ruling                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| F13. A club member opens the public address of her own DRAFT Event. A wrong link will say "not found". What does she see? | **She sees her draft.** Everybody else gets "not found". A server fault is never "not found".             |
| F13. A TEST Event answered "not found" on that read to everybody, its own club too. What does a club member see?          | **The home, as for a draft.** One rule for a hidden Event. The public still never sees a test Event.      |
| F7. A card on the Event home leads to a fighter's bouts. The home does not know who holds the phone. What is on the card? | **The same card for all**, with two links: "My schedule" and "Find my name".                              |
| F10. Paul opens his schedule in the hall, then again in a changing room with no signal.                                   | **The phone keeps a copy**, removed at sign-out, at "this is not me", and when the server ends the login. |
| F19. Paul taps "Share" on his bout's page on his phone.                                                                   | **The phone's share sheet**; where there is none, copy the link and say "Copied!"; a failed copy says so. |
| F15 + F16. Three tabs: a Tournament, a bout, the league list.                                                             | **Page, then Event**: "Dupont vs Martin · FAL 2026". Outside an Event: "Leagues · MyClash".               |
| F20. Paul adds his 14:20 bout to his calendar at 09:00. At 11:00 the day is delayed by 30 minutes.                        | **Do not build F20.** A calendar entry is wrong as soon as a piste runs late. The row is struck.          |

What people get:

- **F13** (`b401434b`, `d8f6dd25`). A wrong link or QR code shows "Page not found" in the
  visitor's language, with the way back. A server fault shows "Something went wrong, Try again".
  A club member sees the public pages of her own draft or test Event: its home, its Tournament
  pages, its roster.
- **F15 + F16** (`729cbcba`). Every tab has a name: the page, then the Event; outside an Event,
  the page, then "MyClash". A bout's tab names its two fighters. Titles are in the visitor's
  language.
- **F6** (`b129dfb8`). While the Event runs, "Live now" is under the header of the Event home.
- **F7** (`b129dfb8`). The Event home has a card with "My schedule" and "Find my name".
- **F10** (`d471d5c5`). The guest schedule says "Updated 14:02". It reads again when the signal
  returns, when the visitor comes back to the page, and once a minute in view. With no signal it
  shows the copy the phone kept and says "Updated 14:02 · offline". The copy leaves the phone at
  sign-out, at "End guest session", when a visitor picks a name, and on a 401.
- **For the tests** (`dea8f0e5`). The browser suite now answers the reads a public page makes on
  the SERVER (`scripts/e2e-server-api-stub.mjs`). Before, no story could open the Event home.

What the recon and the build found:

- **I told the operator a false sentence, and corrected it in the plan.** "The Tournament pages of
  a test Event still open for its club": they did not. They read the Event through the same
  door, so they said "not found" to the club too. The ruling fixes them with the home.
- **The server change is the rule of rulings 97 and 101**: the read of an Event by its address
  was the one door left behind. `docs/ARCHITECTURE.md` stated the old rule twice; both places
  are corrected in `b401434b`.
- **A title set in a layout cuts the Event's name off every page below it.** A person's page
  read "Participant". Three layouts hand the rule on (`titledAbove`); a sweep holds it.
- **Next puts the root's title template around a nested default title**: a TV screen read
  "FAL 2026 · MyClash". The Event's rule uses an absolute title.
- **The sweep of F13 found nothing wrong, and one false alarm of its own**: the bout page sends
  its login by another name. The sweep now counts `headers:`.

What the build chose, not ruled. Say so if one is wrong:

- **"The Event runs" is the status the organiser sets**, as the header's "Live now" pill. Not "a
  bout is in play at this minute".
- **On the home the new card is above "Live now".** The card is one row high; the live block can
  be a screen long.
- **The schedule reads again once a minute** while the page is in view, and a read with no
  answer after 20 seconds counts as failed.
- **A failed read of any kind is worded "offline"**, a server fault too.
- **Every page gets a tab title**, not only the ones F16 names. A person's page and a Workshop's
  page read "Participant" and "Workshop", not the name. A club's page and a league's page read
  their name.
- **The not-found page answers HTTP 200** on a page of an Event: the Event's loading page has
  started the answer before the read ends. The visitor sees the right page.
- **The personal space's schedule shows "could not load" and Retry** when the read fails and the
  phone keeps nothing. It was a skeleton for ever.

Named, not fixed (each read in code):

- **A person who signs in by the mailed link on a phone that still holds another person's copy**
  sees that copy until her own read lands (for as long as she has no signal). The mailed link
  lands by a server redirect: no door of the site runs then. The copy shows what the first
  person's public page shows, plus his Workshops if he hid them. The operator was told with the
  plan. A sign-in with a password or with Google now removes the copies (`5090b0c7`): this note
  said no sign-in could, and that was wrong for those two.
- `fetchEventTheme` reads the Event a second time, with no login: a draft's hero image is not
  shown to its club.
- The people-search page and the Workshop page have no "could not load" state: a failed read of
  the Event shows them empty.
- The Tournament statistics read (`stats-data.ts`) sends no login: it stands in the sweep's
  allow-list.
- Three hand-written copies of the schedule types (the guest page, the person's page,
  `me/types.ts`). The personal space's two other schedule callers still show nothing on a failed
  first read.
- Not held by a browser story, held by a text pin only: sign-out removes the copy; a visitor who
  picks a name removes it.
- The cache question of F13 was read on the dev server only (`Cache-Control: no-cache,
must-revalidate`), and no cache rule stands in `infra/`. Not read on a production build.

### The review and the seeded breaks, 2026-10-14

One cold review read the seven commits: no blocker, three majors, nine minors. Each major was
read again in code before its fix. All three have one cause: the login cookie is good for one
hour, and only `/me` renews it, in the browser.

- **A fighter with an account lost her schedule after one hour** (`3e692bb4`). The read answered
  401 for a login that only needed renewal. The page read it as "signed out": it took her
  schedule off the screen and off the phone. Now the read renews the login first
  (`fetchRenewingLogin`, the owner that existed). A 401 after that is the answer.
- **A club member read "Page not found" on her own draft Event after one hour** (`338eb06f`).
  The server read went out with a login that had ended. Now the not-found page asks `/me`; when
  the login is back it loads the page again, once. Until `/me` answers it shows a spinner.
- **Deleting an account left the kept schedules on the phone** (`5090b0c7`). That door now
  removes them, and so do a sign-in with a password and one with Google. A read that was out
  when the person left no longer writes her schedule back.
- With the first fix: a page that shows the two doors ("find your name", "sign in") keeps them
  when a later read fails. It turned to "could not load" one minute later.
- Tests only: each of the three public routes of a draft or test Event (`d6aaadf2`); the title
  sweep now checks WHICH rule a layout hands on (`6fee8467`); the rules of when a schedule page
  reads are run by a unit test, not held by one line of text (`3e692bb4`).

128 seeded breaks ran over the rows and their fixes: 121 red. Of the seven green, two are held by
the unit test beside the browser story that stayed green. Five had no test, and have one now
(`50c552cb`): the live block's login from the browser; the 44 px height of the card's links; a
Retry that is seen at once; the personal space's "could not load"; the stub's silence for a path
that is no Event and no bout. Those five ran again: 5 of 5 red.

What the fixes chose, not ruled. Say so if one is wrong:

- **A sign-in with a password or with Google removes every kept schedule of that phone**, the
  new person's own older copy too. Her next read brings it back.
- **The not-found page waits for `/me` before it says "not found"**, for a visitor who holds the
  30-day cookie and a login that ended. Everybody else sees "Page not found" at once.

Named by the review, not fixed (each read in code):

- The Tournament page draws its own "Tournament not found" and does not renew a login: a club
  member whose login ended reads it on a draft Tournament until she loads the page again.
- `signInAgainHere`, the door of the personal space when `/me` says the login ended, removes no
  kept schedule. `/me` also answers "anonymous" on a fault of the login service, so removing
  there would remove copies on a fault. RULED on 2026-10-14: keep the copy.
- The personal space's pages of one Event read "My event · MyClash" and "My schedule · MyClash"
  for every Event: two Events in two tabs read the same. It follows the ruling's letter.
- Suspected, not run: the tab of a not-found page under an Event keeps the page's own words
  ("Home · no-such-event").
- The title sweep does not see a hand-written `generateMetadata` in a layout with pages below
  it, nor a title built from a translated value that holds the site's name.
- The title read of the roster page throws on a failed read of the Event. The page throws the
  same error, so the same error page shows.
- Not held by a browser story, held by a text pin only: the five doors that remove the kept
  schedules, and "a read out when she left writes nothing back".

Left of the nine at that time: **F19** and **F21**. Both are built: see the next section.

## Built on 2026-10-14: the last two F rows, F19 and F21

F19 (Share) and F21 (a rank opens the fighter, a history line opens the bout) are built,
reviewed and falsified: eight commits, `22794702` to `8f088021`. Every F row is now done or ruled
out.

The operator ruled three times, each asked with a story:

| Asked                                                                                                                                            | Ruling                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Paul's phone keeps a copy of his schedule. His personal space says "your login ended". The server says the same on a fault of the login service. | **Keep the copy.** That door removes nothing. Closes the finding about `signInAgainHere` of the night. |
| Marie is at her desk, on Chrome on Windows, and taps Share. Chrome has its own share panel there.                                                | **The browser's panel**, on a desktop too. No guess of "is this a phone".                              |
| A club member opens a published Tournament of her own DRAFT Event. A link she shares says "Page not found" to everybody outside her club.        | **No Share button** on a page the public cannot open.                                                  |

What people get:

- **F19** (`22794702`, `802f3bc7`). A Share button on a bout's page and on a Tournament's page.
  It opens the browser's share panel where there is one. Where there is none it copies the link,
  and the button says "Copied!" for two seconds. A copy that fails says "Could not copy the link"
  for six seconds. The link is the page's plain address: not the sender's way back. The fighter
  profile's "Copy link" is now this same button.
- **No Share** on a bout the public cannot read, on a draft or archived Tournament, and on a
  Tournament of a draft or test Event.
- **F21** (`c03ccbab`, `d2f5292a`). A name in a league's standings opens the fighter's page. A
  line of a fighter's full history shows the first day of its Event and opens the bout. From a
  bout opened from a fighter's page, Back returns to the fighter: it led to the Event's home.
- **A ranked fighter with no public page stays plain text**: a profile the public may not know
  of, and a profile that was merged, deleted or erased.
- **For the tests.** The server stub of the browser suite now answers a Tournament's page, a
  league with its standings, and a fighter. No story could open those pages before.

### The review and the seeded breaks

One cold review read the first three commits: no blocker, two majors, ten minors. Each was read
again in code before its fix.

- **An archived Tournament showed Share** (`802f3bc7`). An organiser can archive a Tournament: its
  club still opens it, the public does not. My rule named the one status it hid. It now names the
  three statuses the server shows, and a test holds the two lists equal.
- **"May the public know this profile" was built for one profile** (`04a2cc9a`). The standings ask
  it for every ranked fighter. Two limits of the database gateway then matter. A long list of ids
  fails the read, so the league page could fail whole. And a read is cut at 1000 rows with no
  word: a fighter whose rows were cut counted as KNOWN, so a hidden page would get a link. The
  question now goes in pieces of 200, and a read that comes back full is asked again in halves.
- **A merged or erased profile got a link to a missing page** (`b284f8c4`). The standings now ask
  the same two rules as the fighter's page.
- **A second tap under an open share panel copied the link** and said "Copied!" (`802f3bc7`). A
  tap is ignored until the one before it has its answer.
- **After a failed copy the button was named "Could not copy the link"** until the next tap. It
  reads "Share" again after six seconds.
- **The focus ring of a ranked name was cut** by the champion's card (`cc667ffe`). The link is
  underlined on focus.

78 seeded breaks ran over the rows and their fixes: 77 red. The green one had no test, and has
one now (`8f088021`): the button was dead after its first tap and every story passed. It ran
again: red.

What the build chose, not ruled. Say so if one is wrong:

- **The history line's date is the first day of the Event**, not the day of the bout. The answer
  carries no time zone for the bout's own instant.
- **A failed copy shows for six seconds**, then the button reads "Share" again. The ruling says
  "a failed copy says so"; it does not say for how long.
- **The message is on the button itself.** Nothing moves on the page, but the button is wider
  for those seconds.
- **The league admin's standings carry the same field.** The admin page does not read it.
- **Back from a bout opened in the full history** returns to the fighter's page with the history
  closed.

Named, not fixed (each read in code):

- **The league page now costs more on the server.** For each ranked fighter that no account has
  claimed, the server reads the Events of that fighter's roster rows, one Event after the other.
  It was one read. The page is not cached. Not measured on a real league. Worth a ruling if a
  league page is slow.
- `events.start_date` is free text in the database. A value that is not a plain day would show a
  wrong day on a history line, or none. Not read what the organiser's form sends.
- A recent result with no Event address is a link to `#`. The full history shows the same line
  as plain text. The `#` is older than this work.
- A ranked name is a text-height target, and looks like a link only on hover.
- The Share button is hand-drawn, as the Back link beside it: the shared `Button` has no quiet
  outline look.
- No browser story opens a Tournament of a TEST Event: the unit test holds that rule.
- The fighter profile's share card is still hidden on phones on the public fighter page.
- Not provable here: the share panel itself on a real phone. A story records the call the page
  makes.

## Built on 2026-10-14: the M rows, the signed-in personal space

The operator picked the M rows. All eight are built, reviewed and falsified: eighteen commits,
`5177d8ed` to `371517d5`. The recon read every row again in code first: all eight faults were
still there, and two were worse than the row said (M1, M5).

The operator ruled six times, each asked with a story:

| Asked                                                                                                                                          | Ruling                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Léa reads her inbox at home in Montréal; the message was sent at 09:12 in Lyon. Which time does she see?                                       | **The Event's clock**, with the zone's name. The server adds the Event's zone to each message.                                                               |
| A push tap opens `/notifications`, a bare page with no personal space. Her login is two hours old: the read is refused, the page says "empty". | **Send the phone on to `/me/notifications`**, where the personal space renews the login.                                                                     |
| Léa types a long bio and does not save. Which ways out ask first?                                                                              | **A tab switch, a link of the personal space, and closing or reloading the browser tab.**                                                                    |
| A 12 MB photo is refused. Where does the reason show?                                                                                          | **Under the photo.** A failed upload closes the cropper.                                                                                                     |
| Camille reads the site in French and deletes her account. Which word does she type?                                                            | **SUPPRIMER** in French, **DELETE** in English, small letters and spaces accepted. The page sends DELETE.                                                    |
| Léa adds a medal and forgets its weapon, then presses Save.                                                                                    | **Stop and point at the row.** A row with nothing typed is dropped. Years: **2000 to this year**, on the server too, for "practising since" and for a medal. |

What people get:

- **M1** (`5177d8ed` server, `db94b485` page). Save stops on a half-typed year or an unfinished
  medal, and says why beside the field: a year from 2000 to this year, the competition, the year,
  the weapon. It used to say "Profile saved." while the server CLEARED the start year ("20" was
  sent as nothing) or DELETED a saved medal (medals are replaced whole). The server takes the same
  range, on the fighter's own route and on the organiser's.
- **M2** (`34918926`). A refused photo says why under the photo; a failed upload closes the
  cropper, which used to stay open over the message.
- **M3** (`932c6da9`, `cff6fd87`). The word that confirms a deletion is the reader's own, in any
  case. A refused deletion no longer blames the word: the page always sends DELETE.
- **M4** (`dda07e4c`, `d2d5bb29`, `f55b9995`, `dbf041b2`). An unsaved profile asks "Leave without
  saving?" before a tab switch or a link of the site, and the browser asks before the tab closes or
  reloads. A word typed while a save is out is kept, and stays unsaved. A new photo never counts as
  unsaved: it saves at once.
- **M5** (`c199db2a` server, `de65be0c` page). The inbox shows each message's time on its Event's
  clock ("14 Oct, 09:12 CEST"), a placeholder while it reads, and renews a lapsed login; a login
  that did not come back goes to sign-in. `/notifications` sends the phone on to
  `/me/notifications`: every push already sent still opens the inbox.
- **M6** (`805d8b1f`, `39bebaad`). An instructor's roster is read again after a failed read. An
  older read that answers after an accept's newer one is not shown.
- **M7** (`0c886b5b`). Referee history lists the Event of the latest bout first, and the latest
  Tournament first inside it.
- **M8** (`c0db46e5`). The security page shows a spinner while it reads. Change password, change
  email and the delete dialog are real forms: Enter submits them, and a password manager is told
  whose password it is.

### The review and the seeded breaks

One cold review read the first eleven commits: no blocker, one major, three minors, four nits.
Each was read again in code before its fix.

- **On a phone, the menu drawer stayed open** under the page a guarded link opened (`d2d5bb29`).
  The guard stopped the click from reaching the link's own handler, which closes the drawer. Next's
  `Link` gives up on a prevented click by itself: the guard now only prevents it.
- **A word typed while the profile saved was lost** (`f55b9995`). Older than this work, but the new
  guard promised that unsaved edits are kept.
- **A refused deletion said "type the word again"** (`cff6fd87`): impossible, the page sends the
  word itself.
- **An older roster read could answer last** and put an accepted fighter back on the waitlist
  (`39bebaad`).
- Nits: a fallback that cannot fire removed from the API (`fd0d3b85`); a sentence built only when
  shown.

83 seeded breaks ran over the rows and their fixes: 77 red. Of the six green ones, three were
three copies of one rule ("a tab that left the form holds nothing unsaved"): two copies are gone,
the form is the one owner, and a story holds it (`dbf041b2`). One was a rule no story used (a
photo upload is not an unsaved edit): a story now holds it. Two were tests whose value equalled
the break's (`371517d5`). The five ran again: red. 82 cases, 82 red.

Then the gate chain (36 of 36), API coverage (green) and the whole browser suite (400 passed,
10.8 min; 29 stories are new). No migration, no route, no OpenAPI change.

What the build chose, not ruled. Say so if one is wrong:

- **"This year" on the server is the year at UTC+14**, the latest year anywhere, so a phone just
  past New Year is not refused. The page checks the phone's own year.
- **A profile saved earlier with a year before 2000 cannot be saved** until that year is changed.
  The page points at the field.
- **An empty "practising since" still clears it.**
- **The browser's Back button is not guarded.** Next has no clean way to stop it.
- **Referee history is ordered by the bouts' planned time**, not their end time: the history
  carries no end time, and this needs no server change.
- **A new message in French shows its zone as "UTC+2"**, where English shows "CEST": that is the
  browser's own short name.

Named, not fixed (each read in code):

- The delete dialog asks a Google-only account for "your current password", which it has not.
- A fighter can write medals to the database directly (the table's owner policy, migration 0123):
  the year range holds at the API only.
- The referee history and the fighter profile read by raw `fetch`: no login renewal there.
- A guarded link that carries its own `replace` or `scroll` loses them: no profile link has one.

## Still not checked

- Whether the site header overflows at 360px for an account with admin access — needs a browser.
  The row holds four items and cannot wrap (`_components/SiteHeader.tsx:112-152`).
- Long fighter names on a 720p TV (`TVScoreboard.tsx:416`) — needs a real screen.
- Whether a dismissed penalty review can be reopened; if not, O11 matters more.
- Not read at all: start-of-day, the organiser live board, clubs, HEMA Ratings export, theme, the
  AI assistant, backups, and the pass / QR flow.

## Verification, per slice

- A failing test first for each behaviour (hard rule 10). Examples: the offline return clears
  `loading` (P4); Space is ignored while the round-break screen is up (P2); a 500 on the guest
  schedule renders Retry, not the sign-in title (F1); a 22:30Z bout shows under its Event-zone day
  (F2); `completed` is not sent until confirmed (O1).
- Pad slices: the offline E2E suite stays green (hard rule 3).
- Every new string: en + fr keys, then the i18n sweep run directly, because turbo caches it.
- `myclash-gates` chain before each push.
