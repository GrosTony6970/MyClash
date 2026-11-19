---
title: When something goes wrong
description: 'What to do on the day when a score is wrong, a fighter drops out, a referee is missing, a tablet is lost or the day runs late.'
order: 21
section: day
---

**What you'll learn:** how to fix the problems of a competition day, who can fix each one, and
what MyClash refuses. The roles are explained in [Staff access](/en/guide/staff-access).

## Where the fixes are

Most fixes are on the bout's own page. To open it, go to **Pools**, tab **Matches**, and click the
magnifying glass at the end of the bout's row (**Open audit history**); clicking the row itself
opens the scoring pad instead. Or open **Live**, open a piste's row, and click **Audit**.

## A score is wrong after the bout ended

- **One exchange is wrong.** On the bout's page, click **Void** beside it and give a reason (it is
  required). **Restore** brings it back. MyClash recalculates the score from the exchanges. If the
  new score no longer ends the bout (it ended on time, or is now under the point cap), the bout
  goes back to the pad and the scorekeeper ends it again. _Scorekeeper_ or above; _Editor_ or above once the
  bout is locked.
- **The bout must be fought on.** Click **↻ Re-open match**, then **Undo the result**. In a
  bracket, the bouts waiting for this result are emptied. If a later bout was already fought, only
  an _Editor_ or above can go on, by ticking **Yes, discard those bouts and put them back on the
  schedule**: those bouts must be fought again.
- **The result was wrong** (the referees ruled otherwise, a typing error, a tablet failure).
  Record an override, under **Override — the recorded result was wrong**: pick **Referee
  decision**, **Data-entry correction** or **Technical failure**, and enter both scores.
  _Editor_ or above. It counts in the standings and in the HEMA Ratings export.

MyClash refuses a correction that would change a bout already fought from this result, or end a
bout level where draws are not allowed. Nothing is changed then.

By default a bout locks 15 minutes after its pool or its bracket is complete. **Unlock match**
(_Editor_ or above) opens it again.

<aside class="guide-warn">
  <p><strong>Hard to undo.</strong> Once the event is completed, its results are frozen. Re-open,
  forfeits and overrides are refused. A void becomes a request (<strong>Correction request
  submitted for review.</strong>) that the MyClash team approves, not your organisation. Check the
  results before you complete the event.</p>
</aside>

## A fighter withdraws or is injured

- **During or before a bout:** on the bout's page (or on **Bracket**), **Record forfeit**, then
  the reason under **Forfeit — a fighter stopped fighting**: **Injury**, **Voluntary**, **Black
  card (single)**, **Black card (two)** or **Conduct violation**. _Scorekeeper_ or above, or the
  piste's tablet.
- **In a pool or a Swiss round,** an injury or a voluntary forfeit shows **Can continue**, ticked:
  the fighter stays in for their next bouts. Untick it if they leave: their remaining bouts in the
  pools are then forfeited too. Bouts already fought stay and count.
- **In a bracket,** the opponent goes through.
- **The score of a forfeit** comes from your penalty ruleset. With the FFAMHE rules, an injury
  keeps the score of the moment; a voluntary or conduct forfeit is a 0–6 loss, and conduct also
  disqualifies. A fighter's second forfeit in the tournament disqualifies them.
- **A bout that has ended** takes no forfeit: record an override instead.
- **To take a fighter out of a tournament,** open **Participants**, the tournament's tab, and click
  **Withdraw** beside them: "Their remaining Pool bouts will be forfeited." The first fighter on
  the waiting list takes the seat. **Undo withdrawal** puts them back, unless the tournament is
  full by then. _Editor_ or above.
- **A forfeit recorded by mistake:** **Void this record** (_Editor_ or above) gives the bout its
  earlier result and brings the fighter's pool bouts back. It is refused once a later bout has
  started.

## A fighter does not show up

There is no "no-show" reason: record a forfeit with **Voluntary**, or withdraw the fighter. Check
the welcome desk first: its **Not arrived** tab lists who has not been checked in. Some forfeit
rules also disqualify a fighter who forfeits before their first bout.

## A referee is missing

- Change the referee of a pool on **Referees**, or of one bout in **Pools**, tab **Matches**.
  _Editor_ or above.
- The referee rules still apply. MyClash refuses a referee who would referee their own bout, who
  fights or teaches at that time, or who is outside their declared availability. A discouraged
  choice asks you to confirm.
- If the assignments are locked ("Referee assignments are locked. Unlock them on the Referees page
  first."), click **Unlock assignments**, make the change, then **Lock assignments**: locking
  notifies the referees.

## A tablet is lost, or a PIN forgotten

- On **Event Staff**, the account's **Reset PIN** sets a new PIN. **Sign-in link for** the account
  fills in the event and the username: only the PIN is left to type. _Editor_ or above.
- To swap tablets, sign in on the new one with the same username and PIN. One account can be
  signed in on several tablets.
- _A new PIN does not sign out a tablet that is already signed in._ For a lost tablet,
  **Disable** the account (it stops working at once) and create a new one. Do not enable it again:
  the lost tablet would work again too.
- In **Live**, **Assign scorer** gives a piste to another scorer. _Scorekeeper_ or above.

## Hits were refused after scoring offline

The tablet lists them under **Hits the server refused**, with **Retry**, **Discard** and **Discard
all of this match**. They are kept there, not lost: retry once the cause is cleared, or discard a
hit you have already entered again by hand.

You cannot add an exchange from your workspace: enter it again on the pad, or record an override.
After the event, **Debrief** lists them under **Exchanges the server refused**.

## The day runs late

On **Schedule**:

- A piste that is behind shows **▲ 12m late** above its column, with a **+12** button that pushes
  that piste's next bouts back by the delay. The programme's bars do not move.
- On the day itself, **⏱ Running late — 12 min** opens a window to push the rest of the day back:
  every bar and every bout not yet started move together. "Fights already fought, or on a piste
  now, stay where they are." Confirm with **Push the day back**. It is refused if anything would
  move past midnight. _Editor_ or above.

## The wrong fighters, or the wrong piste

- A bout's fighters cannot be changed. In a pool, move the fighter to another pool on **Pools**,
  as long as no bout of either pool has been fought. _Admin_ or above.
- Pools and brackets can be generated again (_Admin_ or above). Once bouts are scored, only the _Owner_ can, by
  typing the number of scored bouts.
- To move a bout to another piste, use the piste list on its row in **Pools**, tab **Matches**.
  _Editor_ or above. A PIN tablet only sees the bouts of its own pistes.
