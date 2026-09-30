# ADR-0008: Append-only history and least-privilege database roles

- Status: Accepted
- Date: 2026-09-30
- Requirements: FR-10, FR-18, FR-21, NFR-6

## Context

FR-18 requires every ticket to keep a full, immutable history of its status changes and messages. The SRS explains why: in a support system, losing the trail of what happened to a ticket defeats its purpose.

"The application never updates messages" is a promise about code, and code changes. The same is true of the AI guardrail: "the worker never writes messages" is only as strong as the next pull request. Reviewers will test both rules directly, so we want them enforced by the database, where application code can't get around them.

## Decision

### 1. Append-only tables

`messages` and `audit_events` are append-only. Each has two triggers:

- a `BEFORE UPDATE OR DELETE` row trigger;
- a `BEFORE TRUNCATE` statement trigger.

Both call a function that raises an exception naming the table. Triggers fire for every database role, including the table owner. A bug, a careless migration or a manual `psql` session can't rewrite history without first dropping the trigger, and dropping it would itself be a visible, reviewed migration.

```sql
CREATE FUNCTION forbid_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER messages_append_only
  BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION forbid_history_change();

CREATE TRIGGER messages_no_truncate
  BEFORE TRUNCATE ON messages
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_change();
```

Attachment rows are not updated by any code path in v1 either. They are not trigger-protected yet, because antivirus scanning (a future step) will need to record a scan result on them.

### 2. Write-once ticket fields

A trigger rejects changes to a ticket's `reference`, `number`, `brand_id`, `customer_id`, `channel`, `subject`, `description` and `created_at` after insert. Status, priority, assignment and escalation do change, and every change writes an audit event in the same transaction.

### 3. What an audit event records

| Field                                  | Content                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `actor_type`                           | `customer`, `agent` or `system`                                                 |
| `actor_customer_id` / `actor_agent_id` | Who did it (both empty for `system`)                                            |
| `action`                               | For example `ticket.status_changed`                                             |
| `entity_type`, `entity_id`             | What changed                                                                    |
| `ticket_id`                            | The ticket, when there is one (it is empty for agent role changes, for example) |
| `before`, `after`                      | JSONB containing only the fields that changed                                   |
| `request_id`                           | Links the event to the API request and its logs                                 |
| `created_at`                           | When it happened                                                                |

Actions recorded:

- tickets: created, status changed, priority changed, assignment changed, escalated;
- messages: public message and internal note added, attachment added, AI suggestion used in a reply;
- agents: invited, role changed, deactivated, reactivated;
- knowledge base: article published, unpublished, archived.

Message bodies are not copied into audit rows. The message row is itself the immutable record.

### 4. CHECK constraints

The database refuses states the application should never produce, so a bug fails loudly instead of corrupting data:

- `messages`: exactly one author. A customer author has `author_customer_id` set and `author_agent_id` empty, and an agent author the reverse.
- `messages`: customers can't write internal notes (`author_type = 'customer'` implies `visibility = 'public'`).
- `messages`: `ai_suggestion_id IS NULL OR approved_by_agent_id IS NOT NULL`.
- `messages`: `approved_by_agent_id IS NULL OR approved_by_agent_id = author_agent_id`. The agent who sends a suggestion is the agent who approved it.
- `messages`: a composite foreign key `(ai_suggestion_id, ticket_id)` references `ai_suggestions (id, ticket_id)`, so a message can only use a suggestion generated for its own ticket.
- `customers`: `password_hash IS NULL OR email_verified_at IS NOT NULL`. There are no passwords on unverified emails ([ADR-0003](0003-authentication-and-sessions.md)).
- `sessions`: the realm matches the identity columns. A `customer` session has a customer and no agent; a `staff` session has an agent and no customer or guest ticket.
- `tickets`: `resolved_at` is only set on `resolved` or `closed` tickets; `closed_at` only on `closed` tickets; `first_response_at` is never earlier than `created_at`.
- `attachments`: the size is between 1 byte and 10 MB.

The data model document lists every constraint with its exact expression.

### 5. Least-privilege roles

Three database roles, each with its own connection string:

| Role           | Used by                     | Privileges                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsd_migrator` | Migrations and seeding only | Owns the schema and runs DDL. Never used by a running service.                                                                                                                                                                                                                                                                                                                    |
| `dsd_api`      | The API                     | Reads and writes the tables it serves. On `messages` and `audit_events`: SELECT and INSERT only. On `outbox_events`: INSERT only. On `kb_chunks` and `ai_suggestion_sources`: SELECT only.                                                                                                                                                                                        |
| `dsd_worker`   | The worker                  | SELECT on what its handlers read. INSERT and UPDATE on `ai_suggestions`, `ai_suggestion_sources`, `kb_chunks` and `notification_deliveries`. INSERT on `auth_tokens` (it creates the tokens for emailed links). UPDATE and DELETE on `outbox_events`. DELETE on expired `sessions` and `auth_tokens`. **No INSERT, UPDATE or DELETE on `messages`, `tickets` or `audit_events`.** |

Privileges are granted explicitly, table by table, in migrations. We don't use `ALTER DEFAULT PRIVILEGES`, so a new table is unreachable by the API and the worker until a migration grants access. Forgetting a grant causes a clear, early test failure rather than a silent hole.

Local development creates the three roles in the Postgres container's init script, with passwords taken from environment variables.

### 6. Erasure requests

Append-only history conflicts with data-protection requests to erase personal data. v1 doesn't handle erasure, but the design leaves a clean path for it: a `SECURITY DEFINER` function owned by a dedicated role that no service connects as. The trigger would recognise that role and allow exactly one change: replacing a message body with a redaction marker, with its own audit event. The record that something was said, by whom and when, would stay. The personal content would go.

## Consequences

- Immutability and the AI guardrail hold even if the application code is wrong.
- Missing privileges fail loudly in tests instead of opening a gap.
- There are three database roles and three connection strings to manage, and every migration that adds a table must add its grants.
- A typo in a sent message can't be fixed; a correction is a new message. That is the point of an immutable thread.

## Alternatives considered

- **Application-level rules only.** Simpler, but they rely on every current and future code path behaving.
- **Event sourcing for tickets.** Full history by construction, but far more machinery than FR-18 needs. The audit table provides the history without it.
- **One shared database role.** Simpler to operate, but then the worker could write messages, and the database could no longer back up the AI guardrail.
- **Row-level security for brand scoping.** The right tool for strict multi-brand isolation at scale. v1 filters by brand in the repositories and keeps row-level security as the multi-brand hardening step.

## Verification

Database tests in `packages/db/test/`, run against real Postgres:

- UPDATE, DELETE and TRUNCATE on `messages` and `audit_events` fail, both as `dsd_api` and as the owning role.
- Changing a write-once ticket field fails.
- Each CHECK constraint rejects a row built to break it.
- Connected as `dsd_worker`, inserting into `messages` fails with "permission denied".
- Connected as `dsd_api`, updating `messages` fails before the trigger is even reached.
- A privilege snapshot test lists the privileges of `dsd_api` and `dsd_worker` on every table and compares them with the expected matrix, so any drift is visible in review.
