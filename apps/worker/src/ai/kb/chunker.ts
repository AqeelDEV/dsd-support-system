import { estimateTokens } from "../providers/types.js";

/*
 * Splits an article into retrieval units (ADR-0006, section 3): first at
 * its headings, then, where a section is long, into windows of about 400
 * tokens that overlap by about 50, so a sentence cut at a boundary is still
 * whole in one of them. Each chunk carries its heading path, so it makes
 * sense on its own in a prompt or a citation.
 *
 * Token counts are estimates (about four characters per token): close
 * enough to size chunks, with no tokenizer to depend on. The output depends
 * only on the input, so an article version always gives the same chunks.
 */

export const CHUNK_TOKENS = 400;
export const OVERLAP_TOKENS = 50;

export interface Chunk {
  index: number;
  /** For example "How long refunds take > When you see the money". */
  headingPath: string;
  /** The section's markdown, or one window of it. */
  content: string;
  tokenCount: number;
}

interface Section {
  path: string;
  text: string;
}

/** Non-empty sections in reading order, each with the headings above it. */
function sections(title: string, markdown: string): Section[] {
  const found: { path: string; lines: string[] }[] = [
    { path: title, lines: [] },
  ];
  const headings: { level: number; text: string }[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading === null) {
      found.at(-1)?.lines.push(line);
      continue;
    }
    const level = heading[1]?.length ?? 1;
    while ((headings.at(-1)?.level ?? 0) >= level) headings.pop();
    headings.push({ level, text: heading[2] ?? "" });
    found.push({
      path: [title, ...headings.map((item) => item.text)].join(" > "),
      lines: [],
    });
  }
  return found
    .map((section) => ({
      path: section.path,
      text: section.lines.join("\n").trim(),
    }))
    .filter((section) => section.text !== "");
}

/** Windows of about `CHUNK_TOKENS`, overlapping by about `OVERLAP_TOKENS`, cut between words. */
function windows(text: string): string[] {
  if (estimateTokens(text) <= CHUNK_TOKENS) return [text];
  const words = text.split(/(?<=\s)/);
  const limit = CHUNK_TOKENS * 4;
  const overlap = OVERLAP_TOKENS * 4;
  const result: string[] = [];
  let start = 0;
  while (start < words.length) {
    let end = start;
    let length = 0;
    while (
      end < words.length &&
      (end === start || length + (words[end]?.length ?? 0) <= limit)
    ) {
      length += words[end]?.length ?? 0;
      end += 1;
    }
    result.push(words.slice(start, end).join("").trim());
    if (end >= words.length) break;
    // Step back far enough that the next window repeats about `overlap`
    // characters, but always move forward.
    let back = end;
    let repeated = 0;
    while (back > start + 1 && repeated < overlap) {
      back -= 1;
      repeated += words[back]?.length ?? 0;
    }
    start = back;
  }
  return result;
}

export function chunkArticle(article: {
  title: string;
  bodyMarkdown: string;
}): Chunk[] {
  const title = article.title.trim();
  const chunks: Chunk[] = [];
  for (const section of sections(title, article.bodyMarkdown)) {
    for (const content of windows(section.text)) {
      chunks.push({
        index: chunks.length,
        headingPath: section.path,
        content,
        tokenCount: estimateTokens(content),
      });
    }
  }
  // An article of headings alone still gets one chunk, so every published
  // version is indexed and the reconcile never sees it as missing.
  return chunks.length > 0
    ? chunks
    : [
        {
          index: 0,
          headingPath: title,
          content: title,
          tokenCount: estimateTokens(title),
        },
      ];
}
