import type { AiRejectionReason } from "@dsd/shared";

import type { PromptSource } from "../providers/types.js";
import { linksNotIn } from "./links.js";
import type { ParsedDraft } from "./reply-draft.js";

export type Validation =
  | { status: "ready"; reply: string; citedSourceIds: string[] }
  | { status: "no_grounded_answer" }
  | { status: "rejected"; reason: AiRejectionReason };

/**
 * The checks every answer goes through before anyone sees it (ADR-0006,
 * section 7), in order, the first failure deciding the outcome:
 *
 * 1. it parses and matches the contract, or it is rejected
 *    (`invalid_output`);
 * 2. a model saying the sources don't answer the ticket is believed, and
 *    the ticket gets no grounded suggestion;
 * 3. it cites at least one source (`no_citations`);
 * 4. every cited ID is one the prompt gave it
 *    (`citation_not_in_retrieved_set`): a made-up source is treated as a
 *    made-up answer;
 * 5. every link in the reply (a URL, a domain, an email address) appears in
 *    a source it cites (`link_not_in_sources`): one that doesn't can only
 *    have come from the ticket, where an attacker writes (`links.ts`).
 *
 * Whether the cited articles are still published is checked against the
 * database afterwards (`cited_article_unpublished`).
 */
export function validateDraft(
  parsed: ParsedDraft,
  sources: readonly PromptSource[],
): Validation {
  if (!parsed.ok) return { status: "rejected", reason: "invalid_output" };
  const { draft } = parsed;
  if (draft.status === "insufficient_context") {
    return { status: "no_grounded_answer" };
  }
  if (draft.citations.length === 0) {
    return { status: "rejected", reason: "no_citations" };
  }
  const cited = [
    ...new Set(draft.citations.map((citation) => citation.sourceId)),
  ];
  const given = new Map(sources.map((source) => [source.id, source]));
  if (cited.some((id) => !given.has(id))) {
    return { status: "rejected", reason: "citation_not_in_retrieved_set" };
  }
  const citedText = cited.flatMap((id) => {
    const source = given.get(id);
    return source === undefined
      ? []
      : [source.title, source.headingPath, source.content];
  });
  if (linksNotIn(draft.reply, citedText).length > 0) {
    return { status: "rejected", reason: "link_not_in_sources" };
  }
  return { status: "ready", reply: draft.reply.trim(), citedSourceIds: cited };
}
