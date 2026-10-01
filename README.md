# DSD Unified Customer Support System

Customers raise support tickets and follow them through to resolution. Agents, supervisors and admins work those tickets from one shared queue. AI-drafted replies are grounded in a knowledge base, and nothing an AI writes reaches a customer until an agent sends it.

The system is being built in phases. [docs/TRACEABILITY.md](docs/TRACEABILITY.md) shows which requirements are built and which tests prove them.

## Quick start

You need Docker with Compose v2. Nothing else: no Node.js, no API keys, no `.env` file.

```bash
docker compose up --build --wait
```

The command returns once every service reports healthy. The first build takes a few minutes.

| What                  | Where                                                     |
| --------------------- | --------------------------------------------------------- |
| Customer app          | http://localhost:3000                                     |
| Agent app             | http://localhost:3001                                     |
| API docs (Swagger UI) | http://localhost:4000/api/docs                            |
| OpenAPI document      | http://localhost:4000/api/docs/openapi.json               |
| Sent emails (Mailpit) | http://localhost:8025                                     |
| API health            | http://localhost:4000/health, http://localhost:4000/ready |

To check the running stack from the outside, run `scripts/smoke.sh` (bash and curl). Stop everything with `docker compose down`, and add `-v` to delete the data too.

The defaults are for local development only. To change a password or a port, copy `.env.example` to `.env` and edit it.

### Demo accounts

The stack starts with synthetic demo data. Every demo account's password is `dsd-demo-password`.

| Role       | Email                    | Signs in through        |
| ---------- | ------------------------ | ----------------------- |
| Customer   | `customer@example.com`   | Customer app, port 3000 |
| Agent      | `agent@dsd.example`      | Agent app, port 3001    |
| Supervisor | `supervisor@dsd.example` | Agent app, port 3001    |
| Admin      | `admin@dsd.example`      | Agent app, port 3001    |

Two more staff accounts exist for testing the edges: `former.agent@dsd.example` has been deactivated, and `new.starter@dsd.example` was invited but hasn't set a password. Neither can sign in.

The apps' sign-in screens aren't built yet. Until they are, sign in from Swagger UI: open `POST /api/v1/auth/customer/login` or `POST /api/v1/auth/staff/login`, choose "Try it out", and send the email and password. The browser keeps the session cookie, and Swagger UI adds the CSRF token to later requests, so `me`, `logout` and every staff or customer route work from the same page. Routes that take files (raising a ticket, replies and internal notes) use a multipart form with the fields first and up to five files in `attachments`.

Beyond tickets, the API serves:

- **The help centre**, without signing in: `GET /api/v1/public/kb/articles` browses the published articles, and with `q` searches them (for example `q=refund`), each result with a snippet showing where the words matched.
- **For staff:** knowledge-base authoring under `/api/v1/staff/kb`, canned responses filled in for a ticket under `/api/v1/staff/canned-responses`, reports under `/api/v1/staff/reports` (volume, response times, tickets per agent) and agent management under `/api/v1/staff/agents`. Agents can read and use these; writing, publishing, reporting and managing people need the supervisor or admin account.

### Emails

Every email the system sends goes to Mailpit, a local mail catcher: open http://localhost:8025 to read them. Raise a ticket as a guest and the acknowledgement arrives with a link that opens it; an agent's reply, a status change, sign-up, a password reset and an agent invite each send theirs. The links point at the customer and agent apps, whose pages for them arrive with the apps; until then, the token in a link can be posted to its API route from Swagger UI (for example `POST /api/v1/auth/customer/guest-access/exchange`).

Emails are sent by the worker, never by a request: if the mail server is down, tickets and replies still go through and the emails follow once it is back. A job that keeps failing ends up in a dead-letter queue: `docker compose exec worker node dist/cli/dead-letter.js list` shows it and `... replay --all` sends it again.

Customers and staff are separate realms: a customer session is refused by every staff route and the other way round ([ADR-0003](docs/adr/0003-authentication-and-sessions.md), [ADR-0004](docs/adr/0004-authorization-rbac.md)). Because this stack runs on plain `http://localhost`, its cookies leave out the `Secure` flag and the `__Host-` prefix, which browsers refuse there. A real deployment keeps both, and the API refuses to start without them unless every trusted origin is on localhost.

## Development

You need Node.js 24 and pnpm 12. The exact versions are pinned in `.nvmrc` and in `package.json` under `packageManager`.

```bash
pnpm install
docker compose up --detach --wait postgres redis seaweedfs
pnpm test
```

The tests run against real PostgreSQL, Redis and the S3-compatible object store, started from the same `compose.yaml`, because the design depends on database constraints, triggers, privileges and storage access rules that a mock would hide.

| Command                 | What it does                                                           |
| ----------------------- | ---------------------------------------------------------------------- |
| `pnpm build`            | Builds every package and app                                           |
| `pnpm lint`             | ESLint, including the rules that enforce the workspace boundaries      |
| `pnpm typecheck`        | TypeScript in strict mode                                              |
| `pnpm test`             | Unit and integration tests                                             |
| `pnpm test:unit`        | Tests that need no running services                                    |
| `pnpm format`           | Formats everything with Prettier                                       |
| `pnpm openapi:generate` | Regenerates `apps/api/openapi.json` and the typed client from the code |
| `pnpm openapi:check`    | Fails if the committed OpenAPI document or client is out of date       |
| `pnpm dev`              | Runs the web apps in development mode                                  |

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Git hooks format and lint staged files and check commit messages, and CI checks the same rules on every push.

## Repository layout

```text
apps/
  api/            NestJS API on Fastify: every business rule, authentication and authorisation
  worker/         Background jobs: notifications, knowledge-base indexing, AI drafts
  customer-web/   Next.js app for customers
  agent-web/      Next.js app for agents, supervisors and admins
packages/
  shared/         zod schemas and types used by the API, the worker and both apps
  api-client/     Typed client generated from the OpenAPI document, and the apps' API proxy
  db/             Database access (server only)
  ui/             Shared React components and theme
  config/         TypeScript, ESLint and Next.js presets
docs/             Requirements, architecture, data model and decision records
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md): components, request flows, events and failure behaviour
- [Data model](docs/DATA_MODEL.md): tables, constraints, indexes and database roles
- [Decision records](docs/adr/README.md): what was decided, why, and what was rejected
- [Traceability](docs/TRACEABILITY.md): every requirement, where it lives and what proves it
- [Requirements](docs/SRS.md): the specification this system is built against
