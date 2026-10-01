# ADR-0011: The ticket API: submissions, files, reading and concurrency

- Status: Accepted
- Date: 2026-10-01
- Requirements: FR-1, FR-2, FR-3, FR-7, FR-8, FR-9, FR-10, FR-11, FR-16, FR-18, FR-19, NFR-1, NFR-7, NFR-9, API-1

## Context

[ADR-0007](0007-ticket-lifecycle.md) settles what can happen to a ticket and [ADR-0009](0009-attachments.md) how files are checked and stored. Building the HTTP API on top of them raised questions those records don't answer:

- How does a file travel with the ticket or reply it belongs to, and when are its bytes read?
- The ticket-submission rate limit counts per email (ADR-0003, section 10), but the global guard runs before the body is parsed. How is the email counted?
- How do lists page, and how much of a ticket does one request return?
- How are two simultaneous changes to one ticket kept apart?
- Which brand does a new ticket belong to, and how does staff brand scope apply to customers, who have no brand?
- Which errors does a client need to tell apart?

## Decision

### 1. Routes

| Realm    | Route                                                                                                                                  | Body                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Public   | `POST /api/v1/public/tickets`                                                                                                          | multipart: email, subject, description |
| Customer | `GET` and `POST /api/v1/customer/tickets`, `GET .../{ticketId}`, `POST .../{ticketId}/messages`, `GET .../{ticketId}/attachments/{id}` | multipart for the two POSTs            |
| Staff    | `GET /api/v1/staff/tickets`, `GET .../{ticketId}`, `POST .../replies`, `POST .../notes`                                                | multipart for replies and notes        |
| Staff    | `PATCH .../{ticketId}/status`, `PATCH .../priority`, `POST .../assignment`, `POST .../escalate`                                        | JSON                                   |
| Staff    | `GET .../{ticketId}/audit-events`, `GET .../{ticketId}/attachments/{id}`, `GET /api/v1/staff/customers/{customerId}`                   | none                                   |

Each staff route requires one permission from ADR-0004 (`ticket:read:any`, `ticket:reply`, `ticket:note:create`, `ticket:status:update`, `ticket:priority:update`, `ticket:assign`, `ticket:escalate`, `ticket:audit:read`, `customer:read`). A reply that also changes the status needs `ticket:status:update` too, and moving someone else's ticket needs `ticket:reassign:any`; services check both.

### 2. Files travel with their message

The five routes that take files (submission in both realms, customer replies, staff replies, internal notes) take `multipart/form-data`. One request is one ticket or one message with its files, written atomically. Everything else takes JSON.

- **Fields first, then files.** Every field must come before the first file, and all files go in the `attachments` field. The fields are validated (strict zod, the same `validation-error` as JSON) as soon as the first file appears, before any of its bytes are read, so an invalid form never costs an upload. A field after a file is a 400. Browsers send a form's fields in document order, and S3's browser uploads have the same rule (the file last).
- **No file chosen.** An empty value in `attachments` means no file. Browsers send a file input left empty as a nameless, zero-byte file, and Swagger UI sends an unused slot as an empty field. Text there is a 400.
- **Access before bytes.** The handler hands the files over unread. The service checks the caller can see the ticket (404 otherwise) before reading any file; state rules (a closed ticket, an invalid transition) are checked under the row lock (section 6), after the files are stored, and a refusal deletes them again ([ADR-0009](0009-attachments.md), amended).
- **Early refusals close the connection.** When a request fails before its upload has been read to the end, the response asks the client to close the connection rather than the server reading the rest just to discard it.
- **Limits.** Busboy enforces 10 MB per file (413), 5 files (400) and bounded field sizes, from the constants in `packages/shared`.

### 3. Who may submit, and how it is counted

- A guest submits through the public route and gets only the reference back. **No session is created**: only the owner of the inbox can open the thread, through the emailed link (ADR-0003, section 6). The customer row is found or created by normalised email, so a known address's ticket lands on that account, marked unverified.
- A signed-in customer submits through the customer route. The account's email is the contact and is already verified, so `contact_verified_at` is set at once. A guest session (one ticket from an emailed link) gets 403 there: it can't add tickets to an account it can only see one ticket of.
- **Rate limits.** The policy is 10 an hour per address and 5 an hour per email, and it lets requests through when Redis is down. The guard counts the address, as for every route. The email is inside a multipart body the guard can't read, so the submission service counts it once the fields are valid (for a signed-in customer, the account's email), through the same `RateLimitEnforcer`.

### 4. Reading

- **A ticket view carries its whole thread**, oldest first, with each message's files, in both realms. The agent and the customer always need all of it, a support thread is bounded by human conversation, and one request keeps opening a ticket inside NFR-1's budget. The view is read in one repeatable-read, read-only transaction, so the messages and files agree.
- **Lists page with keyset cursors**: the queue, a customer's tickets (both realms) and a ticket's audit events. `limit` is 1 to 100 (default 25); `nextCursor` is null on the last page. A cursor is base64url JSON of the sort order, the last row's sort key and its ID. Timestamps in cursors keep PostgreSQL's microseconds, because a JavaScript `Date` keeps milliseconds and would skip or repeat rows created in the same millisecond. A cursor from another sort order, or one that doesn't parse, is a 400.
- Cursors are **not signed**. Every query still filters on what the caller may see, so a hand-made cursor can only move where a page starts; it can't reveal a row.
- **The queue** defaults to `open` tickets, the ones that need action. `status` and `priority` take several values; `assignee` is `me`, `unassigned` or an agent ID; `escalated` is true or false. `sort=priority` orders by priority then age, matching `tickets_queue_idx`; `oldest` and `newest` order by age.
- **The customer's timeline** is `open` at creation followed by each `ticket.status_changed` audit event: the status and the time, never who.

### 5. What each realm is told

- Customer responses come from customer schemas that have no field for an internal note, a priority, an assignee, an escalation or `updatedAt` (which moves when staff work behind the scenes). A unit test walks every customer schema for such fields.
- Staff ticket responses include `allowedTransitions` and `allowedActions` for the caller, computed by the same functions the services enforce (`ticket-status.ts`, `ticket-actions.ts`).
- Every staff change answers with the updated staff ticket (200, or 201 for replies and notes), and a customer reply with the customer's view, so the apps never re-fetch to see the result.

### 6. One transaction and one lock per change

Every change runs in one transaction that locks the ticket row first (`SELECT ... FOR UPDATE`), checks its rules against the locked row, and writes the change, its audit events and its outbox events through `TicketChanges`. Concurrent changes to a ticket therefore run one after the other, and each is checked against the result of the one before. Claims use the same lock (ADR-0007 described a conditional `UPDATE`; the guarantee, one winner and a 409 for the other, is the same, and one mechanism serves every change).

A change to what the ticket already is (the same status, priority or assignee) writes nothing and answers 200.

Audit events and outbox payloads, which the seed's history follows too:

| Change             | Audit `before` / `after`                                 | Outbox payload                                                        |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Ticket created     | `null` / `{ status, priority, channel }`                 | `ticket.created { ticketId, customerId }`                             |
| Message added      | `null` / `{ visibility }` (entity: the message)          | `message.created { ticketId, messageId, authorType, visibility }`     |
| Attachment added   | `null` / `{ messageId, contentType, sizeBytes }`         | none                                                                  |
| Status changed     | `{ status }` / `{ status }`                              | `ticket.status_changed { ticketId, fromStatus, toStatus, messageId }` |
| Priority changed   | `{ priority }` / `{ priority }`                          | `ticket.priority_changed { ticketId, fromPriority, toPriority }`      |
| Assignment changed | `{ assigneeAgentId }` / `{ assigneeAgentId }`            | `ticket.assigned { ticketId, fromAgentId, toAgentId }`                |
| Escalated          | `{ escalated }` / `{ escalated: true, assigneeAgentId }` | `ticket.escalated { ticketId, escalatedByAgentId, assigneeAgentId }`  |

`messageId` on a status change names the reply that carried it, so the worker can send one email about both (ADR-0005, section 7). Every audit event carries the request's ID.

### 7. Brands

- New tickets go to the brand named by `TICKET_BRAND_SLUG` (default `dsd`). With several brands, each intake (app, address or channel) would name its own.
- Staff queries filter `brand_id` against the agent's memberships in SQL. A customer isn't brand-owned, so a customer is visible to an agent when they have a ticket in one of the agent's brands, and the customer view lists only those tickets.

### 8. Errors a client branches on

| Status | Problem type                | When                                                                            |
| ------ | --------------------------- | ------------------------------------------------------------------------------- |
| 409    | `invalid-status-transition` | The state machine refuses the target; `allowedTransitions` lists the others     |
| 409    | `ticket-closed`             | A reply, priority, assignment or escalation on a closed ticket                  |
| 409    | `already-assigned`          | A claim on a ticket someone else holds                                          |
| 422    | `about:blank`               | An assignee or supervisor who is unknown, deactivated or outside the brand      |
| 413    | `about:blank`               | A file over 10 MB                                                               |
| 415    | `about:blank`               | A file that isn't an image, a PDF or strict plain text; or a non-multipart body |
| 503    | `about:blank`               | The object store is unreachable, for a request with files or a download         |

404 means the ticket, file or customer doesn't exist or isn't the caller's to see, with the same answer either way (ADR-0004, section 3).

### 9. The web apps don't restyle API responses

The shared Next.js config applies the pages' security headers to every path except `/api/`. Responses under `/api/` come from the API through the proxy and keep the API's own headers, so a download keeps its sandboxing policy. The proxy's own error answers send `nosniff` themselves.

## Consequences

- A ticket and its files, or a reply and its files, succeed or fail together, and nothing invalid reaches the object store.
- Clients must send fields before files. Our forms and `FormData` do; a hand-written client that doesn't gets a clear 400.
- Opening a ticket returns everything at once. A ticket with thousands of messages would be slow to open; paging the thread is the change at that point.
- Every change to a ticket waits for the one before it. Contention per ticket is tiny, and the second change sees the first instead of overwriting it.
- Customer views can't leak staff fields, because their schemas can't hold them.

## Alternatives considered

- **JSON bodies with a separate upload endpoint**, files uploaded first and referenced by ID. It needs a state for files that belong to nothing yet, and a guest, who has no session after submitting, couldn't attach anything.
- **Uploads straight to the object store with presigned URLs.** The file can then only be checked after it lands, which needs a quarantine step. ADR-0009 keeps this for a much larger scale.
- **Paging the thread.** More requests to open every ticket, for a size of thread support conversations don't reach.
- **Offset pagination.** Deep pages cost more, and rows shift while new tickets arrive.
- **Signed cursors.** They protect nothing the query filters don't already protect.
- **Optimistic locking with a version column.** Every client would have to send a version; the row lock keeps the API simpler (ADR-0007).
- **Counting the email in the guard** by parsing multipart bodies before the guards run. Files would then be read, or even stored, before authentication and the origin check.

## Verification

- Unit: `ticket-status` and `ticket-actions` (every transition, every assignment rule), `cursor`, `content-check`, `filename`, `download` (the `Content-Disposition` encoding); shared `requests` (strictness, NUL characters, query parsing) and `responses` (no staff-only field in a customer schema).
- Integration: `tickets-create`, `customer-ticket-view`, `ticket-lifecycle`, `internal-notes`, `staff-queue`, `staff-ticket-view`, `assignment`, `escalation`, `attachments`, `audit-trail`, `attachment-intake`, `object-store`.
- RBAC: every route in the matrix, with a fresh ticket per cell; a customer ticket route has rows for the demo customer's and the guest's own ticket, a staff ticket route for a ticket inside and outside the agents' brand, and assignment has a row where an agent gets 403 taking a colleague's ticket.
- Smoke (Compose): a guest submits a ticket with a file through the customer app, the agent finds it in the queue and downloads it with the sandboxing headers.
