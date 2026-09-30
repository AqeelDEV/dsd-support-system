# ADR-0002: Monorepo layout and module boundaries

- Status: Proposed
- Date: 2026-09-30
- Requirements: FR-16, NFR-12, API-1

## Context

The system has four deployable parts: the API, the background worker and two web apps. They share request and response schemas, enums, permission names and UI components. NFR-12 asks that business logic is not duplicated between the two front ends, and FR-16 says both must go through the documented API rather than the database.

Sharing code is easy. Stopping the wrong code from being shared is harder. A web app that can import the database package will eventually do so, and a worker that can import API services can end up with a path to create customer-visible messages, which the AI guardrail forbids ([ADR-0006](0006-ai-suggestions-and-guardrail.md)).

## Decision

One repository, managed with pnpm workspaces and Turborepo:

```text
apps/
  api/            NestJS HTTP API: controllers, services, repositories
  worker/         Outbox dispatcher and BullMQ job handlers
  customer-web/   Next.js customer app: tickets, guest access, knowledge base
  agent-web/      Next.js staff app: queue, tickets, reports, administration
packages/
  shared/         zod schemas, enums, permission map, error types (browser and server)
  api-client/     Typed client generated from the committed openapi.json
  db/             Drizzle schema, SQL migrations, database client factory, seed data (server only)
  ui/             Shared React components (shadcn/ui) and Tailwind preset (browser only)
  config/         Shared TypeScript, ESLint and Prettier presets
e2e/              Playwright end-to-end tests
docs/             SRS, architecture, data model, ADRs, traceability
```

### Dependency rules

| Package                               | May import                         | Must never import        |
| ------------------------------------- | ---------------------------------- | ------------------------ |
| `apps/api`                            | `shared`, `db`                     | `worker`, web apps, `ui` |
| `apps/worker`                         | `shared`, `db`                     | `api`, web apps, `ui`    |
| `apps/customer-web`, `apps/agent-web` | `shared`, `api-client`, `ui`       | `db`, `api`, `worker`    |
| `packages/shared`                     | nothing internal                   | anything server-only     |
| `packages/api-client`                 | nothing internal (generated types) | `db`                     |
| `packages/ui`                         | `shared`                           | `db`, `api-client`       |

These rules are enforced in two ways, so a mistake fails the build instead of passing review:

1. **Declared dependencies.** Each package lists its internal dependencies in `package.json`. pnpm's strict `node_modules` layout means an undeclared import doesn't resolve.
2. **Lint rules in CI.** An ESLint boundaries rule catches deep imports between apps and restricted imports. In particular, `apps/worker` may not import the `messages` table or anything that writes messages.

### Where rules live

- Business rules live in API services and nowhere else. Front ends ask the API what the current user may do: ticket responses carry `allowedActions` and `allowedTransitions`, and `/auth/staff/me` returns resolved permissions. The UI hides what isn't allowed; the API enforces it.
- Shapes live in `packages/shared`: zod schemas for every request and response, used by the API for validation and OpenAPI generation, and by the web apps for form validation. A form and the endpoint behind it can't disagree about what is valid.
- The OpenAPI document (`apps/api/openapi.json`) is generated from the code and committed. `packages/api-client` is generated from it. CI regenerates both and fails if either differs from what is committed, so the published contract can't drift from the implementation (API-1).

### Inside the API

```text
apps/api/src/
  main.ts               Fastify bootstrap, security headers, CORS, Swagger
  config/               Environment schema; the app refuses to start with bad config
  common/               Problem-details errors, request IDs, logging, pagination, validation pipe
  auth/                 Realms, sessions, CSRF, rate limits, guards, decorators
  modules/
    tickets/  messages/  attachments/  audit/  customers/  agents/
    kb/  canned-responses/  reports/  ai-suggestions/  outbox/  health/
```

Each module follows the same shape: `*.controller.ts` handles HTTP only, `*.service.ts` holds the rules and opens transactions, `*.repository.ts` talks to the database through Drizzle. Controllers never contain rules, and repositories never make decisions.

### Inside the worker

```text
apps/worker/src/
  main.ts               Composition root: builds every dependency explicitly
  config/
  dispatcher/           Moves outbox rows onto BullMQ queues
  jobs/                 notifications, ai-suggestions, kb-indexing, dead-letter
  notifications/        NotificationService, channels, templates
  ai/                   Providers, chunking, retrieval, prompts, citation validation
```

### Tests

- Unit tests sit next to the code they test: `*.spec.ts`.
- Integration tests live in each app's `test/integration/` folder as `*.int.spec.ts` and run against real Postgres and Redis.
- The RBAC matrix and route-coverage tests live in `apps/api/test/rbac/`.
- Database tests (constraints, triggers, role privileges) live in `packages/db/test/`.
- End-to-end tests live in `e2e/`.

### Versions and tasks

- Shared third-party versions (TypeScript, zod, Vitest and so on) are pinned once in a pnpm catalog, so every package uses the same version.
- Turborepo runs `build`, `lint`, `typecheck` and `test` per package in dependency order and caches the results.

## Consequences

- Boundaries are checked by tools rather than remembered by people.
- A schema change in `packages/shared` shows up as a type error in every app that depends on it.
- The generated OpenAPI document and client add a step whenever the API changes. The CI check turns forgetting that step into a failed build rather than a stale client.
- The worker and the API each have their own database access code. That is a small amount of repetition, accepted so the worker cannot reach API services.

## Alternatives considered

- **Separate repositories.** Shared packages would need publishing and versioning, which is overhead with no benefit for a single team.
- **Nx instead of Turborepo.** More features, including its own boundary rules, but heavier to configure. Turborepo plus ESLint covers what we need.
- **npm or Yarn workspaces.** Both work, but pnpm's strict dependency isolation is what makes rule 1 above enforce itself.
- **Sharing API services with the worker.** It would avoid some repetition, but it would give the worker every capability the API has, including creating messages.

## Verification

- CI lint fails on any import that breaks the dependency table. When the rule is added in Phase 1, it is tested against a deliberate violation.
- CI `openapi:check` fails if the committed `openapi.json` or the generated client is out of date.
- Both web apps build and typecheck against the generated client with no direct database dependency.
