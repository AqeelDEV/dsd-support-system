import { describe, expect, it } from "vitest";

import { type CaseResult, report, summarise, sweepReport } from "./evaluate.js";

const result = (overrides: Partial<CaseResult>): CaseResult => ({
  id: "case",
  kind: "answerable",
  retrieved: ["refund-timescales"],
  unpublishedRetrieved: [],
  hitAt1: true,
  hitAtK: true,
  gatePassed: true,
  status: "ready",
  rejectionReason: null,
  cited: ["refund-timescales"],
  citationsValid: true,
  citationPrecision: 1,
  forbiddenFound: [],
  topVectorScore: 0.8,
  topKeywordScore: 0.8,
  topMatchedTerms: 5,
  latencyMs: 1000,
  inputTokens: 900,
  outputTokens: 120,
  ...overrides,
});

const RESULTS = [
  result({ id: "a" }),
  result({ id: "b", hitAt1: false }),
  result({
    id: "c",
    hitAt1: false,
    hitAtK: false,
    status: "no_grounded_answer",
    citationsValid: false,
    citationPrecision: null,
  }),
  result({
    id: "d",
    kind: "unanswerable",
    status: "no_grounded_answer",
    hitAt1: false,
    hitAtK: false,
    citationsValid: null,
    citationPrecision: null,
    latencyMs: null,
  }),
  result({ id: "e", kind: "unanswerable", status: "ready" }),
  result({ id: "f", kind: "adversarial", forbiddenFound: ["approved"] }),
];

describe("summarise", () => {
  it("keeps the count behind every ratio", () => {
    const summary = summarise(RESULTS);
    expect(summary.counts).toEqual({
      hitAt1: { count: 2, total: 4 },
      hitAtK: { count: 3, total: 4 },
      answered: { count: 2, total: 3 },
      citationValidity: { count: 4, total: 5 },
      abstention: { count: 1, total: 2 },
      adversarialSafe: { count: 0, total: 1 },
      precisionDrafts: 4,
    });
    expect(summary.hitAt1).toBe(0.5);
    expect(summary.answered).toBeCloseTo(2 / 3);
  });
});

describe("report", () => {
  it("shows each metric as a count and a percentage", () => {
    const text = report("Mock", RESULTS, summarise(RESULTS));
    expect(text).toContain(
      "| Retrieval hit@1 (answerable and adversarial) | 2/4 (50%) |",
    );
    expect(text).toContain(
      "| Answerable cases with a ready draft | 2/3 (67%) |",
    );
    expect(text).toContain("| Abstention on unanswerable cases | 1/2 (50%) |");
    expect(text).toContain("averaged over 4 drafts");
  });

  it("says n/a rather than dividing by nothing", () => {
    const text = report("Empty", [], summarise([]));
    expect(text).toContain("0/0 (n/a)");
  });
});

describe("sweepReport", () => {
  it("shows the gate's counts at each threshold", () => {
    const text = sweepReport("Sweep", [
      {
        minVectorSimilarity: 0.7,
        passed: 1,
        abstained: 0.75,
        passedCount: { count: 20, total: 20 },
        abstainedCount: { count: 3, total: 4 },
      },
    ]);
    expect(text).toContain("| 0.70 | 20/20 (100%) | 3/4 (75%) |");
  });
});
