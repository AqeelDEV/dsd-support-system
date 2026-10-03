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

### The customer app

Open http://localhost:3000. Without signing in you can search the help centre, read articles and contact support: a request needs only an email, a subject and a description, with up to five files. The acknowledgement email carries a link that opens the request, where you can follow the replies and answer. **Find a request** emails a fresh link for an earlier one.

Sign in as `customer@example.com` to see **My requests** with the seeded history, or create an account from **Sign in**: sign-up is email-first, so the link to finish it arrives in Mailpit, and any requests sent earlier from that address appear in the account. **Forgot your password?** works the same way.

### The agent app

Open http://localhost:3001 and sign in as `agent@dsd.example`, `supervisor@dsd.example` or `admin@dsd.example`.

- **Queue:** saved views (my tickets, unassigned, all open, awaiting customer, escalated, resolved), filters and sorting kept in the address, background refresh, and the keyboard: `j` and `k` move, `Enter` opens, `?` lists every shortcut.
- **Ticket:** the conversation with internal notes on an amber surface and status changes on the rail; a composer for replies and notes with canned responses filled in for the ticket (`r`, `n`, `Ctrl+Enter`); an AI-drafted reply grounded in the knowledge base, to insert and edit (below); status, priority, assignment and escalation; the customer's other tickets; and the full activity history.
- **Knowledge base:** articles with a live preview that matches the help centre, publishing, and categories. **Canned responses** with a variable picker.
- **Reports** (volume over time, first-response and resolution times, tickets per agent) and **Team** (invite, change role, deactivate) for supervisors and admins.

What each person sees comes from the API: the sections from the permissions `/me` reports, and every control on a ticket from its `allowedActions` and `allowedTransitions`. An agent who opens `/reports` by address is told they don't have access, because the API refuses it.

The API's routes can still be tried from Swagger UI at http://localhost:4000/api/docs: sign in with "Try it out" on a `login` route, and Swagger UI adds the CSRF token to later requests.

### Emails

Every email the system sends goes to Mailpit, a local mail catcher: open http://localhost:8025 to read them. Raise a ticket as a guest and the acknowledgement arrives with a link that opens it; an agent's reply, a status change, sign-up, a password reset and an agent invite each send theirs. Each link opens its page in the customer app, and an invite opens the agent app, where the new colleague chooses a password.

Emails are sent by the worker, never by a request: if the mail server is down, tickets and replies still go through and the emails follow once it is back. A job that keeps failing ends up in a dead-letter queue: `docker compose exec worker node dist/cli/dead-letter.js list` shows it and `... replay --all` sends it again.

Customers and staff are separate realms: a customer session is refused by every staff route and the other way round ([ADR-0003](docs/adr/0003-authentication-and-sessions.md), [ADR-0004](docs/adr/0004-authorization-rbac.md)). Because this stack runs on plain `http://localhost`, its cookies leave out the `Secure` flag and the `__Host-` prefix, which browsers refuse there. A real deployment keeps both, and the API refuses to start without them unless every trusted origin is on localhost.

### AI-assisted replies

Raise a request whose answer is in the help centre ("My refund was issued four days ago but it isn't back on my card yet") and open it in the agent app. Within a few seconds the **Suggested reply** panel beside the ticket shows a draft built from the knowledge base, with the articles it cites and the exact text it used. **Insert into reply** puts the draft in the composer; you edit it and send it as your own reply. **Regenerate** asks for a fresh draft, and the thumbs record whether it helped. A request the knowledge base doesn't cover ("Are you hiring in Lisbon?") gets **No grounded suggestion available** instead of a guess.

It runs offline out of the box: a deterministic mock drafts from the retrieved articles, so there is no key to set and no ticket text leaves your machine. To use a real model, put a provider and its key in `.env` and restart the worker; it re-embeds the knowledge base with the new embedding model when it starts:

```bash
LLM_PROVIDER=gemini
EMBEDDINGS_PROVIDER=gemini
GEMINI_API_KEY=your-key
```

Gemini is the provider this project runs and measures (one key covers drafting and embeddings, and the free tier is enough to try it). Anthropic (`claude-sonnet-5-5` by default) and OpenAI (`LLM_MODEL` required) have adapters too, tested against stand-ins for their APIs but not run live here. `.env.example` lists every setting.

How the guardrail works, in short ([ADR-0006](docs/adr/0006-ai-suggestions-and-guardrail.md)):

- The worker drafts and the API sends, and the two never meet: the worker's code can't import the messages table and its database role can't write to it, and the only route that creates a customer-visible reply needs an agent's session. The RBAC matrix checks on every call that no other route creates one.
- A reply built from a draft names it; the API accepts only a ready draft on the same ticket, records the sender as its approver and audits it, and the database refuses an approval by anyone but the author.
- Every draft cites the articles it used, and a citation the model wasn't given throws the draft away. When retrieval finds nothing close enough, the model is never called.
- Ticket text reaches the model as escaped, delimited data. A ticket that tells the model to promise a refund produces, at worst, a draft for an agent to read.
- Suggestions are for staff only; customers and guests are refused on every suggestion route, and no customer response can carry one.
- If the AI provider is down, tickets and replies carry on: the draft is retried, then marked unavailable.

Gemini (`gemini-3.5-flash-lite` with `gemini-embedding-2`) was measured on two sets of synthetic tickets:

- **The tuning set (24 tickets)**, on which the gate's thresholds were chosen:
  - an expected article ranked first for 19/20 retrievable tickets;
  - 18/18 answerable tickets got a draft, every citation valid;
  - 4/4 unanswerable tickets declined;
  - 2/2 injections ignored.
- **A held-out set (16 tickets)**, written afterwards and run once with the thresholds frozen:
  - 10/11 ranked first;
  - 5/6 answerable drafted (the miss got no draft rather than a wrong one);
  - 4/5 unanswerable declined;
  - 5/5 injections ignored.

A draft takes about 1.5 seconds. [docs/EVALUATION.md](docs/EVALUATION.md) has the method, the per-case results and the limits; `pnpm --filter @dsd/worker eval` runs it.

### Screenshots

| Help centre                                                                         | Contact support                                                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ![The customer app's home page](docs/screenshots/customer-home.png)                 | ![The contact form suggesting articles](docs/screenshots/customer-new-request.png) |
| **A request on a phone**                                                            | **My requests**                                                                    |
| ![A request's conversation on a phone](docs/screenshots/customer-thread-mobile.png) | ![The signed-in customer's requests](docs/screenshots/customer-my-requests.png)    |
| **The agent's queue**                                                               | **A ticket, with an AI-drafted reply, notes and history**                          |
| ![The agent queue](docs/screenshots/agent-queue.png)                                | ![An agent's ticket view](docs/screenshots/agent-ticket.png)                       |
| **Reports**                                                                         | **The knowledge-base editor**                                                      |
| ![The reporting dashboard](docs/screenshots/agent-reports.png)                      | ![Editing an article with a live preview](docs/screenshots/agent-kb-editor.png)    |

## Development

You need Node.js 24 and pnpm 12. The exact versions are pinned in `.nvmrc` and in `package.json` under `packageManager`.

```bash
pnpm install
docker compose up --detach --wait postgres redis seaweedfs mailpit
pnpm test
```

The tests run against real PostgreSQL, Redis and the S3-compatible object store, started from the same `compose.yaml`, because the design depends on database constraints, triggers, privileges and storage access rules that a mock would hide.

The browser tests drive the production builds of both apps on the full stack, with Mailpit for the emails: start it with `docker compose up --build --wait`, run `pnpm --filter @dsd/e2e exec playwright install chromium` once, then `pnpm test:e2e`.

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
| `pnpm test:e2e`         | Playwright browser tests against the running Compose stack             |
| `pnpm screenshots`      | Regenerates the screenshots in `docs/screenshots`                      |
| `pnpm dev`              | Runs the web apps in development mode                                  |

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Git hooks format and lint staged files and check commit messages, and CI checks the same rules on every push.

## Troubleshooting

### A port is already in use on Windows

On Windows, Hyper-V, WSL 2 and Docker Desktop reserve blocks of TCP ports, and the reservations change after a reboot or an update. `docker compose up` then fails with "ports are not available" or "An attempt was made to access a socket in a way forbidden by its access permissions", even though nothing is listening on the port. The data stores' default host ports (15432, 16379 and 18333) sit below Windows' dynamic range (49152–65535), where most of these reservations land, but a reservation can still cover them or one of the app ports.

To see the reserved ranges, run this in PowerShell or Command Prompt:

```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

Restarting the Windows NAT service releases the reservations. Run these in an administrator terminal, then start the stack again:

```powershell
net stop winnat
net start winnat
```

This briefly drops networking for WSL and running containers. If a port stays reserved, choose another one in `.env` instead: `POSTGRES_PORT`, `REDIS_PORT`, `S3_PORT`, `API_PORT`, `CUSTOMER_WEB_PORT` or `AGENT_WEB_PORT`. The tests follow `POSTGRES_PORT`, `REDIS_PORT` and `S3_PORT` automatically; a host-run API or worker reads the URLs in `.env`, so change those to match.

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
e2e/              Playwright browser tests of both apps
docs/             Requirements, architecture, data model and decision records
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md): components, request flows, events and failure behaviour
- [Data model](docs/DATA_MODEL.md): tables, constraints, indexes and database roles
- [Decision records](docs/adr/README.md): what was decided, why, and what was rejected
- [Evaluation](docs/EVALUATION.md): how well AI suggestions retrieve, ground and abstain, on the mock and on Gemini
- [Traceability](docs/TRACEABILITY.md): every requirement, where it lives and what proves it
- [Requirements](docs/SRS.md): the specification this system is built against
