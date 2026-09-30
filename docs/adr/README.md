# Architecture decision records

This folder records the significant design decisions for the DSD Unified Customer Support System. Each record says what problem we faced, what we decided, what it costs us and what we rejected, so the reasoning is still there after the code has moved on.

## Index

| ADR                                          | Title                                                              | Status   |
| -------------------------------------------- | ------------------------------------------------------------------ | -------- |
| [0001](0001-technology-stack.md)             | Technology stack                                                   | Proposed |
| [0002](0002-monorepo-layout.md)              | Monorepo layout and module boundaries                              | Proposed |
| [0003](0003-authentication-and-sessions.md)  | Authentication, sessions and the customer and staff realms         | Proposed |
| [0004](0004-authorization-rbac.md)           | Permission-based RBAC with resource-level checks                   | Proposed |
| [0005](0005-outbox-queues-notifications.md)  | Transactional outbox, job queues and notifications                 | Proposed |
| [0006](0006-ai-suggestions-and-guardrail.md) | Grounded AI reply suggestions and the human-approval guardrail     | Proposed |
| [0007](0007-ticket-lifecycle.md)             | Ticket lifecycle, assignment, escalation and reporting definitions | Proposed |
| [0008](0008-data-integrity-and-db-roles.md)  | Append-only history and least-privilege database roles             | Proposed |
| [0009](0009-attachments.md)                  | Attachment validation, storage and download                        | Proposed |

## Conventions

- Files are numbered in order and never renumbered: `NNNN-short-title.md`.
- Status is one of Proposed, Accepted, Superseded by ADR-NNNN, or Deprecated.
- An accepted ADR is not rewritten when the decision changes. A new ADR supersedes it, and the old one links forward to it.
- Requirement IDs (FR-x, NFR-x, UI-x, API-x) refer to the [SRS](../SRS.md).
- Every ADR ends with the tests or checks that will prove it holds, so a decision can't quietly drift from the code.

## Template

```markdown
# ADR-NNNN: Title

- Status: Proposed
- Date: YYYY-MM-DD
- Requirements: FR-x, NFR-y

## Context

The problem, and the constraints that shape the answer.

## Decision

What we will do, stated plainly.

## Consequences

What gets easier, what gets harder, and what we accept.

## Alternatives considered

The options we rejected, and why.

## Verification

The tests or checks that prove the decision holds.
```
