# ADR-0007: Ticket lifecycle, assignment, escalation and reporting definitions

- Status: Accepted
- Date: 2026-09-30
- Amended: 2026-10-01 (see [Amendments](#amendments))
- Requirements: FR-1, FR-3, FR-7, FR-8, FR-9, FR-11, FR-13

## Context

The SRS names example statuses (FR-9: open, pending customer, resolved, closed) but leaves several questions open:

- Which transitions are allowed, and who can make each one?
- What happens when a customer replies to a resolved ticket?
- What does "escalate a ticket" mean? UC-6 lists it as a use case, but no functional requirement describes it.
- How far can an agent go when assigning tickets (FR-11)?
- How exactly are the reporting numbers computed (FR-13)?
- What counts as "a contact method" when submitting a ticket (FR-1)?

These answers shape the data model, the API and the tests, so they are settled here rather than decided ad hoc during implementation.

## Decision

### 1. Statuses

| Status             | Meaning                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `open`             | Needs action from support. Every new ticket starts here.                                      |
| `pending_customer` | Support has replied and is waiting for the customer.                                          |
| `resolved`         | Support believes the issue is solved. The customer can still reply, which reopens the ticket. |
| `closed`           | Finished. No further public messages.                                                         |

### 2. Transitions

| From                       | To                 | Who, or what triggers it                                       |
| -------------------------- | ------------------ | -------------------------------------------------------------- |
| `open`                     | `pending_customer` | An agent                                                       |
| `pending_customer`         | `open`             | A customer reply (automatic), or an agent                      |
| `open`, `pending_customer` | `resolved`         | An agent                                                       |
| `resolved`                 | `open`             | A customer reply (automatic), or an agent reopening the ticket |
| `resolved`                 | `closed`           | An agent                                                       |
| `open`, `pending_customer` | `closed`           | An agent, for example for spam or a duplicate                  |
| `closed`                   | none               | Terminal                                                       |

- Any other transition returns 409 with the problem type `invalid-status-transition` and the list of allowed targets.
- Setting a ticket to the status it already has is a no-op: 200, with no audit event.
- A customer reply leaves `open` tickets open, reopens `pending_customer` and `resolved` tickets, and is refused with 409 on `closed` tickets. The customer app then offers to open a new ticket that refers to the old one.
- An agent can send a public reply on `open`, `pending_customer` and `resolved` tickets. The composer can set a new status in the same request ("send and wait for customer", "send and resolve"). That status change goes through the same state machine, in the same transaction.
- Public replies on `closed` tickets return 409. Internal notes are allowed in every status, including `closed`, because they never reach the customer and are useful for follow-ups.

**Where the rules live.** The state machine is one pure module in the API (`apps/api/src/modules/tickets/domain/ticket-status.ts`), unit-tested over every combination of from-status, to-status and actor. Staff ticket responses include `allowedTransitions`, so the agent app never copies the table.

**Concurrency.** A status change runs in a transaction that locks the ticket row (`SELECT ... FOR UPDATE`), checks the transition against the locked row, then writes. If two agents change the same ticket at the same moment, the changes happen one after the other, and the second is checked against the result of the first (and may get 409).

### 3. Timestamps

| Column              | Rule                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `first_response_at` | Set once, by the first public agent reply. Internal notes don't count.                                               |
| `resolved_at`       | Set on every transition into `resolved`, and cleared when the ticket reopens. It always holds the latest resolution. |
| `closed_at`         | Set on the transition into `closed`.                                                                                 |
| `escalated_at`      | Set by the escalate action (section 6). It stays set as a historical fact.                                           |

### 4. Priority

- The priorities are `low`, `normal` (the default), `high` and `urgent`.
- Agents set priority. Customers don't choose it in v1. A suggested priority from auto-triage is FR-23 future work.
- The Postgres enum is declared in that order, so `ORDER BY priority DESC` sorts urgent tickets first without a lookup table.

### 5. Assignment (FR-11, UC-4)

- **Claim.** An agent with `ticket:assign` takes an unassigned ticket. This is one conditional update: `UPDATE tickets SET assignee_agent_id = $agent WHERE id = $ticket AND assignee_agent_id IS NULL`. If no row changes, someone else got there first, and the API returns 409.
- **Assign.** With `ticket:assign`, an agent can give an unassigned ticket, or one they hold, to another active agent who belongs to the ticket's brand.
- **Reassign.** `ticket:reassign:any` (supervisors and admins) moves any ticket, whoever holds it.
- **Unassign.** The current holder, or a supervisor, can return a ticket to the unassigned pool.
- **Deactivation.** When an agent is deactivated, their `open` and `pending_customer` tickets become unassigned, with an audit event each, so nothing is left with someone who can't log in.

### 6. Escalation (UC-6)

The SRS lists "Escalate a ticket" as a use case without a matching requirement, and puts SLA-driven escalation workflows out of scope (§10). In v1, escalation is a deliberate, recorded agent action:

- `POST /api/v1/staff/tickets/{ticketId}/escalate` takes a required reason and, optionally, a supervisor to assign.
- In one transaction it:
  - adds the reason as an internal note;
  - raises the priority to `high` if it is lower (an `urgent` ticket stays `urgent`);
  - assigns the chosen supervisor, if one was given;
  - sets `escalated_at` and `escalated_by_agent_id`;
  - writes the `ticket.escalated` event.
- The queue can filter for escalated tickets, so supervisors see them. `escalated_at` stays set after resolution; the filter combines it with status.

An escalation flag rather than an `escalated` status, because escalation is independent of where the ticket is in its lifecycle. An escalated ticket can still be waiting on the customer.

### 7. What the customer sees (FR-3)

The customer sees their ticket's public messages and a status timeline built from the ticket's `ticket.status_changed` audit events. They never see internal notes, assignment, priority, escalation or AI suggestions.

### 8. Contact method (FR-1)

FR-1 asks for "a contact method". In v1 this is the customer's email address. Guests must enter it, and signed-in customers use their account email. Email is the only notification channel (FR-5), so a different contact method would have no way to reach the customer. When SMS or WhatsApp arrive, the notification layer adds a phone number and a contact preference ([ADR-0005](0005-outbox-queues-notifications.md)).

### 9. Reporting definitions (FR-13)

All metrics use calendar time; business hours are not modelled in v1. They are computed in SQL over the viewer's brands, for a date range (default: the last 30 days), and grouped by day in the reporting time zone (`REPORTING_TIMEZONE`, default UTC).

| Metric                         | Definition                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Ticket volume over time        | Tickets created per day (or week), by `created_at`.                                                                                           |
| Average time to first response | Mean of `first_response_at - created_at`, over tickets created in the range that have had a first response. The median is shown alongside it. |
| Average time to resolution     | Mean of `resolved_at - created_at`, over tickets whose latest resolution falls in the range. The median is shown alongside it.                |
| Tickets per agent              | For each agent: open tickets currently assigned to them, and tickets resolved in the range while assigned to them.                            |

- The median sits next to the mean because a few very slow tickets can drag an average far from what a typical customer experiences.
- Tickets that haven't had a first response yet can't be included in the first-response average. The report shows how many there are, so a growing backlog doesn't make the average look better than it is.
- At much larger volumes these queries move to rollup tables maintained by the worker.

## Consequences

- One tested module decides every status change, and the UI is told the outcome rather than working it out.
- A customer reply can never be lost in a resolved ticket, because it reopens the ticket.
- Two agents can't both claim the same ticket.
- Escalation is visible and auditable without adding SLA machinery that the SRS puts out of scope.
- Calendar-time metrics overstate response times for tickets raised outside working hours. That is acceptable for v1, and the report says which definition it uses.

## Alternatives considered

- **More statuses** (`new`, `on_hold`, `escalated`). `new` duplicates "open with no first response", which the data already shows. An `escalated` status would clash with `pending_customer` and `resolved`.
- **Automatically closing resolved tickets after a number of days.** Common in help desks, but it is the kind of automation the SRS puts out of scope with SLA workflows. It is easy to add later as a scheduled worker job.
- **Letting customers close their own tickets.** Not asked for. A customer who is happy simply doesn't reply, and the ticket stays resolved.
- **Optimistic locking with a version column.** It also prevents lost updates, but it makes every client send a version number. Row locks keep the API simpler, and the contention per ticket is tiny.

## Verification

- Unit: the state machine across every from-status, to-status and actor, including customer-triggered reopening.
- Integration, lifecycle: create, agent reply (sets `first_response_at`), wait for customer, customer reply (reopens), resolve, close. A closed ticket refuses public replies (409) but accepts internal notes. Invalid transitions return 409 with the allowed targets.
- Integration, assignment: two simultaneous claims give one success and one 409; an agent can't take a colleague's ticket (403); a supervisor can; deactivating an agent unassigns their open tickets.
- Integration, escalation: the reason becomes an internal note, priority rises to at least `high`, `escalated_at` is set, the queue filter finds the ticket, and the customer view shows none of it.
- Integration, reporting: a fixed seeded dataset produces volume, averages, medians and per-agent counts that match values worked out by hand.

## Amendments

### 2026-10-01, Phase 4

1. **A closed ticket takes internal notes and nothing else (section 2).** Besides public replies, a change of priority, an assignment and an escalation on a closed ticket answer 409 with the problem type `ticket-closed`. A closed ticket is finished: reassigning it would also move it between agents in the "tickets resolved while assigned" report. A status change answers 409 `invalid-status-transition` with no allowed targets.
2. **Claims use the row lock (section 5).** Every change to a ticket, claims included, locks the row first and checks its rules against the locked row ([ADR-0011](0011-ticket-api.md), section 6). Two simultaneous claims still give one success and one 409 (`already-assigned`), as the conditional update would; one mechanism now serves every change.
3. **An unusable assignee is a 422 (section 5).** Assigning to an agent who doesn't exist, is deactivated or isn't a member of the ticket's brand answers 422, the status the API uses for a well-formed request that refers to something unusable.
4. **Escalation details (section 6).**
   - The reason is kept as an internal note prefixed `Escalated:`, so it reads as an escalation in the thread.
   - The chosen supervisor must be active, a member of the ticket's brand and hold `ticket:reassign:any` (a permission, not a role name), or the request is a 422. The escalation assigns them even if a colleague held the ticket: handing it to a supervisor is what escalating means.
   - A ticket can be escalated again. `escalated_at` and `escalated_by_agent_id` then record the latest escalation, and the audit trail keeps every one.
   - Closed tickets can't be escalated (item 1).
5. **Unassigning a deactivated agent's tickets (section 5)** arrives with agent management in Phase 5, which is where agents are deactivated.
