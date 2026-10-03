import { describe, expect, it } from "vitest";

import type { PromptSource } from "../providers/types.js";
import { linksIn } from "./links.js";
import { parseReplyDraft } from "./reply-draft.js";
import { validateDraft } from "./validate.js";

const source = (id: string, content: string): PromptSource => ({
  id,
  title: `Article ${id}`,
  headingPath: `Article ${id}`,
  content,
});

const GIVEN = [
  source("S1", "Refunds take 3 to 5 working days to reach your card."),
  source(
    "S2",
    "Track a parcel at https://track.dsd.example/parcels or email help@dsd.example.",
  ),
  source("S3", "Restart the hub from the app's settings."),
];

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

describe("the link check", () => {
  const answer = (reply: string, citations: string[]) =>
    check({
      status: "answered",
      reply,
      citations: citations.map((sourceId) => ({ sourceId })),
    });

  it("passes a link that a cited source contains, whatever its case or the sentence's punctuation", () => {
    expect(
      answer(
        "You can follow it at HTTPS://track.dsd.example/parcels. Or write to Help@dsd.example!",
        ["S2"],
      ),
    ).toMatchObject({ status: "ready" });
  });

  it("refuses a link that only an uncited source contains", () => {
    expect(
      answer("Track it at https://track.dsd.example/parcels.", ["S1"]),
    ).toEqual({ status: "rejected", reason: "link_not_in_sources" });
  });

  it.each([
    [
      "a web address",
      "Reset your password at https://dsd-reset.example.net/login now.",
    ],
    ["a www host", "Log in at www.dsd-account-check.com to confirm."],
    ["a bare domain", "Visit dsd-refunds.support to claim it."],
    [
      "an email address",
      "Send your card number to refunds@dsd-billing.co for a refund.",
    ],
    ["a script link", "Click javascript:alert(document.cookie) to continue."],
    [
      "a longer address than the source's",
      "Track it at https://track.dsd.example/parcels?next=https://evil.example",
    ],
  ])("refuses %s that no cited source contains", (_, reply) => {
    expect(answer(reply, ["S1", "S2"])).toEqual({
      status: "rejected",
      reason: "link_not_in_sources",
    });
  });

  it("leaves ordinary sentences alone", () => {
    expect(
      answer(
        "Refunds take 3 to 5 working days, e.g. by Friday. Your data: safe. See /help/refund-timescales.",
        ["S1"],
      ),
    ).toMatchObject({ status: "ready" });
  });
});

describe("linksIn", () => {
  it("finds every kind of link once, lower-cased and without trailing punctuation", () => {
    expect(
      linksIn(
        "Go to https://A.example/x, then www.b.com; mail c@d.org. Or e.net? data:text/html,hi",
      ).sort(),
    ).toEqual(
      [
        "https://a.example/x",
        "a.example",
        "www.b.com",
        "c@d.org",
        "d.org",
        "e.net",
        "data:text/html,hi",
      ].sort(),
    );
  });

  it("ignores abbreviations, file names, versions and relative paths", () => {
    expect(
      linksIn(
        "e.g. i.e. invoice.pdf firmware v2.4.1 Node.js /help/charged-twice 3.5 days",
      ),
    ).toEqual([]);
  });
});
