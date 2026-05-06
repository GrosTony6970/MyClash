# ADR-007 — Funding model: donations only at v1

**Date:** 2025-01-01
**Status:** Accepted

## Context

The platform has ongoing infrastructure costs (VPS, domain, backups). A funding model is needed that:

- Does not paywall any feature
- Is legal and simple to administer for a French association (Lyon AMHE)
- Is transparent to the community

## Decision

**Voluntary donations only, processed via HelloAsso under the Lyon AMHE association.**

Donation link: `https://www.helloasso.com/associations/lyon-amhe/formulaires/2`

100% of donations go directly to hosting and infrastructure costs. No salary or profit drawn.

## Consequences

- **Easy:** Legally simple; HelloAsso handles payment processing and receipts for donors. No VAT complexity at these volumes.
- **Hard:** Revenue is unpredictable; the project owner absorbs any shortfall. Acceptable for a volunteer community tool.
- **Committed to:** Donation link and transparency statement maintained on the marketing site. Annual cost/donation reconciliation published informally.

## Alternatives considered

- **GitHub Sponsors** — US-centric; less suitable for a French association.
- **Patreon** — Takes a cut; more appropriate for content creators than infrastructure.
- **Freemium features** — Contradicts the free-for-all mission (ADR-006).
