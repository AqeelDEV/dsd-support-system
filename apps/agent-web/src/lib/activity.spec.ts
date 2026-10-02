import type { AuditEvent } from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { describeEvent } from "./activity";

const event = (
  action: string,
  after: Record<string, unknown> | null,
): AuditEvent => ({
  id: "01a0f91b-0000-7000-8000-000000000001",
  action,
  entityType: "ticket",
  entityId: "01a0f91b-0000-7000-8000-000000000002",
  actor: { type: "agent", id: null, name: "Dora Rath" },
  before: null,
  after,
  requestId: "r",
  createdAt: "2026-10-02T10:00:00.000Z",
});

const names = (id: string) => (id === "a1" ? "Floyd Leuschke" : undefined);

describe("describeEvent", () => {
  it("words status, priority, assignment and escalation for the rail", () => {
    expect(
      describeEvent(
        event("ticket.status_changed", { status: "resolved" }),
        names,
      ),
    ).toEqual({
      text: "Status changed to Resolved",
      tone: "success",
      onRail: true,
    });
    expect(
      describeEvent(
        event("ticket.priority_changed", { priority: "urgent" }),
        names,
      ).text,
    ).toBe("Priority set to Urgent");
    expect(
      describeEvent(event("ticket.assigned", { assigneeAgentId: "a1" }), names)
        .text,
    ).toBe("Assigned to Floyd Leuschke");
    expect(
      describeEvent(event("ticket.assigned", { assigneeAgentId: null }), names)
        .text,
    ).toBe("Unassigned");
    expect(
      describeEvent(
        event("ticket.escalated", { escalated: true, assigneeAgentId: "zz" }),
        names,
      ).text,
    ).toBe("Escalated to a colleague");
  });

  it("keeps messages off the rail, where the messages themselves are", () => {
    expect(
      describeEvent(
        event("message.created", { visibility: "internal" }),
        names,
      ),
    ).toMatchObject({
      text: "Added an internal note",
      onRail: false,
    });
  });

  it("never hides an action it doesn't know", () => {
    expect(describeEvent(event("ticket.merged", null), names).text).toBe(
      "ticket.merged",
    );
  });
});
