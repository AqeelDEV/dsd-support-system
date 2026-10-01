import { DOMAIN_EVENTS } from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { RETRY_POLICIES, retryPolicy } from "../queues/queues.js";
import { jobIdFor, ROUTES } from "./routes.js";

describe("routes", () => {
  it("routes every domain event, and only those", () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...DOMAIN_EVENTS].sort());
  });

  it("sends customer-facing events to notifications and nothing else anywhere yet", () => {
    const routed = Object.entries(ROUTES)
      .filter(([, queues]) => queues.length > 0)
      .map(([event]) => event)
      .sort();
    expect(routed).toEqual([
      "agent.invited",
      "customer.password_reset_requested",
      "customer.signup_requested",
      "guest_access.requested",
      "message.created",
      "ticket.created",
      "ticket.status_changed",
    ]);
    for (const queues of Object.values(ROUTES)) {
      expect(queues.every((queue) => queue === "notifications")).toBe(true);
    }
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
  it("retries notifications five times, exponentially from 10 s, with jitter", () => {
    expect(RETRY_POLICIES.notifications).toEqual({
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000, jitter: 0.5 },
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
