---
title: Paying referees
description: 'How MyClash works out what each referee earns: points per bout, tiers in euros, the report and its exports.'
order: 25
section: beyond
---

**What you'll learn:** how MyClash works out what each referee earns, and how to set your own
rates. Both tabs are on the event's **Compensation** page. You need the **Admin** role.

## How it works

1. A referee earns points for each **completed** bout they worked. The points depend on their
   role and on the phase: pool, Swiss, bracket or finals.
2. The plan's tiers turn the referee's total points for the event into an amount in euros.
3. The event's minimum and cap then adjust the amount. The minimum wins, even above the cap.

Which bouts count for a referee:

- assigned to a pool: every completed bout of that pool;
- assigned to a piste: every completed bout on that piste;
- assigned to one bout: that bout.

In an elimination phase, a bout named final, gold, bronze or third place counts as **finals**.
The amounts are worked out again each time you open the page, so they change while bouts finish.

## The built-in FFAMHE plan

Points per completed bout:

| Role             | Pool | Swiss | Bracket | Finals |
| ---------------- | ---- | ----- | ------- | ------ |
| Lead referee     | 2    | 3     | 3       | 4      |
| Assessor referee | 1    | 2     | 2       | 3      |
| Table referee    | 1    | 1     | 1       | 2      |

Tiers: 0 to 9 points pay 0 €, 10 to 19 pay 10 €, 20 to 29 pay 20 €, 30 to 49 pay 30 €, 50 and more
pay 50 €.

## Your own plan

Open the **Compensation plan** tab. Built-in plans cannot be changed: make your own.

1. Click **+ New plan** and type the **Plan name**. You can make the plan visible to other
   organisations.
2. **Token rates (pts/match)**: one row per referee role of this event, one column per phase.
   Rates go by half points. Click **Save rates**.
3. **Token to money tiers**: **Min pts**, **Max pts** and **Amount (EUR)**. An empty maximum means
   no limit. **+ Add row** adds a tier. Click **Save tiers**.

<aside class="guide-warn">
  <p><strong>Hard to undo.</strong> A plan belongs to your organisation, not to the event: every
  event that uses it pays the new rates, past events included.</p>
</aside>

- A new plan starts empty: every rate and every amount is 0. It does not copy the FFAMHE plan.
- **A total between two tiers pays 0.** With half points, 9.5 falls between 0–9 and 10–19. Make
  each tier start where the one before it ends.
- A referee role you added yourself earns 0 until you give it a rate.
- A plan that an event still uses cannot be deleted.

## The report

Open the **Referee compensation** tab. Choose the **Compensation plan**, and if you want a
**Minimum (EUR, optional)** and a **Max cap (EUR, optional)**. Save.

The table shows each referee's points per phase, their total, the amount and **Paid**. Click a row
to see the detail by role and phase. The last line is the **Total to pay**. **Export CSV** and
**Export PDF** give the table to your treasurer.

- **Paid** is a record for you: MyClash makes no payment.
- A referee with no completed bout is not in the table.
- On an archived event, the report can be read but not changed.
