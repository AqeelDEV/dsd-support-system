import { EMBEDDING_DIMENSIONS } from "@dsd/db/schema";

import type { EmbeddingDocument, EmbeddingModel } from "./types.js";

/** Words too common to say anything about a topic. */
const STOP_WORDS = new Set(
  (
    "a about above after again against all am an and any are as at be because been before being below " +
    "between both but by can could did do does doing down during each few for from further had has have " +
    "having he her here hers him his how i if in into is it its just me more most my no nor not now of off " +
    "on once only or other our ours out over own same she should so some such than that the their them then " +
    "there these they this those through to too under until up very was we were what when where which while " +
    "who whom why will with would you your yours yourself hi hello thanks thank please"
  ).split(" "),
);

/**
 * A crude, deterministic stemmer: enough that "refunds", "refunded" and
 * "refunding" land on the same feature. It isn't linguistics; it only has
 * to treat a word the same way every time.
 */
function stem(word: string): string {
  let root = word;
  if (root.length > 4 && root.endsWith("ies")) {
    root = `${root.slice(0, -3)}y`;
  } else {
    for (const suffix of ["ing", "ed", "es", "s", "ly"]) {
      if (root.length > suffix.length + 2 && root.endsWith(suffix)) {
        if (suffix === "s" && root.endsWith("ss")) break;
        root = root.slice(0, -suffix.length);
        break;
      }
    }
  }
  return root.length > 3 && root.endsWith("e") ? root.slice(0, -1) : root;
}

/** The stemmed content words of a text, in order. */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map(stem);
}

/** FNV-1a: a fast, well-spread 32-bit hash, the same on every machine. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Feature hashing: each word lands in one of 1,024 dimensions with a sign
 * from another bit of its hash, weighted by how often it appears (log
 * scaled), then the vector is scaled to length 1. Texts that share words
 * point the same way, so cosine similarity behaves like word overlap.
 */
export function hashEmbedding(text: string): number[] {
  const counts = new Map<string, number>();
  for (const term of terms(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [term, count] of counts) {
    const hash = fnv1a(term);
    const sign = (hash >>> 16) & 1 ? 1 : -1;
    vector[hash % EMBEDDING_DIMENSIONS] =
      (vector[hash % EMBEDDING_DIMENSIONS] ?? 0) + sign * (1 + Math.log(count));
  }
  const length = Math.hypot(...vector);
  if (length === 0) {
    // No content words: a fixed unit vector rather than zeros, which
    // pgvector can't compare by cosine.
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / length);
}

/**
 * Offline embeddings for the demo and the tests (ADR-0006, section 2): no
 * network, no key, and the same vector for the same text every time.
 * Documents and queries are embedded the same way.
 */
export class MockEmbeddingModel implements EmbeddingModel {
  readonly provider = "mock";

  constructor(readonly model: string) {}

  embedDocuments(documents: readonly EmbeddingDocument[]): Promise<number[][]> {
    return Promise.resolve(
      documents.map((document) =>
        hashEmbedding(`${document.title}\n${document.text}`),
      ),
    );
  }

  embedQuery(text: string): Promise<number[]> {
    return Promise.resolve(hashEmbedding(text));
  }
}
