# ADR-0001: Technology stack

- Status: Accepted
- Date: 2026-09-30
- Requirements: FR-0, NFR-0, NFR-2, NFR-4, NFR-12, NFR-13

## Context

The SRS leaves the language, frameworks and database to us (FR-0) but asks for the reasoning behind them. It also sets constraints that narrow the choice:

- The system must be deployable through a documented, reproducible process (NFR-0). A reviewer will run it on a clean machine.
- The backend must be stateless so it can run as several instances (NFR-2).
- Slow or unreliable work (email, AI suggestions) should not block the request that triggered it (NFR-4).
- Business rules must not be duplicated across the two front ends (NFR-12).
- Nothing may depend on one cloud provider's proprietary services (NFR-13).

The data is relational and needs strict integrity: tickets, messages and an audit trail that must never be rewritten. On top of that we need keyword search over the knowledge base (FR-4) and vector search for grounded AI suggestions (FR-21).

One engineer builds this in a bounded time. That favours mainstream, well-documented tools that a reviewer can run and read without special knowledge.

## Decision

| Concern                     | Choice                                                                       | Why                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language and runtime        | TypeScript with `strict: true` on Node.js 24 LTS                             | One language across the API, the worker and both UIs, so request and response types and validation schemas are shared instead of copied. Node 24 is the current LTS line (maintenance from October 2026, end of life April 2028). |
| Monorepo                    | pnpm workspaces and Turborepo                                                | Shared packages without publishing them. See [ADR-0002](0002-monorepo-layout.md).                                                                                                                                                 |
| API                         | NestJS with the Fastify adapter                                              | Modules, guards and pipes map directly onto our layering and RBAC design. Fastify is faster than Express and has maintained plugins for cookies, multipart uploads and security headers.                                          |
| Validation and API contract | zod schemas in `packages/shared`                                             | One definition drives server-side validation, the generated OpenAPI document (API-1), the typed client and the forms in both UIs.                                                                                                 |
| Background work             | A separate `apps/worker` process using BullMQ                                | Email, embeddings and LLM calls run outside the request path (NFR-4, NFR-10). See [ADR-0005](0005-outbox-queues-notifications.md).                                                                                                |
| User interfaces             | Two Next.js apps (App Router), Tailwind CSS, shadcn/ui                       | Separate deployables make the customer and staff boundary structural rather than a matter of discipline. Both are thin clients over the API.                                                                                      |
| Database                    | PostgreSQL 18 with the pgvector extension                                    | Relational integrity, full-text search and vector search in one database. Reasons below.                                                                                                                                          |
| Data access                 | Drizzle ORM and drizzle-kit migrations                                       | First-class support for the Postgres features this design depends on. Reasons below.                                                                                                                                              |
| Cache, queues, rate limits  | Redis 8                                                                      | Shared state outside the API process, so any instance can serve any request (NFR-2).                                                                                                                                              |
| File storage                | The S3 API through AWS SDK v3; SeaweedFS as the local S3 server              | No cloud lock-in (NFR-13). Reasons below.                                                                                                                                                                                         |
| Email                       | SMTP through Nodemailer, behind a notification interface; Mailpit locally    | A real, working integration that any SMTP provider can sit behind (FR-5, FR-20). Mailpit shows every sent email in a web UI.                                                                                                      |
| LLM and embeddings          | Provider interfaces with Anthropic, OpenAI and a deterministic mock          | The whole system runs offline with no API key. See [ADR-0006](0006-ai-suggestions-and-guardrail.md).                                                                                                                              |
| Tests                       | Vitest; Supertest against real Postgres and Redis; Playwright for end-to-end | Tests run against the same database engine as production. Mocking Postgres would hide the constraints and triggers this design relies on.                                                                                         |
| CI                          | GitHub Actions: lint, typecheck, test, build                                 | Every push is checked the same way.                                                                                                                                                                                               |
| Local runtime               | Docker Compose for the whole stack                                           | One command brings everything up (NFR-0).                                                                                                                                                                                         |

### Why PostgreSQL, and why version 18

Tickets, messages and audit events need foreign keys, CHECK constraints and triggers, and Postgres has all of them. Its built-in full-text search covers knowledge-base search (FR-4) without another service. pgvector keeps embeddings next to the articles they came from, so hybrid retrieval is one SQL query and follows the same backup and transaction rules as everything else. A dedicated vector database only becomes worth running at far larger volumes than a few dozen articles.

We use version 18 rather than 16 or 17 because it is the current stable major version (18.0 shipped in September 2025) and it adds two things we use:

- a built-in `uuidv7()` function, so primary keys are time-ordered and inserts stay local in B-tree indexes;
- skip scan on multicolumn B-tree indexes, which helps queue queries that filter on a later column of an index.

pgvector supports 18. Nothing else in the design depends on it, so moving back to 17 would only mean generating UUIDv7 values in the application.

### Why Drizzle rather than Prisma

This design leans on Postgres features that an ORM either supports properly or fights:

- a `vector(1024)` column with an HNSW index;
- a generated `tsvector` column with a GIN index;
- CHECK constraints, including one that enforces the AI approval rule (ADR-0006);
- partial indexes for the ticket queue and the outbox;
- `SELECT ... FOR UPDATE SKIP LOCKED` for the outbox dispatcher.

Drizzle declares all of these in the TypeScript schema. drizzle-kit generates migrations by comparing schema snapshots rather than inspecting the live database, so hand-written migrations (triggers, grants) are never flagged as drift or dropped. Queries read like SQL, which makes it easier to reason about index use when checking plans with `EXPLAIN`.

Prisma 7, the stable Prisma line at the time of writing, represents vector and tsvector columns as `Unsupported` fields. Those fields are left out of the generated client, so every read and write needs raw SQL. HNSW indexes and GIN indexes on those columns can't be declared in the schema either, so they would live in hand-edited migrations that Prisma's database-diffing migrate command tends to drop. Prisma 8 adds pgvector through extension packs, but it was still in early access in September 2026.

We use Drizzle's stable 0.x line and will move to v1 once it is released (it was at release candidate stage in September 2026). To keep that upgrade small, repositories use the core query builder rather than the relational query API, which is the part v1 changes most.

### Why SeaweedFS instead of MinIO

The application talks to object storage only through the S3 API, so the server behind it is a deployment detail. In production it can be any S3-compatible service.

MinIO was the obvious local choice, but it stopped publishing community-edition container images in October 2025 and deleted `minio/minio` from Docker Hub on 11 September 2026. A compose file that pulls that image fails on a clean machine, which breaks NFR-0.

SeaweedFS is Apache-2.0 licensed, has been in production use for years, and runs its S3 gateway in a single container. If it causes trouble, Garage is the fallback, and switching means changing the compose file and a few environment variables.

### Why the worker does not use NestJS

NestJS earns its place in the API through modules, guards and OpenAPI generation. The worker needs none of those. It runs an outbox dispatcher loop and a handful of job handlers. A plain entry point that builds its dependencies explicitly keeps the worker small and makes it obvious what the worker can and cannot touch. That matters because the AI guardrail (ADR-0006) relies on the worker having no path to customer-visible messages.

### Redis licensing

Redis 8 is available under the AGPLv3, alongside its other licences, which allows running it unmodified as a service. Valkey, a BSD-licensed fork that speaks the same protocol, is a drop-in replacement if a licence review prefers it.

## Consequences

- One language and one set of schemas runs from the database to the browser, which removes a whole class of "the front end and back end disagree" bugs.
- The full stack runs locally with no cloud accounts and no API keys. Storage, email and the LLM each sit behind an interface, so each can be swapped without touching business logic.
- Two Next.js apps mean two builds and a shared component package (`packages/ui`). That is extra plumbing we accept for the structural separation.
- NestJS adds framework weight and its own concepts to learn. For the API that trade is worth it; for the worker it is not, so the two apps look different inside.
- Moving from Drizzle 0.x to v1 is a known future task.
- SeaweedFS is less familiar to most reviewers than MinIO, so the README explains why it is there.

## Alternatives considered

- **Python (FastAPI) backend with TypeScript front ends.** The AI ecosystem is richer in Python, but two languages would mean duplicating types and validation rules across the boundary, which is exactly what NFR-12 warns against.
- **Express instead of Fastify.** More familiar, but slower, and it needs more third-party middleware for what Fastify covers with maintained plugins.
- **One Next.js app with role-based views.** The SRS allows it (§8), and it is less to build. But customer and staff code would ship in the same bundle and share one origin, so the boundary would depend on every route being written correctly.
- **Prisma 7.** Explained above.
- **A dedicated vector database** such as Qdrant. Another service to run and keep consistent with Postgres, for a corpus of a few dozen articles.
- **MinIO pulled from quay.io.** It still downloads, but community releases are no longer maintained there, so it would be a stopgap rather than a foundation.
- **Kafka or RabbitMQ.** Both are heavier to run than BullMQ on the Redis we already need, and nothing in v1 needs log replay or complex routing.

## Verification

- Phase 1: `docker compose up` on a clean checkout starts every service, `/ready` reports the database reachable, and CI runs lint, typecheck, tests and build on every push.
- Phase 11: a fresh clone into a new folder, following the README exactly, reaches a working system with seeded demo accounts.
- The README's "Tech choices" section restates this ADR for reviewers (FR-0).
