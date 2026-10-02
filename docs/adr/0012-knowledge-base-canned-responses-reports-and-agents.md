# ADR-0012: Knowledge base, canned responses, reports and agent management

- Status: Accepted
- Date: 2026-10-01
- Amended: 2026-10-02 (see [Amendments](#amendments))
- Requirements: FR-4, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, NFR-6, NFR-7, API-1

## Context

[ADR-0004](0004-authorization-rbac.md) settles who may manage agents, [ADR-0007](0007-ticket-lifecycle.md) defines the reporting figures, and [ADR-0006](0006-ai-suggestions-and-guardrail.md) says how published articles are indexed for AI suggestions. Building the APIs on top of them raised questions those records don't answer:

- What happens when someone edits an article that is already published?
- Who makes knowledge-base markdown safe, and when?
- How does search return highlighted snippets without sending HTML to the browser?
- Which brand does new content go into, and which brand does the public help centre show?
- How are canned-response variables written, checked and filled in?
- How are reporting date ranges read, and in which time zone?
- How is "never leave the system without an active admin" kept when two admins act at once?
- What does deactivating an agent do to their tickets and sessions, and what happens if an assignment to them is in flight?

## Decision

### 1. Articles: drafts, versions, and saving a published article

- An article starts as a `draft` at version 0. Publishing sets `published`, raises the version by one and sets `published_at` to the time of that publication.
- **Saving a published article publishes the saved text as the next version** at once. What customers read and what the AI index holds therefore never disagree. Because saving it publishes, editing a published article needs `kb:publish` as well as `kb:write`. No role holds one without the other today; the check keeps it so if roles are split later.
- `unpublish` returns an article to draft. `archive` keeps it but takes it off the help centre. An archived article can be published again. Doing what is already done (publishing a published article, archiving an archived one) is a 200 that writes nothing, as for tickets.
- Publish, unpublish and archive each write an audit event (entity `kb_article`, no ticket) in the same transaction. A change to what the public sees also writes `kb.article_published { articleId, version }` or `kb.article_unpublished { articleId }`, which the `kb-indexing` queue will consume (Phase 9). Archiving a draft writes no outbox event, because nothing public changed.
- Slugs are made from the title (or a category's name) unless given, and are unique per brand. A duplicate is a 409 `already-exists`. A category with articles filed under it can't be deleted (409). An article's category must belong to the article's brand (422).

### 2. Markdown is sanitised when it is saved

- The API runs `sanitizeMarkdown` (in `packages/shared`) on every body it stores. It parses the markdown with GFM and removes:
  - raw HTML, inline and block, comments included;
  - images and link definitions whose URL isn't `http`, `https`, `mailto` or relative;
  - the destination of such a link, keeping its text.
- The edits are made at the parser's source positions rather than by printing the tree again, so everything else stays byte for byte as the author wrote it. Removing one thing can expose another (a link whose text holds HTML), so passes repeat until one changes nothing. Every edit makes the text shorter, so that always happens.
- `isSafeUrl` ignores whitespace and control characters inside a scheme, as browsers do (`java\tscript:`). Entities are already decoded by the parser, so `java&#x09;script:` is caught too.
- The response returns what was stored, so the author sees what was kept. Sanitising on write means the help centre, emails and AI prompts all start from safe text. The help centre also renders markdown without raw HTML and checks every URL again with the same `isSafeUrl` (Phase 7).

### 3. Search and snippets

- The help centre searches with `websearch_to_tsquery('english', q)`: quoted phrases, `or` and `-word` work, and odd input never fails. Results are ranked by `ts_rank_cd` over the stored `search_vector`, which weighs the title above the summary above the body.
- Pages are keyset pages on (rank, id). The rank is read as `float8` in both the select and the cursor comparison, so a cursor's rank compares equal to the row it came from. Browsing without `q` pages on (published_at, id).
- Snippets come from `ts_headline` with U+E000 and U+E001 as the match markers. Article text can never contain those characters (the sanitiser removes them), so the API splits on them and returns `[{ text, highlighted }]` segments. The client wraps highlighted text in its own `<mark>`; no markup from the database reaches a page. `ts_headline` also drops tags from what it quotes.
- Only `published` articles of the public brand are ever read by public routes; the filter is in the SQL. A draft or archived article is a 404 by slug, whoever asks.

### 4. Brands

- **The public brand** is the one named by `TICKET_BRAND_SLUG`, for intake and for the help centre alike.
- **New staff content** (articles, categories, canned responses) goes into the `brandId` given, which must be one of the author's brands (404 otherwise). Without one, it goes into the author's only brand; an author in several brands must name one (400).
- Every staff read filters by the reader's brands, as for tickets.

### 5. Canned responses

- Templates name variables in double braces: `{{customer.name}}` (or "there" when the customer has no name), `{{customer.email}}`, `{{ticket.reference}}`, `{{ticket.subject}}` and `{{agent.name}}`. Spaces inside the braces are allowed.
- Anything in double braces that isn't a known variable fails validation when the template is saved (400), so a typo can't end up in a reply.
- `GET /staff/canned-responses/{id}/render?ticketId=` fills a template in from the ticket as it is now and returns plain text. Values are inserted as text and never read as more template. Rendering sends nothing: the agent puts the text in the composer, edits it and sends it as a reply. The ticket must be in the agent's brands (404) and in the template's brand (422), because each brand has its own voice.
- Active titles are unique per brand (409). Retiring a template hides it from the composer, keeps it, and frees its title. A retired template can't be rendered.

### 6. Reports

The definitions are ADR-0007's (section 9). Their details:

- `from` and `to` are calendar days in `REPORTING_TIMEZONE` (default `UTC`), both included: the range runs from local midnight on `from` to local midnight after `to`. The default is the last 30 days, today included; the longest range is 366 days; a backwards range is a 400.
- Volume can be grouped by day or by week, and weeks start on Monday. Every bucket in the range is returned, empty ones included. A week bucket is labelled with its Monday, even when that is before `from`; it still counts only tickets inside the range.
- Times are in seconds, as mean and median (`percentile_cont(0.5)`).
- "Awaiting first response" counts tickets created in the range with no reply that aren't closed. A ticket closed without a reply, such as spam, isn't waiting for anything.
- "Resolved while assigned" counts the ticket's **current** holder, for tickets whose latest resolution falls in the range. A closed ticket can't be reassigned (ADR-0007, amendment 1), so a finished ticket keeps whoever finished it. A resolved ticket that is reassigned before it closes moves to its new holder; that is the trade for not reconstructing assignment history from the audit trail.
- The per-agent report lists colleagues in the viewer's brands. A deactivated agent is listed only while they still hold open work or resolved something in the range.

### 7. Agent management

- **One change at a time.** Every agent-management change first takes a transaction-scoped advisory lock, then locks the manager's and the colleague's rows in ID order, and checks the rank rules against the locked rows. The manager's role is read fresh: a manager demoted a moment ago acts with their new role. These changes are rare, and running them one at a time makes "never leave the system without an active admin" a plain count with no lock-ordering puzzle. Two admins demoting each other at the same moment get one success, and one 403 (or 401, if the winner's commit has already revoked the loser's session).
- **Role changes and deactivation** revoke all the colleague's sessions in the same transaction, so the change applies on their very next request.
- **Deactivation** returns the colleague's `open` and `pending_customer` tickets to the queue through the same write as any unassignment: each ticket gets its `ticket.assigned` audit event, with the manager as actor, and its outbox event. This covers tickets in every brand: brand scope limits what a manager sees, not what a deactivation clears. Resolved and closed tickets keep their holder for the reports.
- **No ticket is left with a deactivated agent.** An assignment locks the assignee's row `FOR SHARE` until it commits, and a deactivation locks that row `FOR UPDATE` before it reads the tickets to unassign. A deactivation therefore waits for an assignment in flight and then unassigns that ticket too, and an assignment that starts afterwards finds the agent deactivated (422).
- **Invites** create the agent without a password, in the inviter's brands, and write `agent.invited { agentId }` (outbox) and an `agent.invited` audit event. An invite can be sent again while the colleague is active and has no password, because invite links expire after 72 hours. An email that already has a staff account is a 409.
- **Responses** carry `allowedActions` and `grantableRoles` for the viewer, worked out by the same functions the service enforces, so the agent app never applies a rank rule itself.

### 8. Deadlocks answer 503

When PostgreSQL cancels a transaction to break a deadlock (SQLSTATE 40P01), nothing was written and the same request will very likely succeed a moment later. The API answers 503 with `Retry-After: 1` instead of a 500.

## Consequences

- The help centre and the AI index always hold the same text, at the cost of no "edit, then review, then publish" step for live articles. A drafting workflow for live articles would need a second copy of the content.
- Markup and unsafe links can't be stored, so every reader of an article is safe by default. An author who pastes HTML sees it removed in the response.
- Snippets need no HTML handling on the client.
- Reports reflect the current holder of a resolved ticket, not the holder at the moment of resolution.
- Agent management can't run in parallel. That is irrelevant at the rate people are hired, promoted and deactivated.

## Alternatives considered

- **Editing a published article in place, published again only on request.** Customers would read text the AI index doesn't have until someone remembers to republish.
- **Sanitising when rendering only.** Every renderer (help centre, email, prompt) would have to get it right; storing safe text makes the safe path the default.
- **Rejecting markdown that contains HTML (400).** Clearer for the author, but pasting from a document that carries a stray `<br>` would fail outright. Removing it and showing the result is kinder and just as safe.
- **HTML snippets with `<mark>` from `ts_headline`.** The client would need `dangerouslySetInnerHTML`, which the lint bans.
- **Reconstructing "assigned at resolution" from the audit trail.** Exact, but a much heavier query for a nuance the closed-ticket rule already covers for finished work.
- **Locking all admin rows with `FOR UPDATE` to count them.** Two concurrent demotions can lock them in different orders and deadlock. The advisory lock gives the same guarantee with one lock.
- **Admins limited to lower ranks, as ADR-0004 first said.** Nobody could ever deactivate an admin (see the ADR-0004 amendment).

## Verification

- Unit: `rank-rules` (every role combination, self, last admin, invites, actions offered); `markdown` and `slug` (shared); `variables` (shared: canned rendering and unknown variables); `snippet`; `problem-details` (deadlocks); `env` (the reporting time zone).
- Integration: `agent-management`, `kb-authoring`, `kb-search`, `canned-responses`, `reports` (a fixed dataset in America/New_York with every figure worked out by hand).
- RBAC: every new route in the matrix, against all ten callers.
- Database: `seed` (the starter knowledge base), `generate` (seeded articles are already sanitised), `indexes` (browsing published articles).
- Smoke: the help centre lists and searches the seeded articles through the customer app, and a draft stays private.

## Amendments

### 2026-10-02, Phase 8

1. **Colleagues a ticket can go to (section 7, FR-11).** `GET /api/v1/staff/agents/assignable` lists the active staff who share a brand with the caller, the caller included, by name, with id, name and role only. It needs `ticket:assign`, which every staff role holds, rather than `user:read`, which agents lack: without it an agent could be allowed to assign a ticket (`allowedActions.assign`) but have no way to name a colleague, and the escalation dialog couldn't offer a supervisor. It shows no email, status or management actions, so it widens nothing that `user:read` protects. Assigning still checks the chosen colleague against the ticket's brand (422).
