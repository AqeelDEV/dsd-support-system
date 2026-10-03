import { DOMAIN_EVENTS } from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { RETRY_POLICIES, retryPolicy } from "../queues/queues.js";
import type { OutboxJob } from "./dispatcher.js";
import { jobIdFor, jobOptionsFor, queuesFor, ROUTES } from "./routes.js";

const TICKET = "0199a1b2-0000-7000-8000-000000000002";
const EVENT = "0199a1b2-0000-7000-8000-000000000001";

const job = (type: OutboxJob["type"], payload: Record<string, unknown>) => ({
  eventId: EVENT,
  type,
  payload,
});

describe("routes", () => {
  it("routes every domain event, and only those", () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...DOMAIN_EVENTS].sort());
  });

  it("sends customer-facing events to notifications, ticket activity to suggestions and article changes to indexing", () => {
    const routed = Object.fromEntries(
      Object.entries(ROUTES).filter(([, queues]) => queues.length > 0),
    );
    expect(routed).toEqual({
      "agent.invited": ["notifications"],
      "customer.password_reset_requested": ["notifications"],
      "customer.signup_requested": ["notifications"],
      "guest_access.requested": ["notifications"],
      "message.created": ["notifications", "ai-suggestions"],
      "ticket.created": ["notifications", "ai-suggestions"],
      "ticket.status_changed": ["notifications"],
      "kb.article_published": ["kb-indexing"],
      "kb.article_unpublished": ["kb-indexing"],
      "ai.suggestion_requested": ["ai-suggestions"],
    });
  });

  it("drafts suggestions for customers' messages only, never for agents' replies or notes", () => {
    expect(
      queuesFor("message.created", {
        authorType: "customer",
        visibility: "public",
      }),
    ).toEqual(["notifications", "ai-suggestions"]);
    for (const visibility of ["public", "internal"]) {
      expect(
        queuesFor("message.created", { authorType: "agent", visibility }),
      ).toEqual(["notifications"]);
    }
  });

  it("builds job IDs BullMQ accepts", () => {
    const id = jobIdFor(EVENT, "notifications");
    expect(id).toBe(`${EVENT}.notifications`);
    expect(id).not.toContain(":");
  });

  it("debounces suggestion jobs per ticket: customer messages wait, new tickets and requests don't", () => {
    const deduplication = {
      id: `ticket.${TICKET}`,
      replace: true,
      keepLastIfActive: true,
    };
    expect(
      jobOptionsFor(
        "ai-suggestions",
        job("message.created", { ticketId: TICKET }),
        10_000,
      ),
    ).toEqual({
      jobId: `${EVENT}.ai-suggestions`,
      delay: 10_000,
      deduplication,
    });
    for (const type of ["ticket.created", "ai.suggestion_requested"] as const) {
      expect(
        jobOptionsFor(
          "ai-suggestions",
          job(type, { ticketId: TICKET }),
          10_000,
        ),
      ).toEqual({ jobId: `${EVENT}.ai-suggestions`, delay: 0, deduplication });
    }
  });

  it("adds other queues' jobs, and payloads without a ticket, by ID alone", () => {
    expect(
      jobOptionsFor(
        "notifications",
        job("message.created", { ticketId: TICKET }),
        10_000,
      ),
    ).toEqual({ jobId: `${EVENT}.notifications` });
    expect(
      jobOptionsFor("ai-suggestions", job("ticket.created", {}), 10_000),
    ).toEqual({ jobId: `${EVENT}.ai-suggestions` });
  });
});

describe("retry policies", () => {
  it("retries notifications and indexing five times, exponentially from 10 s, with jitter", () => {
    for (const queue of ["notifications", "kb-indexing"] as const) {
      expect(RETRY_POLICIES[queue]).toEqual({
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000, jitter: 0.5 },
      });
    }
  });

  it("retries a suggestion three times from 5 s, while the agent is likely still on the ticket", () => {
    expect(RETRY_POLICIES["ai-suggestions"]).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000, jitter: 0.5 },
    });
  });

  it("lets tests shorten only the first delay", () => {
    expect(retryPolicy("notifications", 5)).toEqual({
      attempts: 5,
      backoff: { type: "exponential", delay: 5, jitter: 0.5 },
    });
    expect(retryPolicy("maintenance")).toBe(RETRY_POLICIES.maintenance);
  });
});
