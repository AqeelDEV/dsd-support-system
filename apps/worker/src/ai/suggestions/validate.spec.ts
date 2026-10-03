import { describe, expect, it } from "vitest";

import { parseReplyDraft } from "./reply-draft.js";
import { validateDraft } from "./validate.js";

const GIVEN = new Set(["S1", "S2", "S3"]);

const check = (answer: unknown) =>
  validateDraft(parseReplyDraft(JSON.stringify(answer)), GIVEN);

describe("the citation validator", () => {
  it("passes a draft that cites only sources it was given, once each", () => {
    expect(
      check({
        status: "answered",
        reply: "  Refunds take 3 to 5 working days.  ",
        citations: [{ sourceId: "S2" }, { sourceId: "S1" }, { sourceId: "S2" }],
      }),
    ).toEqual({
      status: "ready",
      reply: "Refunds take 3 to 5 working days.",
      citedSourceIds: ["S2", "S1"],
    });
  });

  it("rejects an answer that isn't the contract", () => {
    expect(validateDraft(parseReplyDraft("Sure, here you go!"), GIVEN)).toEqual(
      { status: "rejected", reason: "invalid_output" },
    );
  });

  it("believes a model that says the sources don't answer the ticket", () => {
    expect(
      check({ status: "insufficient_context", reply: "", citations: [] }),
    ).toEqual({ status: "no_grounded_answer" });
  });

  it("rejects a draft without citations", () => {
    expect(
      check({ status: "answered", reply: "Trust me.", citations: [] }),
    ).toEqual({ status: "rejected", reason: "no_citations" });
  });

  it("rejects a draft citing any source it wasn't given, even beside real ones", () => {
    for (const citations of [
      [{ sourceId: "S4" }],
      [{ sourceId: "S1" }, { sourceId: "S99" }],
    ]) {
      expect(check({ status: "answered", reply: "Hi", citations })).toEqual({
        status: "rejected",
        reason: "citation_not_in_retrieved_set",
      });
    }
  });
});
