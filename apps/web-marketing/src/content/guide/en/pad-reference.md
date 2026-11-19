---
title: Pad reference
description: 'Every control of the scoring pad, when it is available, what it allows, and what needs the network.'
order: 17
section: day
---

**What you'll learn:** every control of the scoring pad, in which state of the bout it works, and
what to do when something goes wrong. To train a volunteer, start with the
[Scorekeeper sheet](/en/guide/scorekeeper-sheet).

## Signing in

- The **Staff sign-in** link of your event opens the form with the event already filled in. An
  account's own link also fills in its **Username**: the volunteer types only the **PIN**.
- Without the link, the tablet shows a list of events to pick from.
- An organiser can sign in with their own account (the email form below the PIN form): with the
  **Scorekeeper** role or above, they can score any piste, without a PIN.
- **Your Lices** lists the pistes of the account. **Practice going offline**, on that page, runs a
  two-minute drill without network; it is refused while the tablet still has something to send.
- A piste's page shows the bout in progress, the next five bouts under **NEXT**, then all the
  bouts of the piste.

## The bout screen

At the top: **Back to match list**, the previous and the next bout of the piste, the bout code,
the tournament, phase and piste, both fighters, their gear check, and **Match actions**. The
theme button switches between Hybrid, Dark and Light.

![The pad while the clock runs](../../../assets/guide/13-pad-running.png)

## What works in which state

| Control                                                   | Not started                    | Clock running | Paused                                                           | Ended                                 |
| --------------------------------------------------------- | ------------------------------ | ------------- | ---------------------------------------------------------------- | ------------------------------------- |
| Main clock button                                         | **Start**                      | **Pause**     | **Resume**                                                       | **Re-open match** (needs the network) |
| **End match** (or **End round**)                          | —                              | yes           | yes                                                              | —                                     |
| **Reset** (the clock only, asks first)                    | —                              | —             | yes, until extra time or sudden death starts (needs the network) | —                                     |
| **Clean hit**, **Afterblow**, **Double**, **No exchange** | off                            | _off_         | yes                                                              | off                                   |
| Penalties                                                 | off                            | yes           | yes                                                              | off                                   |
| Protests                                                  | off                            | yes           | yes                                                              | yes                                   |
| **Undo last entry**                                       | whenever something was entered |               |                                                                  |                                       |

The exchange buttons are off while the clock runs: the referee halts, the scorekeeper pauses,
enters the exchange, and resumes.

**Keys:** the space bar starts and pauses the clock (it never reopens a bout), D enters a double,
U undoes the last entry. Keys do nothing while a dialog is open or a field is being typed in.

## Scoring

- **Clean hit** and **Afterblow** buttons come from the tournament's ruleset: their labels and
  values are the ruleset's.
- In pools and Swiss rounds, **Double** counts towards the limit shown as **Doubles** x/max. At the
  limit the bout ends as the tournament's settings say: a double loss, a draw, or the score stands.
- **No exchange** asks for the reason: **Out of bounds**, **Simultaneous stop**,
  **No valid hit** or another one.
- Under each fighter: the score, and the score against the point cap. At the cap the score turns
  gold. While exchanges wait to be sent, the pad says how many are not sent yet.
- _With the network, the bout ends by itself when a hit reaches the point cap_: the buttons turn
  off and the result appears. Without network, tap **End match** at the cap. Ending before the
  cap or the time asks "End the match now?" first.

## Penalties and protests

- Each fighter has quick buttons for the tournament's usual penalties, and **Search penalties**
  for the others.
- The pad shows the card the fighter will actually get: within a group of the penalty ruleset,
  each repeat earns the next card. A yellow card is given at once; a red or a black card asks
  first (**Issue card**). With the built-in FFAMHE ruleset, red costs one point and black loses
  the bout.
- The hand button records a protest, without a question. When a fighter goes past the
  tournament's protest limit, the pad offers the penalty chosen in the settings
  (**Give the card**).

![A penalty search on the pad](../../../assets/guide/13-pad-penalties.png)

## Match actions

**Match actions** opens the corrections:

- **Swap fighter color** and **Swap fighter side**;
- **Add time** and **Subtract time**;
- pick an exchange, then **Edit as no exchange** to cancel it (with a **Correction reason**);
- **Forfeit**: the fighter, the reason, and whether they can continue in the tournament, then
  **Record forfeit** (while the bout is running or paused);
- **Direct card**: a card without a penalty of the list, with its reason;
- **Reset match**: wipes the bout; you type RESET MATCH to confirm.

Everything in **Match actions** needs the network, except the direct card.

![Match actions, open](../../../assets/guide/13-pad-corrections.png)

## Rounds, extra time and sudden death

- In a best-of bout, the header shows the round, **End match** becomes **End round**, and a break
  screen offers to start the next round.
- When the scores are level at the end of time, the pad offers the next step the tournament
  defines: **Extra time** or **Sudden death** (the bout then ends as soon as one fighter leads).
  The pad refuses to end a level bout that must be decided.
- Resuming once the time is up asks first: close, end the bout, or continue anyway.

## Without wifi

| The bar says                           | What it means                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **ONLINE**                             | All sent.                                                                                                     |
| **SYNCING**                            | Entries are being sent.                                                                                       |
| **OFFLINE - exchanges queued locally** | No network: keep scoring, the tablet keeps everything.                                                        |
| **SYNC ERROR**                         | Sending failed: **Retry**.                                                                                    |
| Hits not recorded, **Review**          | The server refused an entry: open **Review** to retry or discard it. Until then, the rest of that bout waits. |

- _Queued without network:_ hits, cards, protests, the clock (start, pause, resume, end), rounds
  and extra time.
- _Needs the network:_ **Re-open match**, clock **Reset**, unlocking a bout, forfeits, and
  everything in **Match actions** except the direct card.
- A bout ended offline says "Ended on this tablet. The server has not confirmed it yet." It cannot
  be reopened until the network is back.

![The pad without network](../../../assets/guide/13-pad-offline.png)

## Locks and who may undo

- A finished pool or bracket locks itself 15 minutes after its last bout (the tournament's
  **Auto-lock** settings). A locked bout shows a banner and refuses scoring and corrections.
- An organiser (**Editor** or above) can always reopen a locked bout. A tablet account can only
  when the tournament's auto-lock is off.
- A tablet account scores only the pistes it is assigned to.

![The result screen after End match](../../../assets/guide/13-pad-ended.png)
