import { ApiProblem } from "@dsd/api-client";
import type { AiSuggestion } from "@dsd/shared";
import { describe, expect, it } from "vitest";

import {
  draftOrigin,
  expectsAutomaticDraft,
  panelState,
  requestRefusal,
} from "./suggestions";

const suggestion = (
  status: AiSuggestion["status"],
  createdAt: string,
): AiSuggestion => ({
  id: `0199a1b2-0000-7000-8000-${createdAt.slice(14, 16)}${createdAt.slice(17, 19)}00000000`,
  ticketId: "0199a1b2-0000-7000-8000-000000000001",
  status,
  draft: status === "ready" ? "Refunds take 3 to 5 working days." : null,
  citations: [],
  rejectionReason: null,
  requestedBy: null,
  provider: "mock",
  model: "mock-grounded-v1",
  promptVersion: "reply-draft/v1",
  retrievalMode: "hybrid",
  createdAt,
  completedAt: status === "pending" ? null : createdAt,
  myFeedback: null,
});

describe("panelState", () => {
  it("shows nothing, and isn't drafting, for a ticket without suggestions", () => {
    expect(panelState([], undefined)).toEqual({
      drafting: false,
      shown: undefined,
    });
  });

  it("keeps showing the last finished draft while a newer one is written", () => {
    const ready = suggestion("ready", "2026-10-03T10:00:00.000Z");
    expect(
      panelState(
        [suggestion("pending", "2026-10-03T10:05:00.000Z"), ready],
        undefined,
      ),
    ).toEqual({ drafting: true, shown: ready });
  });

  it("is drafting from the moment Generate is accepted until a suggestion created since appears", () => {
    const old = suggestion("no_grounded_answer", "2026-10-03T10:00:00.000Z");
    expect(panelState([old], "2026-10-03T10:01:00.000Z")).toEqual({
      drafting: true,
      shown: old,
    });
    const answer = suggestion("ready", "2026-10-03T10:01:00.000Z");
    expect(panelState([answer, old], "2026-10-03T10:01:00.000Z")).toEqual({
      drafting: false,
      shown: answer,
    });
  });

  it("shows a failed or rejected suggestion as the latest one, not an older draft", () => {
    const failed = suggestion("failed", "2026-10-03T10:05:00.000Z");
    expect(
      panelState(
        [failed, suggestion("ready", "2026-10-03T10:00:00.000Z")],
        undefined,
      ).shown,
    ).toBe(failed);
  });
});

describe("expectsAutomaticDraft", () => {
  const wrote = "2026-10-03T10:00:00.000Z";
  const at = (seconds: number) => Date.parse(wrote) + seconds * 1_000;

  it("expects one for two minutes after the customer writes", () => {
    expect(expectsAutomaticDraft([], wrote, at(5))).toBe(true);
    expect(expectsAutomaticDraft([], wrote, at(119))).toBe(true);
    expect(expectsAutomaticDraft([], wrote, at(121))).toBe(false);
  });

  it("stops expecting one once a suggestion has been created since", () => {
    expect(
      expectsAutomaticDraft(
        [suggestion("pending", "2026-10-03T10:00:12.000Z")],
        wrote,
        at(15),
      ),
    ).toBe(false);
    expect(
      expectsAutomaticDraft(
        [suggestion("ready", "2026-10-03T09:00:00.000Z")],
        wrote,
        at(15),
      ),
    ).toBe(true);
  });
});

describe("requestRefusal", () => {
  it("says when to try again after too many requests", () => {
    expect(
      requestRefusal(new ApiProblem({ status: 429, retryAfterSeconds: 290 })),
    ).toBe(
      "You've asked for several drafts in a short time. Try again in 5 minutes.",
    );
    expect(
      requestRefusal(new ApiProblem({ status: 429, retryAfterSeconds: 20 })),
    ).toMatch(/in 1 minute\.$/);
  });

  it("explains a refusal while the rate-limit store is down, and passes other problems on", () => {
    expect(requestRefusal(new ApiProblem({ status: 503 }))).toMatch(
      /can't be requested for a moment/,
    );
    expect(
      requestRefusal(
        new ApiProblem({ status: 409, detail: "The ticket is closed." }),
      ),
    ).toBe("The ticket is closed.");
    expect(requestRefusal(new Error("network"))).toBe(
      "The request didn't go through. Try again.",
    );
  });
});

describe("draftOrigin", () => {
  it("marks the offline mock's drafts as mock, whatever it calls its model", () => {
    expect(
      draftOrigin({ provider: "mock", model: "mock-grounded-v1" }),
    ).toEqual({ kind: "mock" });
    expect(
      draftOrigin({ provider: "mock", model: "gemini-lookalike" }),
    ).toEqual({ kind: "mock" });
  });

  it("names a real provider's model", () => {
    expect(
      draftOrigin({ provider: "gemini", model: "gemini-3.5-flash-lite" }),
    ).toEqual({ kind: "model", model: "gemini-3.5-flash-lite" });
  });
});
