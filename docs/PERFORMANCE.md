# Performance (NFR-1)

NFR-1 asks that loading the queue, opening a ticket and replying feel responsive under normal load, with under about a second of server-side processing each, not counting the network or the browser. This page records how that was measured and what came out, on 3 October 2026.

## The short answer

On a database holding 5,060 tickets, every one of those operations took **under 35 ms** of server time, and the 95th percentile of the slowest (a reply that also moves the ticket on) was **30 ms**: about 3% of the budget. The planner serves the queue and the thread from their indexes, with no sort and no sequential scan.

## How it is measured

- **What is timed.** The three endpoints send a `Server-Timing: app;dur=<ms>` header (staff routes only, so precise timings can't help anyone time a password check). It runs from Fastify's first hook to the response being sent. That covers parsing, the session, CSRF, rate-limit and permission guards, validation, every query, the transaction and serialisation: everything the server does, and nothing the network or browser does.
- **The data.** The demo seed (60 hand-written tickets, 20 customers, 9 staff), plus 5,000 tickets from the bulk generator (`packages/db/src/seed/bulk.ts`). It writes 1,000 customers, 22,976 messages and 34,418 audit events. The mix: 30% open, 15% waiting on the customer, 25% resolved and 30% closed. 60% are assigned across the agents, ages run up to 180 days, and every 500th ticket has a 60-message thread. The generator is deterministic for a given count.
- **The run.** `apps/api/test/performance/nfr1.int.spec.ts` starts the real application in-process on that database: the same `createApp` as production, with PostgreSQL and Redis from Compose. It signs in as the demo agent and runs each operation 3 times to warm up, then 100 times (`pnpm --filter @dsd/api perf`). Replies go to 100 different open tickets, so no thread grows unrealistically. It also prints `EXPLAIN ANALYZE` for the two queries the queue and the ticket view lean on.
- **In CI.** The same file runs in `pnpm test` with 15 samples per operation and fails if any operation's p95 reaches 1 second. A slow query introduced later fails the build, not a reviewer's afternoon.

To reproduce:

```bash
docker compose up --detach --wait postgres redis seaweedfs
pnpm --filter @dsd/db build
pnpm --filter @dsd/api perf
```

To look at a full queue in the running app, add the same 5,000 tickets to the Compose stack (once per database):

```bash
docker compose run --rm migrate node dist/cli/seed-bulk.js 5000
```

## Results

The machine was a laptop: an Intel Core i7-13650HX with 16 GB of memory, on Windows 11 with Docker Desktop (WSL 2). PostgreSQL 18 and Redis 8 ran in containers and the API ran on the host, with Node.js 24.

| Operation                             | Requests | p50 (ms) | p95 (ms) | Max (ms) |
| ------------------------------------- | -------- | -------- | -------- | -------- |
| Queue: open, most urgent first        | 100      | 7.8      | 9.2      | 10.1     |
| Queue: every status, newest first     | 100      | 12.8     | 14.3     | 16.8     |
| Queue: my open and waiting tickets    | 100      | 5.0      | 6.1      | 7.3      |
| Queue: urgent and high, unassigned    | 100      | 5.1      | 6.0      | 7.3      |
| Queue: page 11, by age                | 100      | 9.7      | 10.9     | 12.5     |
| Open a ticket (4 messages)            | 100      | 8.1      | 9.4      | 9.9      |
| Open the longest ticket (60 messages) | 100      | 8.7      | 10.0     | 11.2     |
| Reply                                 | 100      | 18.5     | 20.8     | 25.7     |
| Reply and wait for the customer       | 100      | 22.8     | 29.8     | 34.3     |

What the numbers say:

- **Reads cost a few milliseconds.** The default queue is one index scan (`tickets_queue_idx` on brand, status, priority and age) that stops after 26 rows. Paging uses keyset cursors, so page 11 costs about the same as page 1. The widest view, every status newest first, is the slowest read because it filters the least, and it is still under 17 ms.
- **Opening a ticket hardly depends on its length.** The thread is one index-only scan on `messages_thread_idx`. A 60-message ticket takes about half a millisecond longer than a 4-message one. The rest is the ticket, its customer, files and history, read in one snapshot.
- **Writes cost the transaction.** A reply locks the ticket row and writes the message, the audit event and the outbox event in one transaction ([ADR-0005](adr/0005-outbox-queues-notifications.md)). A status change adds a second audit event and the status update. That is where its extra 4 to 9 ms go. Nothing slow happens in the request: emails and AI drafts are the worker's job.

The plans, at this size and with no planner settings forced:

```text
Open queue, most urgent first:
  Limit (actual rows=26.00 loops=1)
    ->  Index Scan using tickets_queue_idx on tickets (actual rows=26.00 loops=1)
          Index Cond: ((brand_id = '...'::uuid) AND (status = 'open'::ticket_status))
  Execution Time: 0.064 ms

The longest thread:
  Index Only Scan using messages_thread_idx on messages (actual rows=60.00 loops=1)
    Index Cond: (ticket_id = '...'::uuid)
  Execution Time: 0.030 ms
```

## Limits

- **One request at a time.** These are server times for single requests, not a load test. NFR-1 is about responsiveness under normal load, which for one support team is a few requests a second. Concurrency, connection pooling and throughput under many agents are part of the [100x plan](../README.md#at-100x-scale), not measured here.
- **A warm cache on a fast laptop.** The working set fits in memory, as it would for a single brand's live tickets. A cold cache or a smaller server would be slower, and the margin (about 30 times) leaves room for that.
- **5,000 tickets, not 500,000.** The plans scale with the rows returned, not the table size: index scans with a limit, and keyset pages. They would only change shape when the data outgrows memory, which is where the scaling notes start.
