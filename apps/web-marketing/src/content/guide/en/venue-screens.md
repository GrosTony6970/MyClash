---
title: Screens at the venue
description: 'The screens you can put on a TV or a projector at the venue, how to open them, and what each one shows.'
order: 20
section: day
---

**What you'll learn:** which screen to put where, where to find its address, and what to check
before the day. Every screen is a web page: open it in the browser of the computer or TV that
drives the screen.

## The piste screen: one per piste

The main screen, for the audience and the fighters. It shows the bout on that piste: both
fighters with their club, the score in large type, the cards, the clock, the exchanges, and the
next bout. When a bout ends, it moves to the next bout on that piste by itself after a few
seconds. With nothing left on the piste it shows **Waiting for next match...**.

- **Address:** `app.myclash.fr/e/<your event>/lice/<piste>/display`. It is public.
- **Where to find it:** open **Event Staff**. On a tablet account that has pistes, **External
  display URLs** lists **Display for** each piste, with **Copy URL**. Or open **Live**, open a
  piste's row, and click **Piste kiosk ↗**.
- **Its controls** appear when you move the mouse or touch the screen, and hide again after a few
  seconds: **Switch Lice**, **⇄ Swap sides** (puts red and blue the other way round, for a
  screen that faces the piste from the other side), **Fullscreen**, and **All displays**.
- It updates live. If the connection drops, it keeps the last picture and shows **Not updating**
  (or **Slower updates**) until it catches up.

## The list of screens

`app.myclash.fr/e/<your event>/display` opens **Displays**: the bouts **Now live**, and **Choose
a Lice** with **Open display** for each piste. Open it on the computer by the TV and pick the
piste there. Its address is on **Event Staff**, in the **Staff sign-in** panel: **All displays
(Lice picker)**, with **Copy URL**.

## A bout on a second screen, from the pad

When you open the scoring pad from your workspace (click a bout in **Pools**, **Bracket** or
**Schedule**), the pad shows **↗ External display**. It opens the bout's scoreboard in a new
window: drag it to the second screen and click **Fullscreen**. Here **⇄ Swap sides** is on by
default, for a screen that faces the audience. The window follows the pad to the next bout.

A scorekeeper who signed in with a PIN does not have this button: use the piste screen. In
**Live**, a piste's row also has **TV ↗**, which opens the same scoreboard.

## The wall: every piste at once

For your own table: one row per piste, the pistes that need you first, with the score, the state
of the bout, the clock and how late the piste runs. It refreshes every few seconds.

- **Address:** `admin.myclash.fr/display/wall/<event number>`. The event number is the long code
  after `/events/` in your workspace address. No button leads to this screen: type it.
- It needs a sign-in to your workspace with the **Scorekeeper** role or above.

## For phones: the Live page

`app.myclash.fr/e/<your event>/live` shows each piste, the bout on it and the next one. It is
made for spectators' phones, not for a TV. While the event runs, its page shows a **Live now**
button that leads there.

## Before the day

- **A test or draft event is hidden.** Its public screens show a page that is not found, unless the browser is
  signed in to MyClash with an account of your organisation: sign in at `app.myclash.fr` first.
- **A screen shows what the server knows.** A tablet that scores without network sends its hits
  when the network comes back; the screen shows them then.
- **Try each screen on the real TV,** with the venue's network, before the first bout. Give the
  screens a reliable connection: when it drops, the picture freezes.
