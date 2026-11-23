---
title: About MyClash
description: 'Who builds MyClash, how AI is used, and why it is free.'
order: -1
section: about
---

MyClash was started by Anthony Garnier. I am a cloud architect: virtualisation, public cloud,
containers, networks, storage and systems are my daily work. Writing application code is not.

It began with MyFAL, an app I vibe-coded for the Fosse aux Lions 2026 tournament in Lyon. It was not
perfect, but the feedback was good, and people asked how it could work for other tournaments.
MyClash is the answer to that question: one platform that fits each organiser's and club's way of
working, without changing the code for each of them.

## AI, a tool

Most of the code is written by AI — mainly Anthropic's Claude — under my direction. I decide what
gets built, I test it, and I run it on my own server. In about six months this became a stable,
feature-rich platform that I could not have built alone in my free time.

I see AI as a tool. What matters is how the tool is used. Here, that means:

- Every agent works under a
  [written contract](https://github.com/GrosTony6970/MyClash/blob/main/CLAUDE.md): hard rules on
  scoring, offline use, data access and referee safety.
- Every change is tested and must pass the full chain of checks before it lands.
- The scoring engine must reproduce the official Fosse aux Lions 2026 results, byte for byte.
- Fixes go to the root cause, not around it.

For me, AI is an accelerator and an opportunity. It lets one person turn an idea and a vision into
a real product without deep knowledge of every layer. I am trying to bring HEMA into the 21st
century with the tools we have today.

## Not alone

HEMA clubs near Lyon help with beta testing and with ideas for new features.

## Free and open

MyClash is free and open source (AGPL-3.0). I build it in my free time, and I pay for the AI
subscription and the server myself. No company is behind it.

## No service guarantee

There is no service-level agreement (SLA). Each organiser is responsible for their own event and
for what they do with the platform. We still do our best to keep MyClash up and available: an
automated ops agent checks the server every day, and alerts (errors, monitoring) reach me by email
and on my phone. The [terms of use](/en/terms) are the reference.
