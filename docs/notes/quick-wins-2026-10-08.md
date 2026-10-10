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
| P7      | ✔ The tablet sleeps during a bout.                                                                                                                                       | One `useWakeLock` hook in `packages/ui/src/hooks`, shared with T7.                       | No unlocking the tablet while two fighters wait.                                                        | no `wakeLock` anywhere in the repo                                                                    | S    |
| P8      | ✔ A downward swipe reloads the pad, which with no network lands on P3.                                                                                                   | `overscroll-behavior: none` on the pad.                                                  | A scroll gesture can no longer throw the official out of the bout.                                      | `src/styles/globals.css`                                                                              | S    |
| P9      | ✔ Reset asks a French official to type the English words `RESET MATCH`, in exact capitals. A trailing space blocks it.                                                   | Trim and upper-case what is typed; say why the button is disabled.                       | The safeguard still stops accidents, without stopping the person who means it.                          | `src/components/MatchCorrectionsDrawer.tsx:403`; `apps/api/.../matches.service.ts:1201`               | S    |
| ~~P10~~ | ~~A list penalty that resolves to a red or black card is issued with one tap inside a scrolling list.~~ Done `4c44c421`.                                                 | Confirm red and black, as the direct-card path does; keep yellow one-tap.                | A scroll that lands as a tap cannot disqualify a fighter.                                               | `ScoringColumn.tsx:466-474, 507`; `DirectCardPanel.tsx:186`                                           | S    |
| P11     | The sync bar's Retry and "Review refused" buttons are about 20px tall.                                                                                                   | Grow the bar to a 44px row when it needs the operator.                                   | The one button that recovers unsent exchanges can be hit first time.                                    | `src/components/SyncBar.tsx:18-21, 139`                                                               | S    |
| P12     | Back, "Match actions", display and theme buttons in the pad header are under 44px.                                                                                       | `min-h-[44px]`, as `LiceHeader.tsx:39` already has.                                      | Fewer missed and wrong taps under time pressure.                                                        | `MatchHeader.tsx:126, 206, 220`; `src/theme/ThemeSwitcher.tsx:65-78`                                  | S    |
| P13     | ✔ Nothing sounds or vibrates when time runs out; the numeral turns red.                                                                                                  | Vibrate + short beep at expiry; a 10ms vibrate on a registered tap.                      | The official watches the fighters, not the tablet.                                                      | `ScoringCenterControls.tsx:384-398`                                                                   | S    |
| P14     | "Is it synced?" text is 11–12px.                                                                                                                                         | Raise to `text-sm` / `text-base`.                                                        | Readable at arm's length.                                                                               | `ScoringColumn.tsx:241`; `ScoringCenterControls.tsx:411, 567-576`                                     | S    |
| P15     | The penalty search keeps its text after a card is issued.                                                                                                                | Clear on success; label and 44px height.                                                 | The next penalty starts from a clean list.                                                              | `ScoringColumn.tsx:152, 182-206`                                                                      | S    |
| P16     | The piste list shows no count of unsent or refused exchanges.                                                                                                            | Use the existing `SyncBar` there.                                                        | The official sees between bouts that something is still waiting to go out.                              | `app/lices/[liceId]/_components/LiceHeader.tsx:8-23`                                                  | S–M  |
| P17     | The last piste is not remembered.                                                                                                                                        | Remember it, following `src/lib/last-event.ts`.                                          | One tap less every time the pad is reopened.                                                            | `app/page.tsx:53`                                                                                     | S    |
| ~~P18~~ | ~~The corrections drawer rewrites an exchange as "no exchange" with one tap.~~ Done `97230507`.                                                                          | Confirm the rewrite; 44px targets.                                                       | A slip in the drawer cannot erase a scored hit.                                                         | `MatchCorrectionsDrawer.tsx:143-146, 335-342`                                                         | S    |
| P19     | Only Space has a keyboard shortcut.                                                                                                                                      | Add undo and Double to the same handler.                                                 | A laptop table scores without the mouse.                                                                | `MatchView.tsx:525-563`                                                                               | S–M  |
| P20     | The doubles counter reads `2/3` and explains itself only on hover.                                                                                                       | A visible "Doubles" caption.                                                             | A new official is not left guessing on a touch screen.                                                  | `ScoringCenterControls.tsx:509-516`                                                                   | S    |

## S — staff sign-in (`apps/web-staff/app/login`)

| #   | Today                                                                                                       | Fix                                                                                | What it brings                                                                             | Where                                        | Size |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- | ---- |
| S1  | Wrong PIN, too many tries, no network and no Event chosen all show the same sentence.                       | Branch on the failure kind (`failureMessage` exists); en + fr.                     | A volunteer stops retyping a correct PIN into a lockout, and the organiser is not fetched. | `useStaffPinLogin.ts:51-52`                  | S    |
| S2  | Autocorrect rewrites the username; the fallback field is labelled "Event slug".                             | `autoCapitalize="none" autoCorrect="off"`, autocomplete hints, label "Event code". | Sign-in works first time on a borrowed tablet.                                             | `StaffPinForm.tsx:48-62`; `fields.tsx:45-56` | S    |
| S3  | The organiser email form prints "POST /api/v1/auth/magic-link failed (400)" and has no heading or way back. | `failureMessage`, a heading, a "use another address" button.                       | Volunteers stop typing their email into the wrong form.                                    | `MagicLinkForm.tsx:36, 42-83`                | S    |
| S4  | The Event picker shows the stored date string as-is.                                                        | Format it in the UI language.                                                      | Today's Event is found at a glance among similar names.                                    | `src/components/EventPicker.tsx:154`         | S    |

## T — TV and projector screens

| #      | Today                                                                                                                                     | Fix                                                                                          | What it brings                                                                   | Where                                                                                                      | Size |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---- |
| ~~T1~~ | ~~Five seconds after a bout ends, the piste TV jumps to a per-Match address. It then follows Match ids, not the piste.~~ Done `aa38439a`. | Have the piste screen pass its own address through the existing `buildNextDisplayHref` prop. | A bout moved to another piste no longer strands the TV until someone walks over. | `packages/ui/src/components/TVScoreboard.tsx:144`; `next-display-href.ts:13`; `lice-display-client.tsx:80` | S    |
| T2     | A French hall reads "MATCH ENDED", "Next match in 3…", "NEXT ▸", and a pill saying `halted`.                                              | Seven strings to en + fr keys.                                                               | The hall reads the screen in its own language.                                   | `TVScoreboard.tsx:354, 372, 632, 656, 663, 667, 687`                                                       | S    |
| T3     | The "next up" names are in phone-sized type.                                                                                              | Use the existing stage type scale.                                                           | The next two fighters see they are up from the warm-up area, without a call-out. | `TVScoreboard.tsx:341-343, 362, 371-378`; scale at `packages/ui/src/theme.css:139-143`                     | S    |
| T4     | The public piste TV cannot swap red and blue sides. The organiser popup can.                                                              | A swap button in `DisplayControls`, same stored key.                                         | Spectators stop giving a point to the wrong fighter.                             | `display-view.tsx:29-47`; `DisplayControls.tsx:123-136`                                                    | S    |
| T5     | No fullscreen button; the laptop driving the TV can sleep.                                                                                | Fullscreen button + the wake-lock hook from P7.                                              | Setup is one tap, and the screen does not go black mid-Pool.                     | no `requestFullscreen` in the repo                                                                         | S    |

## F — fighter and spectator, public pages (`apps/web-public/app/e/[eventSlug]`)

| #      | Today                                                                                                                                             | Fix                                                                                       | What it brings                                                                 | Where                                                                                                     | Size |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---- |
| ~~F1~~ | ~~✔ A guest whose schedule fails to load is told to sign in. No link, no retry.~~ Done `6eb64916`.                                                | Tell a 401 from a failure: Retry for one, sign-in and "find my name" links for the other. | A fighter with weak signal retries, instead of thinking they have no schedule. | `my-schedule/page.tsx:213, 231-234, 246-258`                                                              | S    |
| ~~F2~~ | ~~✔ A bout at 00:30 local time gets its own day chip, and tapping the chip hides it. West of UTC the chip shows the wrong day.~~ Done `30011b27`. | Filter on the same Event-zone day key the grouping uses.                                  | No fighter misses a late bout because the app hid it.                          | `my-schedule/page.tsx:283` (raw ISO prefix) vs `:227, 304-306`; label `:412-415`                          | S    |
| F3     | Bouts on the guest schedule cannot be tapped.                                                                                                     | Link each card to the Match page.                                                         | Score and exchanges are one tap from "my next bout".                           | `my-schedule/page.tsx:448-460`                                                                            | S    |
| F4     | ✔ The live board shows who fights but no score. The server sends the score; the page drops it.                                                    | Reuse `home/_components/LiveMatchCard.tsx`.                                               | "What's the score on piste 3?" is answered on the phone.                       | `live/page.tsx:11-19, 85-91`; `apps/api/.../schedule/live-state.service.ts:27-29`                         | S    |
| F5     | The live board says "Updates automatically" after it has stopped.                                                                                 | The freshness chip the Match page already has.                                            | Nobody trusts a frozen score.                                                  | `live/page.tsx:115-117, 339`                                                                              | S–M  |
| F6     | While the Event runs, "Live now" is the last block on the Event home.                                                                             | Move it under the header when the Event is running.                                       | The first screen answers what people came for.                                 | `home/PublicHome.tsx:321`                                                                                 | S    |
| F7     | The Event home has no door to "my schedule" or "find my name".                                                                                    | One card near the top.                                                                    | A first-time guest reaches their bouts in two taps, not five.                  | only inbound link: `src/components/public-personal-decision.ts:59`                                        | S    |
| F8     | Guest pages show times in the phone's time zone.                                                                                                  | `formatInZone` with the Event zone, as elsewhere.                                         | A fighter travelling from abroad does not arrive an hour late.                 | `my-schedule/page.tsx:117`; `people/[personId]/page.tsx:314, 348`; `live/page.tsx:40`                     | S    |
| F9     | ✔ A followed fighter's upcoming bouts show no piste. The server sends it.                                                                         | Add the field to the page's type and render it.                                           | A friend or coach knows where to go.                                           | `people/[personId]/page.tsx:44-57, 303-320`                                                               | S    |
| F10    | The guest schedule loads once and never says how old it is.                                                                                       | Reuse `useMySchedule` and its "Updated HH:MM" badge.                                      | The schedule survives a dead zone, and says when it was last right.            | `my-schedule/page.tsx:202-236`; `src/components/me/hooks.ts:73-117`                                       | M    |
| F11    | After sign-in the fighter always lands on `/me`. `?next=` is sent and ignored.                                                                    | Read `next`, validate with the existing `isOwnSitePath`.                                  | Sign-in returns you to the page you were on.                                   | `login/page.tsx:67`; `login/auth-requests.ts:94, 128`                                                     | S–M  |
| F12    | On login, Enter does nothing; an empty field fails silently.                                                                                      | A real `<form onSubmit>` and an "enter your email" message.                               | Sign-in works from the phone keyboard and with a password manager.             | `login/page.tsx:61, 80, 113, 123, 274-331`                                                                | S    |
| F13    | A mistyped Event link gives a near-blank page. The app has no not-found page.                                                                     | `notFound()` on a missing Event; one localised 404 with a way home.                       | A wrong QR code or link says so, and offers the way back.                      | `_components/EventHeader.tsx:68`; `home/PublicHome.tsx:104`                                               | S–M  |
| F14    | Error pages offer "Try again" only.                                                                                                               | Add a link to the Event home or `/`.                                                      | No dead end when the retry also fails.                                         | `error.tsx:26-35`; `app/me/error.tsx:22-31`                                                               | S    |
| F15    | ✔ Tabs read "Longsword Open · MyClash — MyClash", "Home — fal-2026", "Match 12".                                                                  | Drop the suffix; resolve the Event name once in the layout; name the two fighters.        | Shared links and browser history read like the Event, not like an address.     | `layout.tsx:26-28`; `t/[tournamentSlug]/page.tsx:52, 59`; `match/[matchId]/page.tsx:119`                  | S–M  |
| F16    | League, login and personal-space pages share the generic site title.                                                                              | A root title template and per-page titles.                                                | Several open tabs can be told apart.                                           | no `metadata` in `app/leagues/*`, `app/login/page.tsx`, `app/me/layout.tsx`                               | S    |
| F17    | Referee roles appear as raw English (`main referee`).                                                                                             | One en/fr label map.                                                                      | French referees read their role in French.                                     | `my-schedule/page.tsx:505`; `people/[personId]/page.tsx:344`                                              | S    |
| F18    | `/live`, `/my-schedule`, `/pass` and a person's page have no back link.                                                                           | Add the existing `BackLink`.                                                              | One tap back to the Event home.                                                | `live/page.tsx:248`; `people/[personId]/page.tsx:192-205`                                                 | S    |
| F19    | No share button on Match or Tournament pages.                                                                                                     | Generalise `src/components/fighter/ShareProfile.tsx` to any address.                      | "Watch my bout" is one tap to send.                                            | only that component exists                                                                                | S–M  |
| F20    | No add-to-calendar.                                                                                                                               | A client-side `.ics` of the schedule.                                                     | The phone reminds the fighter, with the app closed.                            | no `.ics` in the repo                                                                                     | M    |
| F21    | League ranking names are plain text; a fighter's full history is undated and cannot be opened.                                                    | Send the fighter slug and link it; show the date; link each bout.                         | From a rank to the fighter to the bout, without searching.                     | `leagues/[slug]/StandingsGroups.tsx:125-127`; `fighters/[slug]/_components/MatchHistoryModal.tsx:115-143` | S    |

## M — the signed-in personal space (`apps/web-public/app/me`, `app/profile`)

| #   | Today                                                                                       | Fix                                                        | What it brings                                                   | Where                                                          | Size |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | ---- |
| M1  | Profile save says "saved" while it drops a half-typed start year and incomplete medal rows. | Validate both before saving, as the birth date already is. | No medal found missing from a public profile weeks later.        | `profile/fighter/FighterProfileClient.tsx:649-655, 688-689`    | S    |
| M2  | A refused photo shows its reason a full form-length below the photo button.                 | Show it under the photo, or as a toast.                    | The fighter knows why at once, and picks another file.           | same file `:567-627` set, `:1163` render                       | S    |
| M3  | Typing "delete" shows as DELETE but the button stays dead.                                  | Store the upper-cased value.                               | Account deletion — a GDPR right — is not a dead end on a phone.  | `me/security/page.tsx:210, 280`                                | S    |
| M4  | Switching profile tab discards unsaved edits.                                               | A dirty flag and `useConfirm` before the switch.           | Nobody retypes a bio after glancing at another tab.              | `me/profile/ProfileTabs.tsx:86-92`                             | M    |
| M5  | The notification inbox has no dates, and says "empty" while loading or signed out.          | Show the time; add loading and sign-in states.             | "Piste 3 delayed 20 min" can be told from this morning's notice. | `notifications/NotificationSettingsClient.tsx:24, 98, 277-298` | S    |
| M6  | An instructor's attendee list never retries after one failed load.                          | Clear the error flag on reopen.                            | The roster arrives on the second tap, not after a full reload.   | `me/instructor/InstructorDashboard.tsx:~560-575`               | S    |
| M7  | Referee history is ordered by number of bouts, not by date.                                 | Sort by the latest bout.                                   | Yesterday's bouts come first.                                    | `profile/referee/RefereeProfileClient.tsx:243`                 | S    |
| M8  | The security page is blank while loading; Enter does not submit.                            | A spinner and a real `<form>`.                             | Password managers and keyboards work.                            | `me/security/page.tsx:51-72, 129-160`                          | S    |

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

| Asked with this story                                                                                                                                                           | Ruling                                                                                                                                                                                                                                                                                              | Done       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A best-of-3 bout, no wifi. Red reaches the cap in round 1. With wifi the server says "round over". The server judges with the Tournament's ruleset, which is not on the tablet. | **The tablet closes the round at the cap**, or at the doubles limit, from the score it shows, marked "not confirmed". The official taps "Start round 2". When the server counts another way, "Start round 2" is held with the rest of its bout behind it, and the screen goes back to the server's. | not built  |
| No wifi: hit 1, hit 2, hit 3, "End match". The server refuses hit 2. Hit 3 and the End still went, and the bout ended on the server without hit 2.                              | **A held hit stops the rows of its own bout behind it**, as a held clock press does. One line in the inbox says how many wait. Retry or Discard frees them. Other bouts keep sending. This replaces the older ruling for hits.                                                                      | `c626976b` |
| A session has ended and the queue holds only a Pause. The bar says "HITS NOT SENT".                                                                                             | **"ENTRIES NOT SENT"**, in the four sentences of the bar, with the matching French ("SAISIES NON ENVOYÉES").                                                                                                                                                                                        | `06694b47` |

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

Not ruled: "End round" on time with no network. The operator chose the cap alone for the tablet's
own close; ask before a time end of a round is taken on the tablet.

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
