# tests/

Top-level cross-app test suites that don't belong to any single workspace.

| Subdirectory | Purpose                                                                                                                                                                      | Owner task     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `e2e/`       | Playwright end-to-end tests spanning multiple apps (e.g. organizer creates tournament → competitor onboards → scorekeeper records exchanges → public app shows live results) | T-1501 dry-run |
| `a11y/`      | Axe accessibility audits on critical user flows                                                                                                                              | T-1403         |

Per-package unit tests live in their respective workspace (`packages/rulesets/test/`, `apps/api/test/`, etc.). Use this directory only for tests that span workspace boundaries.
