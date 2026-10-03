import { DOMAIN_EVENTS } from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { RETRY_POLICIES, retryPolicy } from "../queues/queues.js";
import { jobIdFor, ROUTES } from "./routes.js";

describe("routes", () => {
  it("routes every domain event, and only those", () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...DOMAIN_EVENTS].sort());
  });

  it("sends customer-facing events to notifications and article changes to indexing", () => {
    const routed = Object.fromEntries(
      Object.entries(ROUTES).filter(([, queues]) => queues.length > 0),
    );
    expect(routed).toEqual({
      "agent.invited": ["notifications"],
      "customer.password_reset_requested": ["notifications"],
      "customer.signup_requested": ["notifications"],
      "guest_access.requested": ["notifications"],
      "message.created": ["notifications"],
      "ticket.created": ["notifications"],
      "ticket.status_changed": ["notifications"],
      "kb.article_published": ["kb-indexing"],
      "kb.article_unpublished": ["kb-indexing"],
    });
  });

  it("builds job IDs BullMQ accepts", () => {
    const id = jobIdFor(
      "0199a1b2-0000-7000-8000-000000000001",
      "notifications",
    );
    expect(id).toBe("0199a1b2-0000-7000-8000-000000000001.notifications");
    expect(id).not.toContain(":");
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

  it("lets tests shorten only the first delay", () => {
    expect(retryPolicy("notifications", 5)).toEqual({
      attempts: 5,
      backoff: { type: "exponential", delay: 5, jitter: 0.5 },
    });
    expect(retryPolicy("maintenance")).toBe(RETRY_POLICIES.maintenance);
  });
});
