import type { Database } from "@dsd/db";
import { kbArticles } from "@dsd/db/schema";

import type { AiModels } from "../providers/types.js";
import { isGrounded, type Thresholds } from "../retrieval/confidence.js";
import { retrievalQuery } from "../retrieval/query.js";
import { type Retrieval, Retriever } from "../retrieval/retriever.js";
import {
  type DraftOutcome,
  SuggestionDrafter,
} from "../suggestions/drafter.js";
import { SuggestionsRepository } from "../suggestions/suggestions.repository.js";
import type { TicketContext } from "../suggestions/ticket-context.js";
import type { EvalCase } from "./cases.js";

/*
 * Runs the evaluation set through the real pipeline (ADR-0006, section 10):
 * the same retrieval, confidence gate, prompt, model call and validation a
 * ticket gets, against an indexed knowledge base, with nothing stored.
 */

export interface CaseResult {
  id: string;
  kind: EvalCase["kind"];
  /** Articles in the order retrieval ranked them, each once. */
  retrieved: string[];
  /** Retrieved articles that aren't published: always none, or retrieval is broken. */
  unpublishedRetrieved: string[];
  hitAt1: boolean;
  hitAtK: boolean;
  gatePassed: boolean;
  status: DraftOutcome["status"];
  rejectionReason: string | null;
  /** Articles the draft cites. */
  cited: string[];
  /** Every citation pointed at a source the model was given. */
  citationsValid: boolean | null;
  /** Share of cited articles that are expected ones; null without citations. */
  citationPrecision: number | null;
  /** For adversarial cases: forbidden text found in the draft. */
  forbiddenFound: string[];
  topVectorScore: number | null;
  topKeywordScore: number | null;
  topMatchedTerms: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** How many of how many: the counts behind a percentage. */
export interface Count {
  count: number;
  total: number;
}

export interface Summary {
  cases: number;
  /** The counts behind each ratio below, so a report can show both. */
  counts: {
    hitAt1: Count;
    hitAtK: Count;
    answered: Count;
    citationValidity: Count;
    abstention: Count;
    adversarialSafe: Count;
    /** Ready drafts with citations, which the precision is averaged over. */
    precisionDrafts: number;
  };
  /** Answerable and adversarial cases whose expected article ranked first. */
  hitAt1: number;
  /** ... or anywhere in the retrieved set. */
  hitAtK: number;
  /** Answerable cases that got a ready draft. */
  answered: number;
  /** Of answers the model gave, those whose citations were all in the retrieved set. */
  citationValidity: number | null;
  /** Mean share of cited articles that were expected ones, over ready drafts. */
  citationPrecision: number | null;
  /** Unanswerable cases that got "no grounded suggestion". */
  abstention: number;
  /** Adversarial cases whose draft contains none of the forbidden text. */
  adversarialSafe: number;
  /** Cases that retrieved a draft or archived article: must be 0. */
  unpublishedRetrieved: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface EvalSetup {
  db: Database;
  models: AiModels;
  thresholds: Thresholds;
  timeoutMs: number;
  brandId: string;
  /** Called after each case, for progress output. */
  onCase?: (result: CaseResult, index: number) => void;
  /** Pause between cases, to stay inside a provider's free-tier rate limits. */
  pauseMs?: number;
  /** Retries a case whose model call failed (a 429, say), with a growing wait. */
  retries?: number;
}

/** How many chunks retrieval returns; a hit anywhere in them counts. */
export const K = 6;

const ratio = (count: number, total: number): number | null =>
  total === 0 ? null : count / total;

const countOf = <T>(
  items: readonly T[],
  test: (item: T) => boolean,
): Count => ({
  count: items.filter(test).length,
  total: items.length,
});

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function contextOf(testCase: EvalCase, brandId: string): TicketContext {
  return {
    ticketId: testCase.id,
    brandId,
    status: "open",
    subject: testCase.subject,
    description: testCase.description,
    customerName: "Alex Example",
    conversation: [],
  };
}

interface Articles {
  slugs: Map<string, string>;
  unpublished: Set<string>;
}

async function articlesIn(db: Database): Promise<Articles> {
  const rows = await db
    .select({
      id: kbArticles.id,
      slug: kbArticles.slug,
      status: kbArticles.status,
    })
    .from(kbArticles);
  return {
    slugs: new Map(rows.map((row) => [row.id, row.slug])),
    unpublished: new Set(
      rows.filter((row) => row.status !== "published").map((row) => row.slug),
    ),
  };
}

/** Articles in retrieval order, each once. */
function articlesOf(
  retrieval: Retrieval,
  slugs: Map<string, string>,
): string[] {
  const seen: string[] = [];
  for (const chunk of retrieval.chunks) {
    const slug = slugs.get(chunk.articleId) ?? chunk.articleId;
    if (!seen.includes(slug)) seen.push(slug);
  }
  return seen;
}

function resultOf(
  testCase: EvalCase,
  outcome: DraftOutcome,
  { slugs, unpublished }: Articles,
  thresholds: Thresholds,
): CaseResult {
  const retrieved = articlesOf(outcome.retrieval, slugs);
  const chunkArticle = new Map(
    outcome.retrieval.chunks.map((chunk) => [
      chunk.chunkId,
      slugs.get(chunk.articleId) ?? chunk.articleId,
    ]),
  );
  const cited = [
    ...new Set(outcome.citedChunkIds.map((id) => chunkArticle.get(id) ?? id)),
  ];
  const citationProblem =
    outcome.rejectionReason === "citation_not_in_retrieved_set" ||
    outcome.rejectionReason === "no_citations";
  const draft = (outcome.draft ?? "").toLowerCase();
  return {
    id: testCase.id,
    kind: testCase.kind,
    retrieved,
    unpublishedRetrieved: retrieved.filter((slug) => unpublished.has(slug)),
    hitAt1:
      retrieved[0] !== undefined && testCase.expected.includes(retrieved[0]),
    hitAtK: retrieved.some((slug) => testCase.expected.includes(slug)),
    gatePassed:
      outcome.retrieval.chunks.length > 0 &&
      isGrounded(outcome.retrieval, thresholds),
    status: outcome.status,
    rejectionReason: outcome.rejectionReason,
    cited,
    citationsValid: outcome.modelCalled
      ? outcome.rejectionReason !== "model_refused" && !citationProblem
      : null,
    citationPrecision:
      outcome.status === "ready" && cited.length > 0
        ? cited.filter((slug) => testCase.expected.includes(slug)).length /
          cited.length
        : null,
    forbiddenFound: (testCase.forbidden ?? []).filter((text) =>
      draft.includes(text.toLowerCase()),
    ),
    topVectorScore: outcome.retrieval.topVectorScore,
    topKeywordScore: outcome.retrieval.topKeywordScore,
    topMatchedTerms: outcome.retrieval.topMatchedTerms,
    latencyMs: outcome.latencyMs,
    inputTokens: outcome.usage?.inputTokens ?? null,
    outputTokens: outcome.usage?.outputTokens ?? null,
  };
}

/** Every case through the pipeline, one after another. */
export async function evaluate(
  cases: readonly EvalCase[],
  setup: EvalSetup,
): Promise<CaseResult[]> {
  const articles = await articlesIn(setup.db);
  const suggestions = new SuggestionsRepository(setup.db);
  const drafter = new SuggestionDrafter(
    new Retriever(setup.db, setup.models.embeddings),
    setup.models.chat,
    setup.thresholds,
    setup.timeoutMs,
    (chunkIds) => suggestions.stillPublished(chunkIds),
  );
  const results: CaseResult[] = [];
  for (const [index, testCase] of cases.entries()) {
    let outcome: DraftOutcome | undefined;
    for (let attempt = 0; outcome === undefined; attempt += 1) {
      try {
        outcome = await drafter.draft(contextOf(testCase, setup.brandId));
      } catch (error) {
        if (attempt >= (setup.retries ?? 0)) throw error;
        await sleep(5_000 * 2 ** attempt);
      }
    }
    const result = resultOf(testCase, outcome, articles, setup.thresholds);
    results.push(result);
    setup.onCase?.(result, index);
    if (setup.pauseMs !== undefined && index < cases.length - 1) {
      await sleep(setup.pauseMs);
    }
  }
  return results;
}

export function summarise(results: readonly CaseResult[]): Summary {
  const grounded = results.filter((result) => result.kind !== "unanswerable");
  const answerable = results.filter((result) => result.kind === "answerable");
  const unanswerable = results.filter(
    (result) => result.kind === "unanswerable",
  );
  const adversarial = results.filter((result) => result.kind === "adversarial");
  const called = results.filter((result) => result.citationsValid !== null);
  const precisions = results.flatMap((result) =>
    result.citationPrecision === null ? [] : [result.citationPrecision],
  );
  const latencies = results.flatMap((result) =>
    result.latencyMs === null ? [] : [result.latencyMs],
  );
  const counts = {
    hitAt1: countOf(grounded, (r) => r.hitAt1),
    hitAtK: countOf(grounded, (r) => r.hitAtK),
    answered: countOf(answerable, (r) => r.status === "ready"),
    citationValidity: countOf(called, (r) => r.citationsValid === true),
    abstention: countOf(unanswerable, (r) => r.status === "no_grounded_answer"),
    adversarialSafe: countOf(adversarial, (r) => r.forbiddenFound.length === 0),
    precisionDrafts: precisions.length,
  };
  return {
    cases: results.length,
    counts,
    hitAt1:
      ratio(grounded.filter((r) => r.hitAt1).length, grounded.length) ?? 0,
    hitAtK:
      ratio(grounded.filter((r) => r.hitAtK).length, grounded.length) ?? 0,
    answered:
      ratio(
        answerable.filter((r) => r.status === "ready").length,
        answerable.length,
      ) ?? 0,
    citationValidity: ratio(
      called.filter((r) => r.citationsValid === true).length,
      called.length,
    ),
    citationPrecision:
      precisions.length === 0
        ? null
        : precisions.reduce((sum, value) => sum + value, 0) / precisions.length,
    abstention:
      ratio(
        unanswerable.filter((r) => r.status === "no_grounded_answer").length,
        unanswerable.length,
      ) ?? 0,
    adversarialSafe:
      ratio(
        adversarial.filter((r) => r.forbiddenFound.length === 0).length,
        adversarial.length,
      ) ?? 0,
    unpublishedRetrieved: results.filter(
      (r) => r.unpublishedRetrieved.length > 0,
    ).length,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    inputTokens: results.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0),
  };
}

/** One case's raw retrieval signals, which the gate decides on. */
export interface CaseSignals {
  id: string;
  kind: EvalCase["kind"];
  topVectorScore: number | null;
  topKeywordScore: number | null;
  topMatchedTerms: number | null;
}

export interface SweepRow {
  minVectorSimilarity: number;
  /** Answerable and adversarial cases that would reach the model. */
  passed: number;
  /** Unanswerable cases the gate would stop before the model. */
  abstained: number;
  passedCount: Count;
  abstainedCount: Count;
}

/**
 * The confidence gate at each candidate vector threshold, from one
 * retrieval per case: the gate runs before any model call, so the sweep
 * costs only embeddings. The keyword bars stay as configured.
 */
export async function sweep(
  cases: readonly EvalCase[],
  setup: Pick<
    EvalSetup,
    "db" | "models" | "thresholds" | "brandId" | "pauseMs"
  >,
  candidates: readonly number[],
): Promise<{ rows: SweepRow[]; signals: CaseSignals[] }> {
  const retriever = new Retriever(setup.db, setup.models.embeddings);
  const signals: (CaseSignals & { retrieval: Retrieval })[] = [];
  for (const [index, testCase] of cases.entries()) {
    const retrieval = await retriever.retrieve(
      setup.brandId,
      retrievalQuery({
        subject: testCase.subject,
        description: testCase.description,
        customerMessages: [],
      }),
    );
    signals.push({
      id: testCase.id,
      kind: testCase.kind,
      retrieval,
      topVectorScore: retrieval.topVectorScore,
      topKeywordScore: retrieval.topKeywordScore,
      topMatchedTerms: retrieval.topMatchedTerms,
    });
    if (setup.pauseMs !== undefined && index < cases.length - 1) {
      await sleep(setup.pauseMs);
    }
  }
  const grounded = signals.filter((s) => s.kind !== "unanswerable");
  const unanswerable = signals.filter((s) => s.kind === "unanswerable");
  const rows = candidates.map((minVectorSimilarity) => {
    const thresholds = { ...setup.thresholds, minVectorSimilarity };
    const passes = (s: (typeof signals)[number]) =>
      s.retrieval.chunks.length > 0 && isGrounded(s.retrieval, thresholds);
    const passedCount = countOf(grounded, passes);
    const abstainedCount = countOf(unanswerable, (s) => !passes(s));
    return {
      minVectorSimilarity,
      passed: ratio(passedCount.count, passedCount.total) ?? 0,
      abstained: ratio(abstainedCount.count, abstainedCount.total) ?? 0,
      passedCount,
      abstainedCount,
    };
  });
  return {
    rows,
    signals: signals.map(({ retrieval: _retrieval, ...rest }) => rest),
  };
}

const pct = (value: number | null) =>
  value === null ? "n/a" : `${(value * 100).toFixed(0)}%`;
/** "19/20 (95%)": the count, then the percentage it makes. */
const fraction = ({ count, total }: Count) =>
  `${String(count)}/${String(total)} (${pct(ratio(count, total))})`;
const num = (value: number | null, digits = 2) =>
  value === null ? "" : value.toFixed(digits);

/** The report as Markdown, for docs/EVALUATION.md. */
export function report(
  title: string,
  results: readonly CaseResult[],
  summary: Summary,
): string {
  const lines = [
    `### ${title}`,
    "",
    "| Metric | Result |",
    "| --- | --- |",
    `| Retrieval hit@1 (answerable and adversarial) | ${fraction(summary.counts.hitAt1)} |`,
    `| Retrieval hit@${String(K)} | ${fraction(summary.counts.hitAtK)} |`,
    `| Answerable cases with a ready draft | ${fraction(summary.counts.answered)} |`,
    `| Citation validity (answers citing only retrieved sources) | ${fraction(summary.counts.citationValidity)} |`,
    `| Citation precision (cited articles that were expected) | ${pct(summary.citationPrecision)}, averaged over ${String(summary.counts.precisionDrafts)} drafts |`,
    `| Abstention on unanswerable cases | ${fraction(summary.counts.abstention)} |`,
    `| Adversarial cases with no forbidden text in the draft | ${fraction(summary.counts.adversarialSafe)} |`,
    `| Cases that retrieved a draft or archived article | ${String(summary.unpublishedRetrieved)} |`,
    `| Model latency p50 / p95 | ${summary.latencyP50Ms === null ? "n/a" : `${String(summary.latencyP50Ms)} ms / ${String(summary.latencyP95Ms)} ms`} |`,
    `| Tokens in / out (all cases) | ${String(summary.inputTokens)} / ${String(summary.outputTokens)} |`,
    "",
    "| Case | Kind | Top article | Hit@1 | Hit@6 | Outcome | Cited | Vector | Keyword | Terms |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.kind} | ${r.retrieved[0] ?? ""} | ${r.hitAt1 ? "yes" : "no"} | ${r.hitAtK ? "yes" : "no"} | ${r.status}${r.rejectionReason === null ? "" : ` (${r.rejectionReason})`}${r.forbiddenFound.length > 0 ? ` **forbidden: ${r.forbiddenFound.join(", ")}**` : ""} | ${r.cited.join(", ")} | ${num(r.topVectorScore)} | ${num(r.topKeywordScore)} | ${r.topMatchedTerms === null ? "" : String(r.topMatchedTerms)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

/** The sweep as Markdown. */
export function sweepReport(title: string, rows: readonly SweepRow[]): string {
  return [
    `### ${title}`,
    "",
    "| Min vector similarity | Grounded cases reaching the model | Unanswerable cases stopped |",
    "| --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.minVectorSimilarity.toFixed(2)} | ${fraction(row.passedCount)} | ${fraction(row.abstainedCount)} |`,
    ),
    "",
  ].join("\n");
}
