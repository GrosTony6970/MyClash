---
title: AI features
description: 'Your own AI key, the four tools it opens, what they send to the AI provider, and the limits.'
order: 26
section: beyond
---

**What you'll learn:** how to turn the AI features on for your organisation, what each tool does,
and what it sends to the AI provider. You need the **Admin** role for all of it.

## Turn it on

MyClash does not pay for your AI: your organisation adds its own key.

1. Open **AI settings** in your organisation's menu.
2. Add a key from Anthropic, OpenAI, Mistral or Google.
3. Leave **Enable AI features for this organization** and **Enable the organizer chatbot** on.
   Switch them off to stop the AI without removing the key.

Without a key, every AI tool says so and does nothing.

## The four tools

| Tool                  | Where                                                                            | What it does                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **AI Assistant**      | The event menu; **AI suggest** on the Pools, Bracket and Schedule pages opens it | Prepares a draft: a tournament's settings, a pool plan, a bracket plan, a schedule grid or referee assignments |
| **Chatbot**           | The event menu                                                                   | Answers questions about your event and proposes changes                                                        |
| **Tournament recap**  | The tournament's settings                                                        | Writes a short recap of the results, in English or French, for the public page                                 |
| **Event description** | **Draft with AI** in the event's form                                            | Writes the description field. Nothing is saved until you save the form                                         |

## Nothing changes without you

- **AI Assistant:** describe what you want in the **Organizer prompt**, choose the **Draft type**
  and click **Create draft**. Read the **Draft preview**, then **Apply** or **Reject**.
- **Chatbot:** each change it proposes shows as a card. **Confirm & apply** makes the change;
  **Dismiss** drops it.
- Neither one deletes a bout that has been fought.
- Referee assignments go through the same checks as yours: a refused assignment stays refused.
- Neither one changes a completed event.
- **Recap:** **Generate recap**, read it, then **Publish**. **Regenerate** writes a new draft;
  the published recap stays on the public page until you publish the new one. **Unpublish** takes
  it down.

## What the AI provider receives

| Tool              | What is sent                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| AI Assistant      | The event's name, the tournament and your prompt. It sees no pool, bout or person, so a pool, schedule or referee draft can fail      |
| Chatbot           | Your messages, and what it reads to answer: tournaments, pools, pistes, bouts to schedule, counts, and the names of assigned referees |
| Tournament recap  | The results, with the names and clubs on the podium                                                                                   |
| Event description | The event's name, city and dates, and the names of its tournaments and workshops                                                      |

The chatbot's conversations are shared: every admin of your organisation can read them.

## Limits

- **Monthly budget** (in **AI settings**): what your organisation spends in a month.
- **Spend cap (EUR)** (under **AI Budget** on the event's overview): what one event spends.
- The MyClash team can switch the AI off for everyone, and has a monthly limit of its own.

The limits are checked before each call, so one call can go a little over.
