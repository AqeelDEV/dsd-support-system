# Software Requirements Specification

## DSD Group — Unified Customer Support System (v1.0)

|                     |                                          |
| ------------------- | ---------------------------------------- |
| **Document status** | Draft for candidate technical assignment |
| **Version**         | 1.0                                      |
| **Prepared for**    | DSD Group                                |
| **Prepared by**     | DSD Group Engineering                    |
| **Date**            | 2026-09-29                               |

---

## 1. Introduction

### 1.1 Purpose

This document specifies the requirements for a **Unified Customer Support System** for DSD
Group: a single platform through which DSD's customers can raise and track support requests,
and through which DSD's support team can receive, manage, and resolve them. It is written as a
technical assignment brief as much as a product spec - the intent is for a candidate engineer to
design and build a working v1.0 from it, making their own technology choices, while producing an
architecture that can credibly grow into a system serving a much larger user base later.

### 1.2 Scope

Version 1.0 delivers three integrated components sharing one backend:

1. A **customer-facing application** through which customers submit and track support requests.
2. A **support-team application** through which DSD agents receive, triage, and resolve those
   requests.
3. A **shared backend/API** that both front ends talk to, owning the data model, business logic,
   authentication, and notifications.

v1.0 is deliberately scoped to be buildable by one engineer in a bounded timeframe (see §9) while
never precluding the growth path described in §11. Where a feature is explicitly a "v1.0 must-have"
versus "designed-for, not required yet," this document says so - build the must-haves properly
rather than spreading effort thin across everything DSD might eventually want.

### 1.3 Intended audience

- The engineer building this system.
- DSD Group stakeholders evaluating the resulting submission.

### 1.4 Definitions, acronyms, abbreviations

| Term              | Meaning                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| **Ticket / Case** | A single customer support request, from creation through resolution.            |
| **Channel**       | The means by which a ticket entered the system (web form, email, chat, etc.).   |
| **Agent**         | A DSD support-team member who works tickets.                                    |
| **SLA**           | Service Level Agreement — a target time-to-first-response / time-to-resolution. |
| **RBAC**          | Role-Based Access Control.                                                      |
| **KB**            | Knowledge Base — published self-service articles.                               |

### 1.5 Document conventions

Requirements are labeled `FR-x` (functional) and `NFR-x` (non-functional) for traceability.
**MUST** = required for v1.0. **SHOULD** = strongly recommended if time allows. **FUTURE** =
explicitly out of scope for v1.0, but the architecture must not make it hard to add later.

---

## 2. Overall description

### 2.1 Product perspective

This is a new, standalone system. It does not need to integrate with any specific existing DSD
system in v1.0 — treat it as greenfield. It should be built as if it will later need to plug into
other systems (billing, CRM, product-specific tools) without a rewrite; that constraint shapes the
API and data-model requirements in §5–§7, not a specific integration to build now.

### 2.2 Product functions (summary)

- Customers submit support requests and track their status.
- Customers can self-serve against a searchable knowledge base before or instead of raising a
  ticket.
- Agents see a unified queue of incoming tickets, regardless of which channel they arrived
  through, and work them to resolution.
- Supervisors/admins get visibility into team performance (volume, response time, resolution
  time) and manage users, roles, and knowledge-base content.
- The system is architected so that an AI layer can assist agents with suggested, source-grounded
  responses — see §4.4. This is where the candidate's stated RAG/guardrail experience is most
  directly relevant, and is the one area where going beyond the v1.0 minimum is explicitly
  welcomed if time allows.

### 2.3 User classes and characteristics

| User class               | Description                                                                               | Technical sophistication                                       |
| ------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Customer**             | Raises and tracks their own tickets. May or may not have an account.                      | Low — general public.                                          |
| **Agent**                | Works the ticket queue: responds, updates status, escalates.                              | Low-to-moderate — comfortable with a web app, not a developer. |
| **Supervisor / Admin**   | Manages agents, SLAs, knowledge base, and views reporting. Superset of Agent's abilities. | Moderate.                                                      |
| **System Administrator** | Configures the system itself (integrations, roles, system settings).                      | Technical.                                                     |

### 2.4 Operating environment

- Both applications are web-based and must be usable on both desktop and mobile-width browsers
  (responsive, not necessarily a native app in v1.0).
- No specific hosting platform, language, or database is mandated — see §2.5.

### 2.5 Design and implementation constraints

- **FR-0 (MUST):** The candidate chooses the programming language(s), frameworks, and DBMS. This
  is a deliberate, explicit freedom — document the choice and the reasoning behind it in the
  submission's README (§9.2), including what you'd reconsider at 100x the initial scale.
- **NFR-0 (MUST):** The system MUST be deployable via a documented, reproducible process
  (containerization such as Docker is recommended but not mandated) so it can be run and evaluated
  without manual environment archaeology.
- The backend MUST expose a documented API consumed by both front ends — do not let either front
  end talk directly to the database or embed business logic that the other front end then has to
  duplicate.

### 2.6 Assumptions and dependencies

- Assume DSD Group operates multiple brands/products today and may want to extend this system to
  cover more of them later (see §11.1) — this shapes the data model (don't hard-code a single
  brand/product assumption) but does **not** require building multi-brand support now.
- No specific third-party email/SMS/chat provider is mandated. Where v1.0 needs to send a
  notification (§4.3), a real working integration with _any_ provider is acceptable — the
  important thing is that the integration point is cleanly abstracted, not which vendor is behind
  it.
- Real customer data is **not** provided or required for this build. Use realistic synthetic data
  (see §9.1).

---

## 3. Actors and use cases

| #     | Use case                                                        | Primary actor      |
| ----- | --------------------------------------------------------------- | ------------------ |
| UC-1  | Submit a support ticket                                         | Customer           |
| UC-2  | Track the status of a submitted ticket                          | Customer           |
| UC-3  | Search the knowledge base                                       | Customer           |
| UC-4  | View and claim tickets from the shared queue                    | Agent              |
| UC-5  | Respond to a ticket / update its status                         | Agent              |
| UC-6  | Escalate a ticket                                               | Agent              |
| UC-7  | View team performance metrics                                   | Supervisor         |
| UC-8  | Manage agents and roles                                         | Supervisor / Admin |
| UC-9  | Publish/edit knowledge-base articles                            | Supervisor / Admin |
| UC-10 | Receive an AI-suggested response grounded in the knowledge base | Agent (see §4.4)   |

---

## 4. Functional requirements

### 4.1 Customer-facing application

- **FR-1 (MUST):** A customer can submit a support ticket via a web form, providing at minimum: a
  subject, a description, a contact method, and an optional attachment.
- **FR-2 (MUST):** A customer can submit a ticket without first creating an account (guest
  ticket), identified by their contact email, **and** can optionally create an account to see all
  their past tickets in one place.
- **FR-3 (MUST):** A customer can view the current status and full response history of a ticket
  they submitted.
- **FR-4 (MUST):** A customer can search and browse a knowledge base of published self-service
  articles, with basic keyword search (does not need to be AI-powered — see §4.4 for the AI
  layer, which is separate from basic KB search).
- **FR-5 (MUST):** A customer receives a notification (email is sufficient for v1.0) when their
  ticket status changes or receives a new agent response.
- **FR-6 (FUTURE):** Additional intake channels beyond the web form (email-to-ticket, WhatsApp,
  live chat). v1.0 must not architecturally prevent adding these — see NFR-6 — but does not need
  to implement them.

### 4.2 Support-team application

- **FR-7 (MUST):** An agent sees a unified queue of all open tickets, sortable/filterable by
  status, priority, and age, regardless of which channel they arrived through.
- **FR-8 (MUST):** An agent can open a ticket, see its full conversation thread and the
  customer's other ticket history, and respond to it.
- **FR-9 (MUST):** An agent can change a ticket's status (e.g. open, pending customer,
  resolved, closed) and priority.
- **FR-10 (MUST):** An agent can add an internal note on a ticket, visible only to agents/
  supervisors, never to the customer.
- **FR-11 (SHOULD):** An agent can assign a ticket to themselves or another agent, and a
  supervisor can reassign any ticket.
- **FR-12 (SHOULD):** Canned responses / reply templates an agent can insert and edit before
  sending.
- **FR-13 (MUST):** A supervisor/admin can view basic reporting: ticket volume over time, average
  time-to-first-response, average time-to-resolution, and tickets per agent.
- **FR-14 (MUST):** A supervisor/admin can manage agent accounts and roles (RBAC — see NFR-3).
- **FR-15 (MUST):** A supervisor/admin can create, edit, and publish knowledge-base articles.

### 4.3 Shared backend / API

- **FR-16 (MUST):** All ticket, user, and knowledge-base data is served through a documented API
  consumed by both front ends (see §2.5).
- **FR-17 (MUST):** Authentication distinguishes customer sessions from agent/admin sessions;
  authorization enforces the RBAC roles in §4.2 server-side, not just hidden in the UI.
- **FR-18 (MUST):** Every ticket retains a full, immutable history of status changes and messages
  (who changed what, when) — this is a support system; losing the trail of what happened to a
  ticket defeats its purpose.
- **FR-19 (MUST):** File attachments on tickets are stored and served securely (not as a
  world-readable static file at a guessable URL) and are validated by actual content, not just
  file extension.
- **FR-20 (SHOULD):** An abstracted notification-sending interface (§2.6) so email today can
  become email+SMS+WhatsApp later without redesigning how the rest of the system triggers
  notifications.

### 4.4 AI-assisted support (the one area to go beyond the minimum)

v1.0's bar here is intentionally lower than the rest of the system, but the design intent is not:
this is where a candidate with real production LLM/RAG experience has room to show it, and where
DSD gets the most long-term value if it's done well.

- **FR-21 (SHOULD):** Given a new or updated ticket, the system suggests a draft response to the
  agent, grounded in the knowledge base — the agent reviews, edits, and sends it; **the system
  MUST NOT send an AI-generated response to a customer without an agent explicitly approving it
  in v1.0.** This is a non-negotiable guardrail, not a stretch goal to relax under time pressure.
- **FR-22 (SHOULD):** Every AI-suggested response cites which knowledge-base article(s) it drew
  from. An answer that can't be traced to a source is worse than no suggestion at all in a support
  context.
- **FR-23 (FUTURE):** Auto-triage/priority-suggestion, sentiment detection, and (much later, with
  its own explicit sign-off) fully autonomous responses for narrow, low-risk cases. Not required
  for v1.0; the data model and event structure should not make this awkward to add later.
- **FR-24 (SHOULD):** If FR-21 is attempted, include a small synthetic knowledge-base dataset (a
  few dozen realistic articles) to ground it against — realistic, not exhaustive; see §9.1.

---

## 5. Data requirements (conceptual)

The following entities and relationships are conceptual — model them however fits the chosen
DBMS (relational, document, or hybrid), but the relationships below must be representable:

- **User** (customer) — identity, contact info, optional account credentials.
- **Agent** — identity, credentials, role.
- **Role** — Agent / Supervisor / Admin, with the permission set each implies.
- **Ticket** — subject, description, status, priority, channel, timestamps, owning customer,
  assigned agent (nullable).
- **Message** — belongs to a Ticket; author (customer or agent); body; visibility (customer-
  facing vs. internal note); timestamp.
- **Attachment** — belongs to a Ticket or Message; stored file reference; content-type; size.
- **KnowledgeArticle** — title, body, tags/category, published status.
- **AuditEvent** — what changed on a Ticket, by whom, when (backs FR-18).
- **Channel** (conceptual, not necessarily its own table) — how a Ticket originated; must be an
  attribute of Ticket, not baked into separate per-channel table structures, so adding a channel
  later doesn't mean a schema redesign.

---

## 6. External interface requirements

- **UI-1 (MUST):** Both applications are usable at common mobile and desktop widths.
- **UI-2 (SHOULD):** Basic accessibility hygiene — real form labels, sufficient color contrast,
  keyboard-navigable forms. Does not need a full accessibility audit for v1.0.
- **API-1 (MUST):** The API is documented well enough that someone other than its author could
  integrate against it without reading the implementation source (an OpenAPI/Swagger spec, a
  Postman collection, or a clearly written API reference document are all acceptable).
- **API-2 (SHOULD):** The API is versioned (even informally, e.g. an `/api/v1/` prefix) so a
  breaking v2 doesn't strand existing integrations later.

---

## 7. Non-functional requirements

### 7.1 Performance

- **NFR-1 (MUST):** Common operations (loading the ticket queue, opening a ticket, submitting a
  reply) should feel responsive under normal load — target under ~1 second server-side processing
  time for these, excluding network/client rendering.

### 7.2 Scalability — the central ask of this brief

- **NFR-2 (MUST):** The backend must be designed statelessly (no in-process session/ticket state
  that prevents running multiple backend instances behind a load balancer). Session/auth state
  belongs in the database or a shared store, not in server memory.
- **NFR-3 (SHOULD):** Identify, in the submission's README, where the design would need to change
  to handle 100x the ticket volume (e.g., read replicas, caching layer, queue-based processing for
  notifications/AI suggestions rather than inline synchronous calls, database indexing strategy).
  You are not required to _implement_ all of this for v1.0 — you are required to have thought
  about it and said so plainly.
- **NFR-4 (SHOULD):** Anything that calls an external or slow service (notification sending, an
  AI suggestion in §4.4) should not block the user-facing request that triggered it — a queue or
  background-job pattern is preferred over doing it synchronously inline.

### 7.3 Security

- **NFR-5 (MUST):** Passwords/credentials are properly hashed, never stored or logged in plain
  text.
- **NFR-6 (MUST):** All state-changing API endpoints enforce authentication and the RBAC roles
  from §4.2 server-side.
- **NFR-7 (MUST):** All user-supplied input (ticket text, messages, file uploads) is validated and
  safely escaped on output — this is a system where customer-submitted content is displayed back
  to agents and vice versa; treat all of it as untrusted.
- **NFR-8 (MUST):** File uploads are validated by actual content type, size-capped, and stored
  outside any directly web-servable path or behind an authenticated download endpoint.
- **NFR-9 (SHOULD):** Rate limiting on ticket submission and login endpoints, to blunt basic abuse
  (spam ticket floods, credential-stuffing).

### 7.4 Availability and reliability

- **NFR-10 (SHOULD):** A failure in a non-critical dependency (e.g. the AI-suggestion service, or
  the notification provider) degrades gracefully — a customer can still submit and an agent can
  still respond to a ticket even if the AI suggestion or the email send fails. Consistent with
  FR-21's guardrail: AI assistance is additive, never a single point of failure for core support
  functions.

### 7.5 Maintainability

- **NFR-11 (MUST):** The codebase includes automated tests covering at least the core ticket
  lifecycle (create → respond → resolve) and the RBAC boundary (an agent cannot do what only a
  supervisor should be able to, and vice versa).
- **NFR-12 (SHOULD):** Code is organized so business logic isn't duplicated between the two front
  ends' backing code — both should be thin clients over the shared API/service layer in §4.3.

### 7.6 Portability

- **NFR-13 (SHOULD):** The system should be runnable without a hard dependency on a specific cloud
  provider's proprietary services, so a future move (e.g. between cloud providers, or to
  self-hosted infrastructure) isn't a rewrite.

---

## 8. Suggested architecture shape (guidance, not mandate)

This section is intentionally non-prescriptive — §2.5 gives the candidate full freedom on
language and DBMS. As guidance:

- A clean separation between presentation (customer app, agent app), an API/service layer, and a
  data layer tends to satisfy §4.3, §7.2, and §7.5 together without extra effort.
- Treat notification-sending and (if attempted) AI-suggestion generation as background work
  triggered by an event (a new ticket, a new message) rather than inline in the request that
  creates that event — this is the simplest way to satisfy NFR-4 and NFR-10 at once.
- The two front ends do not need to be two separate deployable applications if a single
  application with role-based views is simpler for the chosen stack — what matters is that a
  customer can never reach agent-only functionality, not how the code is physically split.

---

## 9. Deliverables and evaluation

### 9.1 What to submit

- Source code (a Git repository, with real commit history — not a single squashed commit).
- A README covering: how to run it locally, the technology choices made and why (§2.5), and the
  "at 100x scale" note from NFR-3.
- A small set of realistic **synthetic** seed data (sample customers, tickets, and — if §4.4 is
  attempted — a small knowledge-base dataset) so the reviewer can evaluate it running with
  something in it, not an empty database.
- If deployed somewhere reachable for review, a live URL is welcome but not required — a
  clear local run process is sufficient.

### 9.2 What will be evaluated

- Whether the v1.0 MUST requirements in §4 work correctly end to end.
- Whether the guardrail in FR-21 is actually respected if §4.4 is attempted (an AI response never
  reaches a customer unreviewed) — this is checked directly, not taken on trust.
- The reasoning in the README, not just the code — the "why," especially around the scalability
  and technology-choice questions in §2.5/§7.2, is part of what's being assessed.
- Whether the RBAC boundary in NFR-6/NFR-11 actually holds under a real attempt to violate it.
- Code organization and whether business logic is duplicated across the two front ends (§7.5).

### 9.3 Timeline and terms

_[To be filled in by DSD Group before sending: expected timeframe.]_

---

## 10. Out of scope for v1.0

Named here so nothing is mistaken for an oversight:

- Native mobile apps (a responsive web UI is sufficient).
- Real integrations with a specific email/SMS/WhatsApp provider beyond the one working example in
  FR-5/FR-20.
- Multi-brand/multi-tenant support for DSD Group's different companies (see §11.1) — the data
  model should not preclude it, but building it now is not required.
- Fully autonomous AI responses sent without human review (explicitly forbidden in v1.0, not just
  deferred — see FR-21).
- SLA breach automation/escalation workflows beyond basic priority/status tracking.
- Multi-language support.

## 11. Beyond v1.0 (context for design decisions, not a build requirement)

### 11.1 Multi-brand support

DSD Group may eventually want this system to serve support for more than one of its brands or
products from one platform, with agents scoped to what they're responsible for. Nothing in v1.0
needs to build this, but avoid decisions that would make it a rewrite rather than an extension
(e.g., don't hard-code a single brand name into core data structures).

### 11.2 Omnichannel intake

Real email-to-ticket and live-chat intake, unifying into the same queue agents already
work from in v1.0.

### 11.3 Deeper AI assistance

Once the grounded-suggestion pattern in §4.4 is proven and trusted in production, auto-triage,
sentiment-aware prioritization, and narrowly-scoped autonomous handling of low-risk, high-
confidence cases — always with the human-approval principle from FR-21 as the starting default,
relaxed only deliberately and explicitly, never by omission.

---

## Appendix: Glossary

| Term | Meaning |
| **Grounded response** | An AI-generated answer that is traceable to a specific source document, not generated from the model's general knowledge. |
| **Human-in-the-loop** | A workflow where an AI-generated output requires explicit human approval before it takes effect. |
| **Stateless backend** | A backend that does not rely on server-local memory to serve a request, so any instance can serve any request — a prerequisite for horizontal scaling. |
