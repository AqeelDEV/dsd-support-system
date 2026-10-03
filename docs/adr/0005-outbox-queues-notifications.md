# ADR-0005: Transactional outbox, job queues and notifications

- Status: Accepted
- Date: 2026-09-30
- Amended: 2026-10-01 and 2026-10-02 (see [Amendments](#amendments))
- Requirements: FR-5, FR-18, FR-20, FR-21, NFR-2, NFR-4, NFR-10

## Context

Several things that follow a ticket change are slow or unreliable. The system has to email the customer (FR-5), generate an AI suggestion (FR-21) and embed knowledge-base articles. NFR-4 says this work shouldn't block the request that triggered it. NFR-10 says a failure in it mustn't stop a customer submitting a ticket or an agent replying.

The obvious approach is "save to the database, then push a job to Redis". That is two writes to two systems with no transaction spanning them:

- If the process dies between the commit and the push, or Redis is down, the ticket is saved but the email is never sent, and nobody finds out.
- If we push first and the database transaction then rolls back, a job refers to a ticket that doesn't exist.

## Decision

### 1. Write the event in the same transaction as the change

Every mutation writes three things in one Postgres transaction: the change itself, its audit event ([ADR-0008](0008-data-integrity-and-db-roles.md)), and one `outbox_events` row per domain event. They commit together or not at all.

### 2. Event catalogue

| Event                       | Written when                                        | Consumed by                                                                            |
| --------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ticket.created`            | A ticket is submitted (guest or account)            | `notifications` (acknowledgement with access link), `ai-suggestions`                   |
| `message.created`           | A public reply or an internal note is added         | `notifications` (public agent replies only), `ai-suggestions` (customer messages only) |
| `ticket.status_changed`     | Status changes                                      | `notifications`                                                                        |
| `ticket.priority_changed`   | Priority changes                                    | none yet                                                                               |
| `ticket.assigned`           | Assignment changes                                  | none yet (agent notifications are future work)                                         |
| `ticket.escalated`          | A ticket is escalated                               | none yet                                                                               |
| `kb.article_published`      | An article is published, or republished after edits | `kb-indexing`                                                                          |
| `kb.article_unpublished`    | An article is unpublished or archived               | `kb-indexing` (retires its chunks)                                                     |
| `ai.suggestion_requested`   | An agent asks for a new suggestion                  | `ai-suggestions`                                                                       |
| `customer.signup_requested` | A customer starts registration                      | `notifications` (verification email)                                                   |
| `guest_access.requested`    | A guest asks for a new access link                  | `notifications`                                                                        |
| `agent.invited`             | A supervisor or admin invites an agent              | `notifications` (invite email)                                                         |

Events with no consumer yet are still written. Auto-triage and sentiment (FR-23) or a future CRM integration can subscribe to them without touching the code that raises them.

Payloads carry IDs and small facts only (`ticketId`, `messageId`, `visibility`, `fromStatus`, `toStatus`), never message bodies or email addresses. Handlers read what they need from Postgres. That keeps personal data out of Redis and out of job logs, and means a handler always works from current data rather than a stale copy.

### 3. The dispatcher

The dispatcher runs inside the worker process:

1. Every 500 ms (configurable), it opens a transaction and selects up to 100 undispatched rows in ID order with `FOR UPDATE SKIP LOCKED`.
2. For each row it adds one BullMQ job per consuming queue, with the job ID `<eventId>:<queue>`.
3. It marks the rows dispatched and commits.

`SKIP LOCKED` lets several worker instances dispatch in parallel without ever picking up the same rows.

If Redis is unreachable, step 2 fails, the transaction rolls back and the rows wait for the next tick. A Redis outage delays work; it doesn't lose it.

If the worker crashes after adding jobs but before committing, the same rows are dispatched again on the next tick. BullMQ ignores a job whose ID already exists, so most duplicates stop there, and handlers are idempotent for the rest. Delivery is therefore **at least once**.

Dispatched rows are deleted after 7 days by a cleanup job. The outbox is a transport, not a history; the history lives in `audit_events`.

### 4. Queues, retries and the dead-letter queue

| Queue            | Job                                 | Attempts | Backoff                                  |
| ---------------- | ----------------------------------- | -------- | ---------------------------------------- |
| `notifications`  | Send one notification               | 5        | Exponential from 10 seconds, with jitter |
| `ai-suggestions` | Generate a reply suggestion         | 3        | Exponential from 5 seconds, with jitter  |
| `kb-indexing`    | Chunk and embed one article version | 5        | Exponential from 10 seconds, with jitter |
| `dead-letter`    | Jobs that ran out of attempts       | n/a      | n/a                                      |

BullMQ has no built-in dead-letter queue, so the worker adds one. When a job fails its final attempt, a listener copies it (source queue, name, data, error and attempt count) into `dead-letter` and marks the related row as failed: `notification_deliveries.status` or `ai_suggestions.status`. Dead-lettered jobs stay for inspection and can be replayed with a worker script once the cause is fixed.

Jitter spreads retries out, so a recovering SMTP server isn't hit by every failed job at the same instant.

### 5. Idempotent handlers

- **Notifications.** `notification_deliveries` has a unique key on (event, channel, recipient address). The handler creates or loads that row, skips it if it is already `sent`, and otherwise sends and marks it sent. A crash between the provider accepting the email and the row being updated can still send the email twice. We accept that: a rare duplicate email is a better failure than a missing one.
- **AI suggestions.** There is one suggestion per ticket and triggering event, so a retry updates the same row rather than creating a second one.
- **Knowledge-base indexing.** Chunks are keyed by article, version and position, so running the job again replaces them.

### 6. Debouncing AI work

Customers often send several short messages in a row. Suggestion jobs use BullMQ's deduplication with a per-ticket key and a short delay (about 10 seconds), so a burst of messages produces one suggestion that takes all of them into account.

### 7. Notifications (FR-5, FR-20)

```ts
interface NotificationChannel {
  readonly kind: "email"; // later: "sms" | "whatsapp"
  send(message: RenderedNotification): Promise<DeliveryResult>;
}
```

- `NotificationService.notify(recipient, template, data)` chooses the channels for a recipient (only email in v1), renders the template for each channel and records one `notification_deliveries` row per channel.
- The email channel uses Nodemailer over SMTP. Locally it points at Mailpit, whose web UI shows every email sent. In production it can point at any SMTP provider.
- Templates are typed functions that return a subject, a plain-text body and an HTML body. Every interpolated value is HTML-escaped, and no template accepts raw HTML from users.
- The customer receives an email when their ticket is received (with an access link), when an agent sends a public reply (with the reply text and a fresh access link) and when the status changes. A reply that also changes the status produces one email that mentions both. Internal notes never produce a customer notification.
- Adding SMS or WhatsApp later means writing a new channel adapter, storing a phone number and contact preference on the customer, and adding a template variant. Nothing that raises events has to change.

## Consequences

- No lost events and no phantom events. Work is delayed during a Redis outage, never dropped.
- Request latency never includes SMTP or LLM time.
- Personal data stays in Postgres rather than in queue payloads.
- Delivery is at least once, so every handler must be idempotent, and a rare duplicate email is possible.
- A job can start up to one polling interval (500 ms) after its event is committed.
- There is one more table and one more background loop to run and monitor.

## Alternatives considered

- **Enqueue from the API after commit.** A dual write: events are lost if the process crashes between the two, or if Redis is down.
- **Postgres `LISTEN/NOTIFY` as the transport.** Notifications are lost if no listener is connected at that moment. It is useful later as a wake-up signal to cut polling latency, not as the source of truth.
- **Change data capture** (logical replication, Debezium). No polling and it scales well, but it needs Kafka Connect or similar infrastructure. It is the option at 100 times the volume.
- **Kafka or RabbitMQ.** Durable and capable, but heavier to run than BullMQ on the Redis we already need, and nothing in v1 needs replayable logs or complex routing.
- **Sending email inside the request.** The simplest option, but an SMTP outage would then fail ticket submission, which NFR-10 rules out.

## Verification

- Integration, atomicity: a mutation writes the change, the audit event and the outbox row together; forcing a failure after the ticket insert leaves no outbox row behind.
- Integration, dispatch: the dispatcher moves rows onto the right queues and marks them dispatched. Two dispatchers running at once never dispatch the same row twice.
- Integration, Redis outage: with Redis stopped, rows stay pending and are dispatched once it returns.
- Integration, idempotency: the same notification job processed twice sends one email.
- Integration, degradation: with SMTP unreachable, ticket submission and agent replies still succeed. The job retries with backoff and lands in `dead-letter` after its last attempt, and the delivery row shows `failed`.
- Integration, content: emails read through the Mailpit API contain the reply text and never contain internal-note text.
- Unit: template escaping, channel selection, retry settings per queue.
- End to end: an agent's reply produces an email visible in Mailpit.

## Amendments

### 2026-10-01, Phase 5

1. **Payloads for the events Phase 5 writes (section 2).** `agent.invited { agentId }`, written when an agent is invited and when an invite is sent again; `kb.article_published { articleId, version }`, the version to index; and `kb.article_unpublished { articleId }`, written when a published article is unpublished or archived. Archiving a draft writes none, because nothing public changed ([ADR-0012](0012-knowledge-base-canned-responses-reports-and-agents.md), section 1).

### 2026-10-02, Phase 6

2. **Job IDs (section 3)** are `<eventId>.<queue>`: BullMQ refuses `:` in a custom job ID. Adding the same ID twice is still a no-op.
3. **Only queues with a consumer are routed to (section 2).** In Phase 6 that is `notifications`, for `ticket.created`, `message.created`, `ticket.status_changed`, `customer.signup_requested`, `guest_access.requested`, `agent.invited` and the new `customer.password_reset_requested`. An event nobody consumes yet is marked dispatched without a job, so the outbox doesn't keep it and Redis holds no jobs no worker will take. `ai-suggestions` and `kb-indexing` are added with their workers in Phase 9, with a one-off backfill of the articles published before then.
4. **Fail-fast producer connection.** Jobs are added on a Redis connection with no offline queue, so during an outage a dispatch fails at once and rolls back instead of hanging with its rows locked. Queue consumers use a second connection whose commands wait for Redis to return, as BullMQ needs.
5. **Dead letters (section 4).** The job's own processor handles its last attempt: it marks the event's unsent deliveries `failed` with the error, copies the job (queue, ID, name, data, error, attempts, time) to `dead-letter` under the same ID, then fails. Doing it in the processor rather than in a `failed` listener means a process that stops right after still has the copy. A payload that can never succeed (it doesn't match its event's schema) is dead-lettered at once. `pnpm --filter @dsd/worker dead-letter list | replay <job ID> | replay --all` lists and replays them; a replayed job goes back on its queue under a new ID with its attempts reset. Notification retries use exponential backoff from 10 s with 50% jitter.
6. **One email per reply (section 7).** The handler for a public agent reply reads the `ticket.status_changed` row written in the same transaction (same `messageId`) and mentions the new status; the status event itself sends nothing when it carries a `messageId`. A customer's reply that reopens their ticket carries its `messageId` too, so it sends nothing. Status changes made on their own, which only staff make, send a status email.
7. **Notification data is built only when sending.** `NotificationService` creates or loads the delivery row first and skips one already sent; only then does it build the template's data, so a repeated job doesn't create a token that no email carries.
8. **Notification channels** have `kind`, `addressOf(recipient)` and `send(to, from, message)`; templates render once (subject, text and HTML) and each channel uses what suits it. Adding SMS means a channel, a value in the `notification_channel` enum and short-text templates.
9. **Nightly clean-up (section 3).** A BullMQ job scheduler runs it at 03:00 UTC on a `maintenance` queue: expired sessions, tokens a week past expiry, outbox rows dispatched a week ago and the orphaned-file sweep ([ADR-0009](0009-attachments.md)). Dispatched rows older than a week are gone, so replaying a reply's dead letter after that sends the reply without its status line.

### 2026-10-03, Phase 9

10. **Routing depends on the payload as well as the type (section 2).** `message.created` reaches `ai-suggestions` only when `authorType` is `customer`. Without that filter, an agent's note or reply arriving while a customer's message waits (below) would replace that message's job, and the customer would get no draft at all. `ai-suggestions` and `kb-indexing` are now routed: `ticket.created`, customer `message.created` and `ai.suggestion_requested` to the first, `kb.article_published` and `kb.article_unpublished` to the second.
11. **How the debounce works (section 6).** Suggestion jobs use BullMQ 6's deduplication with the key `ticket.<ticketId>`, `replace: true` and `keepLastIfActive: true`. A customer's message waits `AI_DEBOUNCE_MS` (10 s by default); a newer job for the same ticket replaces a waiting one, so a burst gets one draft. A job added while the ticket's draft is being written is kept and runs after it, so the latest message is never missed and two drafts for one ticket never run at the same time. New tickets and agents' requests don't wait. Handlers read the ticket as it is when they run, so whichever job runs sees the whole burst. A replaced job never finishes, so the next draft for the ticket marks older pending suggestions as superseded instead of leaving them "being drafted" for ever.
12. **Concurrency.** Suggestions run four at a time per worker (the time goes on waiting for the model). Indexing runs one at a time, so a backfill embeds articles one after another and stays inside a provider's free-tier rate limit; its five attempts with backoff ride out a per-minute quota.
13. **The backfill is a reconcile, not a one-off (amendment 3).** At start-up and in the nightly job the worker finds published articles whose current version lacks current chunks embedded with the configured model, and current chunks of articles no longer published, and queues an indexing job for each. The worker can't write outbox rows, so it adds these jobs directly, with IDs made from the article's state and the model, so workers starting together queue each article once. This covers the seed, a change of embedding model (mock to Gemini) and any lost event.
14. **A dead-lettered suggestion is marked failed (section 4)**, with the error kept for operators and never shown in the API. Replaying it drafts again: the suggestion for that ticket and event goes back to `pending`.
