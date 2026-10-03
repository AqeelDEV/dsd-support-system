import { describe, expect, it } from "vitest";

import {
  parseReplyDraft,
  REPLY_DRAFT_JSON_SCHEMA,
  REPLY_STATUSES,
} from "./reply-draft.js";

const valid = {
  status: "answered",
  reply: "Hi Ana, refunds reach your card within 3 to 5 working days.",
  citations: [{ sourceId: "S1" }],
};

describe("the reply draft contract", () => {
  it("accepts an answered draft with citations, and drops unknown fields", () => {
    expect(
      parseReplyDraft(JSON.stringify({ ...valid, confidence: 0.9 })),
    ).toEqual({ ok: true, draft: valid });
  });

  it("accepts an empty reply only when the sources don't answer the ticket", () => {
    expect(
      parseReplyDraft(
        JSON.stringify({
          status: "insufficient_context",
          reply: "",
          citations: [],
        }),
      ).ok,
    ).toBe(true);
    expect(parseReplyDraft(JSON.stringify({ ...valid, reply: "   " })).ok).toBe(
      false,
    );
  });

  it.each([
    ["prose", "Here's a reply you could send."],
    ["JSON in a code fence", "```json\n{}\n```"],
    ["a missing field", JSON.stringify({ status: "answered", reply: "Hi" })],
    ["an unknown status", JSON.stringify({ ...valid, status: "maybe" })],
    [
      "a citation that isn't a source ID",
      JSON.stringify({
        ...valid,
        citations: [{ sourceId: "the refund article" }],
      }),
    ],
    [
      "a draft that is too long",
      JSON.stringify({ ...valid, reply: "x".repeat(6_001) }),
    ],
  ])("refuses %s", (_case, text) => {
    expect(parseReplyDraft(text).ok).toBe(false);
  });

  it("describes the same contract in the JSON Schema given to providers", () => {
    expect(REPLY_DRAFT_JSON_SCHEMA.required).toEqual([
      "status",
      "reply",
      "citations",
    ]);
    expect(REPLY_DRAFT_JSON_SCHEMA.properties.status.enum).toEqual([
      ...REPLY_STATUSES,
    ]);
    expect(REPLY_DRAFT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(
      REPLY_DRAFT_JSON_SCHEMA.properties.citations.items.additionalProperties,
    ).toBe(false);
  });
});
