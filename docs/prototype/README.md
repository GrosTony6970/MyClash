# docs/prototype/ — superseded, and empty

> **This directory is not a design reference. It never contained one.**
>
> **`/DESIGN.md` at the repo root is canonical.**

## What this was

A placeholder for an original HTML prototype that was meant to establish MyClash's design language (Cinzel + Inter typography, red/blue HEMA palette, gold accents, shield motifs).

**The prototype HTML was never committed.** This README asked someone to "drop the prototype HTML files here" and nobody did. The directory has only ever held this file.

## Why it's kept

For the record — because until 2026-07-17 `AGENTS.md` told every agent and contributor that _"the prototype design language is canonical"_, pointing here. Agents followed it and produced UI in a language the product had already left behind:

| The prototype described         | The product actually ships                                                |
| ------------------------------- | ------------------------------------------------------------------------- |
| Cinzel (display) + Inter (body) | **Fraunces** (display) + **Geist** (body) + JetBrains Mono                |
| Shield motifs                   | the **FoilMark** — a fencing foil's cross-guard hairline                  |
| —                               | two orthogonal scopes: `[data-theme='dark']` × `[data-accent='personal']` |

The Cinzel/Inter language is not imaginary — it still runs on the static marketing site (`apps/web-marketing`), which is why the claim survived in the docs for so long. That app's migration is tracked as [D4](../design/known-deviations.md#d4--web-marketing-is-still-on-the-legacy-design-language).

## Where to go instead

| For                             | Read                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| The design language             | [`/DESIGN.md`](../../DESIGN.md)                                    |
| A specific surface              | [`docs/design/`](../design/)                                       |
| Known gaps between doc and code | [`docs/design/known-deviations.md`](../design/known-deviations.md) |
| Token values (source of truth)  | `packages/ui/src/theme.css`                                        |
| The rendered contract           | the `/admin/design-system` route                                   |
