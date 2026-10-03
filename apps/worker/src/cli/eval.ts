import { writeFileSync } from "node:fs";

import { createDb } from "@dsd/db";
import { asOwner, createSeededDatabase } from "@dsd/db/testing";

import { EVAL_CASES, type EvalCase, HELD_OUT_CASES } from "../ai/eval/cases.js";
import {
  evaluate,
  report,
  summarise,
  sweep,
  sweepReport,
} from "../ai/eval/evaluate.js";
import { KnowledgeIndexer } from "../ai/kb/indexer.js";
import { KnowledgeIndexRepository } from "../ai/kb/knowledge-index.repository.js";
import { createModels } from "../ai/providers/index.js";
import { aiSettings } from "../ai/settings.js";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../logger.js";

/*
 * The evaluation (ADR-0006, section 10; docs/EVALUATION.md):
 *
 *   pnpm --filter @dsd/worker build
 *   pnpm --filter @dsd/worker eval [--set tuning|held-out] [--sweep] [--out <file.md>]
 *
 * It seeds a throwaway database on the development PostgreSQL (the same
 * harness as the tests), indexes the seeded knowledge base with the
 * configured embedding model, runs every case through the real pipeline
 * and prints the report. The provider comes from LLM_PROVIDER and
 * EMBEDDINGS_PROVIDER, as for the worker (the mock unless set). Nothing is
 * stored, and the database is dropped at the end.
 *
 * It runs the tuning set and the held-out set and reports them apart;
 * `--set` runs one. The sweep only ever runs the tuning set: thresholds
 * are chosen there, and the held-out set stays unseen by that choice.
 */

/**
 * The evaluation reads only the AI settings. The worker's other required
 * settings (mail, the object store and so on) get values that are never
 * used, unless the environment has real ones.
 */
const UNUSED = {
  DATABASE_URL: "postgres://unused@127.0.0.1/unused",
  REDIS_URL: "redis://127.0.0.1",
  SMTP_HOST: "unused.invalid",
  CUSTOMER_APP_URL: "http://unused.invalid",
  AGENT_APP_URL: "http://unused.invalid",
  S3_ENDPOINT: "http://unused.invalid",
  S3_ACCESS_KEY_ID: "unused",
  S3_SECRET_ACCESS_KEY: "unused",
};

/** Vector thresholds the sweep tries. */
const CANDIDATES = Array.from({ length: 13 }, (_, index) => 0.2 + index * 0.05);

/**
 * Runs `work`, and with a real provider retries it after a minute when it
 * fails: free tiers count embedding inputs per minute, and indexing the
 * whole knowledge base at once goes over. The worker's queue does the
 * same with its backoff.
 */
async function patiently<T>(
  work: () => Promise<T>,
  retry: boolean,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!retry || attempt >= 5) throw error;
      process.stdout.write("Provider limit reached; waiting a minute\n");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  }
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const SETS: Record<string, { title: string; cases: readonly EvalCase[] }> = {
  tuning: { title: "Tuning set", cases: EVAL_CASES },
  "held-out": { title: "Held-out set", cases: HELD_OUT_CASES },
};

function chosenSets(): (typeof SETS)[string][] {
  const name = option("--set");
  if (name === undefined) return Object.values(SETS);
  const set = SETS[name];
  if (set === undefined) {
    throw new Error(`--set must be one of ${Object.keys(SETS).join(", ")}`);
  }
  return [set];
}

async function main(): Promise<void> {
  const env = parseEnv({ ...UNUSED, ...process.env, LOG_LEVEL: "warn" });
  const settings = aiSettings(env);
  const models = createModels(env);
  const logger = createLogger(env);
  // A real provider's free tier allows a few requests a minute; the mock
  // needs no pause.
  const pauseMs = settings.chat.provider === "mock" ? 0 : 4_000;
  const label = `${settings.chat.provider}/${settings.chat.model}, embeddings ${settings.embeddings === null ? "none (keywords only)" : `${settings.embeddings.provider}/${settings.embeddings.model}`}`;
  process.stdout.write(`Evaluating with ${label}\n`);

  const database = await createSeededDatabase(
    `dsd_eval_${String(process.pid)}`,
  );
  try {
    const db = createDb(database.pool("dsd_worker"));
    const knowledge = new KnowledgeIndexRepository(db);
    const indexer = new KnowledgeIndexer(knowledge, models.embeddings, logger);
    const articles = await knowledge.outOfDate(
      models.embeddings?.model ?? null,
    );
    for (const article of articles) {
      await patiently(() => indexer.index(article.id), pauseMs > 0);
    }
    process.stdout.write(`Indexed ${String(articles.length)} articles\n`);
    const [brand] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM brands WHERE slug = 'dsd'",
    );
    const brandId = brand?.id ?? "";

    let output: string;
    if (process.argv.includes("--sweep")) {
      const { rows, signals } = await sweep(
        EVAL_CASES,
        { db, models, thresholds: settings.thresholds, brandId },
        CANDIDATES,
      );
      output = [
        sweepReport(`Confidence gate sweep: ${label}`, rows),
        "| Case | Kind | Top vector | Top keyword | Terms |",
        "| --- | --- | --- | --- | --- |",
        ...signals.map(
          (s) =>
            `| ${s.id} | ${s.kind} | ${s.topVectorScore?.toFixed(3) ?? ""} | ${s.topKeywordScore?.toFixed(3) ?? ""} | ${s.topMatchedTerms === null ? "" : String(s.topMatchedTerms)} |`,
        ),
        "",
      ].join("\n");
    } else {
      const thresholds = `thresholds: vector ${settings.thresholds.minVectorSimilarity.toFixed(2)}, keyword ${settings.thresholds.minKeywordRank.toFixed(2)} with ${String(settings.thresholds.minMatchedTerms)} terms`;
      const sections: string[] = [];
      for (const set of chosenSets()) {
        process.stdout.write(`${set.title}\n`);
        const results = await evaluate(set.cases, {
          db,
          models,
          thresholds: settings.thresholds,
          timeoutMs: settings.chat.timeoutMs,
          brandId,
          pauseMs,
          retries: settings.chat.provider === "mock" ? 0 : 3,
          onCase: (result, index) => {
            process.stdout.write(
              `${String(index + 1).padStart(2)}/${String(set.cases.length)} ${result.id}: ${result.status}\n`,
            );
          },
        });
        sections.push(
          report(
            `${set.title} (${String(set.cases.length)} cases): ${label} (${thresholds})`,
            results,
            summarise(results),
          ),
        );
      }
      output = sections.join("\n");
    }
    process.stdout.write(`\n${output}\n`);
    const out = option("--out");
    if (out !== undefined) writeFileSync(out, output);
  } finally {
    await database.drop();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Evaluation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
