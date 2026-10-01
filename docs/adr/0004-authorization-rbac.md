# ADR-0004: Permission-based RBAC with resource-level checks

- Status: Accepted
- Date: 2026-09-30
- Amended: 2026-10-01, twice (see [Amendments](#amendments))
- Requirements: FR-11, FR-14, FR-17, NFR-6, NFR-11

## Context

The SRS defines three staff roles: Agent, and Supervisor/Admin as a superset of Agent (§2.3, §5). Supervisors and admins manage agent accounts and roles (FR-14), and supervisors can reassign any ticket (FR-11). Authorisation must be enforced on the server, not just hidden in the UI (FR-17, NFR-6), and the boundary must be covered by tests (NFR-11).

Reviewers will actively try to break this boundary: a customer reading someone else's ticket, an agent doing supervisor work, a supervisor promoting themselves. Two things make that hard to get right over time. A role check scattered across dozens of handlers is easy to forget on the next one. And "can this user do this action?" is only half the question; the other half is "on this ticket?".

The SRS also lists a System Administrator (§2.3) who configures integrations, roles and system settings. v1 has no integrations and no system settings beyond user and role management, so that responsibility belongs to the `admin` role.

## Decision

### 1. Check permissions, never role names

Code asks "does this agent have `ticket:reassign:any`?", never "is this agent a supervisor?". Roles map to sets of permissions in one module, `packages/shared/src/auth/permissions.ts`. Adding a role or moving a permission is a one-line change that is reviewed like any other code and caught by a snapshot test.

| Permission               | Allows                                                                                       | Agent | Supervisor | Admin |
| ------------------------ | -------------------------------------------------------------------------------------------- | ----- | ---------- | ----- |
| `ticket:read:any`        | View the queue and any ticket in the agent's brands                                          | yes   | yes        | yes   |
| `ticket:reply`           | Send a customer-visible reply                                                                | yes   | yes        | yes   |
| `ticket:note:create`     | Add an internal note                                                                         | yes   | yes        | yes   |
| `ticket:status:update`   | Change status, within the state machine ([ADR-0007](0007-ticket-lifecycle.md))               | yes   | yes        | yes   |
| `ticket:priority:update` | Change priority                                                                              | yes   | yes        | yes   |
| `ticket:assign`          | Claim an unassigned ticket, or hand an unassigned or own ticket to another agent             | yes   | yes        | yes   |
| `ticket:reassign:any`    | Reassign any ticket, whoever holds it                                                        | no    | yes        | yes   |
| `ticket:escalate`        | Escalate a ticket                                                                            | yes   | yes        | yes   |
| `ticket:audit:read`      | Read a ticket's audit trail                                                                  | yes   | yes        | yes   |
| `customer:read`          | View a customer's profile and their other tickets (FR-8)                                     | yes   | yes        | yes   |
| `kb:read`                | Read knowledge-base articles in any status, including drafts                                 | yes   | yes        | yes   |
| `kb:write`               | Create and edit articles                                                                     | no    | yes        | yes   |
| `kb:publish`             | Publish, unpublish and archive articles                                                      | no    | yes        | yes   |
| `canned:use`             | List canned responses and insert them into a reply                                           | yes   | yes        | yes   |
| `canned:manage`          | Create, edit and retire canned responses                                                     | no    | yes        | yes   |
| `report:view`            | View reporting (FR-13)                                                                       | no    | yes        | yes   |
| `user:read`              | List agents and their roles                                                                  | no    | yes        | yes   |
| `user:manage`            | Invite, edit, deactivate and reactivate agents and change roles, within the rank rules below | no    | yes        | yes   |
| `ai:suggestion:read`     | See AI suggestions for a ticket                                                              | yes   | yes        | yes   |
| `ai:suggestion:request`  | Ask for a new suggestion                                                                     | yes   | yes        | yes   |
| `ai:suggestion:feedback` | Rate a suggestion                                                                            | yes   | yes        | yes   |

Supervisors and admins hold the same permissions today. What separates them is rank (section 4): only an admin can manage supervisors and other admins. When system settings arrive (brands, SLA targets, AI provider switches), they get a `settings:manage` permission held by admins only.

Customers have no permission list. The customer realm has one rule, ownership, and it is enforced in the query itself. Every customer-realm repository method filters on the session's `customer_id`, and on `guest_ticket_id` for guest sessions. There is no separate "did we remember to check?" step to forget, because the query can't return someone else's rows.

### 2. Layers of enforcement

1. **Global guard, deny by default.** Every route must declare `@Public()` or `@Realm('customer' | 'staff')`. At startup the API walks every registered route and refuses to boot if one declares neither.
2. **Permission guard.** Staff routes declare `@RequirePermissions(...)`. The guard checks them against the permissions resolved from the session's agent, loaded fresh on every request, so a role change applies immediately.
3. **Service-level resource checks.** Services apply the rules that depend on the data: brand scope for staff, ownership for customers, and business rules such as "`ticket:assign` only covers unassigned tickets or your own".
4. **Separate response shapes.** Customer and staff responses use different zod schemas. The customer schema has no field for internal notes, assignees, escalation or AI suggestions, so serialisation drops them even if a query returned them by mistake.
5. **Strict input schemas.** Request schemas reject unknown fields with 400. A customer can't sneak `status`, `priority`, `assigneeId` or `visibility` into an endpoint that doesn't accept them (mass assignment).

### 3. Status codes

| Situation                                                                                                                                              | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| No session, an expired or revoked session, or a session from the other realm                                                                           | 401    |
| The resource exists but this actor can't see it: another customer's ticket, a ticket outside the agent's brands, a guest asking for a different ticket | 404    |
| The actor can see the resource but may not perform this action: an agent reassigning a colleague's ticket, an agent publishing an article              | 403    |
| The action is allowed, but the current state forbids it: an invalid status transition, claiming a ticket someone else just claimed                     | 409    |

Returning 404 rather than 403 for resources the actor can't see avoids confirming that a ticket ID exists.

### 4. Managing agents (FR-14)

The SRS says a "supervisor/admin can manage agent accounts and roles" and treats Supervisor/Admin as one user class. We give both roles real management power, but in a way that makes self-promotion and lock-out impossible. Ranks are `agent` 1, `supervisor` 2, `admin` 3. An actor with `user:manage`:

- can invite, edit, deactivate and reactivate only agents whose rank is lower than their own;
- can grant roles up to and including their own rank. A supervisor can promote an agent to supervisor, and from then on can no longer manage that person. Only an admin can create or promote an admin;
- can't change their own role or deactivate themselves;
- can't demote or deactivate the last active admin (409).

A role change or deactivation revokes the target's sessions at once. Deactivation also unassigns the agent's open tickets ([ADR-0007](0007-ticket-lifecycle.md)), and both actions write audit events.

### 5. What the UI is told

`GET /api/v1/auth/staff/me` returns the agent's role and resolved permissions. Staff ticket responses include `allowedActions` and `allowedTransitions` for the current agent. The agent app shows or hides controls based on these fields and never evaluates a rule itself. Hiding a button is a courtesy; the API enforces the rule regardless.

### 6. Brand scope

Each agent has brand memberships (`agent_brand_memberships`), and every staff query filters by them. v1 seeds one brand and gives every agent membership, so the filter always passes in normal use, but tests exercise it with a second brand. Multi-brand support (§11.1) then becomes a matter of data, not a rewrite.

## Consequences

- One file says what each role can do, and tests enumerate it.
- The route-coverage test makes it impossible to add an endpoint that nobody has decided the access rules for.
- Roles can't be edited at runtime. That is deliberate for v1: FR-14 asks for managing accounts and assigning roles, not for defining new roles. If custom roles are needed later, the map moves into `roles` and `role_permissions` tables and the permission names stay the same.
- Resolving permissions on every request costs a join against the agent row. It is already loaded for the session check, so the extra cost is negligible.

## Alternatives considered

- **Roles and permissions stored in database tables with an admin UI.** Flexible, but the permission set becomes data that tests can't pin down, and nothing in the SRS asks for it.
- **Role checks such as `@Roles('supervisor')`.** Simpler at first, but every new role means revisiting every check.
- **403 for another customer's ticket.** Tells an attacker that the ID exists.
- **A policy engine such as CASL or OPA.** More power than we need; the rules here fit in one small, well-tested module.

## Verification

- Unit: a snapshot of the role-to-permission map, so any change is visible in review. Rank rules for every combination of actor role, target role and requested role.
- RBAC matrix (integration): every protected route crossed with every actor: anonymous, customer (owner), a different customer, guest (scoped to one ticket), agent, supervisor and admin. There are two extra cases: a deactivated agent's old session, and a customer token sent in the staff cookie. Each cell has an expected status code. Seed data gives each actor things they should and shouldn't see.
- Route coverage (integration): enumerates every registered route at runtime and fails if a route is missing from the matrix, declares neither a realm nor `@Public()`, or sits outside `/api/v1` (other than `/health` and `/ready`).
- Escalation attempts: a supervisor promoting themselves gets 403; a supervisor creating an admin gets 403; demoting the last admin gets 409; an agent calling user management gets 403; a customer calling any staff route gets 401.
- Brand scope: an agent without membership in a second brand gets 404 for that brand's tickets.

## Amendments

### 2026-10-01, Phase 3

1. **More startup checks (section 2, layer 1).** Besides a route that declares neither `@Public()` nor `@Realm()`, the API refuses to start for a route outside `/api/v1` (other than `/health`, `/ready` and the Swagger UI pages), a route whose realm or `@Public()` contradicts its path prefix (ADR-0003, section 1), a route under `/api/v1/staff/` that requires no permission, and permissions on a route that only customers can reach. Staff work is therefore denied by default at the permission layer too. The checks read every route Fastify registers, not just Nest controllers.
2. **What Phase 3 delivers.** The permission map, all four global guards, the RBAC matrix and route coverage for every route that exists so far. The rank rules (section 4) and revoking an agent's sessions on a role change arrive with agent management in Phase 5, and brand scope (section 6) with the ticket queries in Phase 4.

### 2026-10-01, Phase 5

1. **Admins manage other admins (section 4).** As first written, a manager acts only on colleagues ranked below them, yet the same section forbids demoting or deactivating "the last active admin", which that rule could never reach: no admin outranks another, so no admin could ever be demoted or deactivated by anyone. The rule is now: supervisors manage colleagues ranked below them; admins, the top rank, manage everyone else, other admins included. Nobody manages their own account, roles can still be given only up to the manager's own rank, and no change may leave the system without an active admin (409 `last-admin`).
2. **How the last-admin rule holds.** Agent-management changes run one at a time under a transaction-scoped advisory lock, and each re-reads the manager's own row under lock, so a manager demoted a moment ago acts with their new role. Two admins demoting each other at the same moment therefore get one success and one refusal, never zero admins. Because a manager can't act on themselves and is an active admin whenever they act on another admin, the 409 can't be reached through the API today; it is kept as a stated invariant and unit-tested ([ADR-0012](0012-knowledge-base-canned-responses-reports-and-agents.md), section 7).
3. **What Phase 5 delivers.** The rank rules, invites (and sending one again), renaming, role changes and deactivation that revoke the colleague's sessions at once, deactivation unassigning their open work, and reactivation. Responses carry `allowedActions` and `grantableRoles` for the viewer (section 5). Agent management is brand-scoped like everything else (section 6): a colleague who shares no brand with the manager is a 404.
