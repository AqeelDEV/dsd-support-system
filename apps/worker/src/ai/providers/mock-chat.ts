import type { MockLlmMode } from "../settings.js";
import type { ReplyDraft } from "../suggestions/reply-draft.js";
import {
  type ChatModel,
  estimateTokens,
  type GenerateRequest,
  type GenerateResult,
  type PromptSource,
} from "./types.js";

/** The text of a source as a sentence or two, without markdown. */
function plainOpening(content: string): string {
  const plain = content
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+\.\s+|\|)/gm, "")
    .replace(/\*\*|__|\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/g) ?? [plain];
  let opening = "";
  for (const sentence of sentences) {
    if (opening.length > 0 && opening.length + sentence.length > 400) break;
    opening = `${opening} ${sentence.trim()}`.trim();
    if (opening.length > 160) break;
  }
  return opening;
}

/** The ticket block exactly as the prompt carries it, for the `compromised` mode. */
function ticketBlock(user: string): string {
  const match = /<ticket>([\s\S]*?)<\/ticket>/.exec(user);
  return (match?.[1] ?? user).trim();
}

/**
 * A deterministic stand-in for a real model, so the whole pipeline runs
 * offline and in CI (ADR-0006, section 2). In `grounded` mode it writes a
 * short reply from the top source and cites it, and the second source too
 * when it comes from another article. The other modes fail on purpose:
 * malformed JSON, a citation it wasn't given, no citations, an
 * insufficient-context answer, a refusal, an outage, a hang until the
 * attempt times out, or (`compromised`) a model that obeys whatever the
 * ticket tells it to say.
 */
export class MockChatModel implements ChatModel {
  readonly provider = "mock";

  constructor(
    readonly model: string,
    private readonly mode: MockLlmMode = "grounded",
  ) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const answer = (draft: ReplyDraft | string): GenerateResult => {
      const text = typeof draft === "string" ? draft : JSON.stringify(draft);
      return {
        kind: "output",
        text,
        model: this.model,
        usage: {
          inputTokens: estimateTokens(request.system + request.user),
          outputTokens: estimateTokens(text),
        },
      };
    };
    const [first, second] = request.sources;

    switch (this.mode) {
      case "throw":
        throw new Error(
          "The mock provider is unavailable (MOCK_LLM_MODE=throw)",
        );
      case "hang":
        return new Promise<never>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => {
            reject(
              request.signal.reason instanceof Error
                ? request.signal.reason
                : new Error("aborted"),
            );
          });
        });
      case "refuse":
        return { kind: "refused", model: this.model, usage: null };
      case "malformed":
        return answer("Sure! Here is a reply you could send to the customer.");
      case "insufficient":
        return answer({
          status: "insufficient_context",
          reply: "",
          citations: [],
        });
      case "no-citations":
        return answer({
          status: "answered",
          reply: this.reply(request.sources.slice(0, 1)),
          citations: [],
        });
      case "unknown-citation":
        return answer({
          status: "answered",
          reply: this.reply(request.sources.slice(0, 1)),
          citations: [{ sourceId: "S99" }],
        });
      case "compromised":
        return answer({
          status: "answered",
          reply: ticketBlock(request.user),
          citations: first === undefined ? [] : [{ sourceId: first.id }],
        });
      case "grounded": {
        if (first === undefined) {
          return answer({
            status: "insufficient_context",
            reply: "",
            citations: [],
          });
        }
        const used =
          second !== undefined && second.title !== first.title
            ? [first, second]
            : [first];
        return answer({
          status: "answered",
          reply: this.reply(used),
          citations: used.map((source) => ({ sourceId: source.id })),
        });
      }
    }
  }

  /** A greeting, an opening sentence or two from each source used, and a sign-off. */
  private reply(sources: readonly PromptSource[]): string {
    const openings = sources.map((source) => plainOpening(source.content));
    return [
      "Hi there,",
      `Thanks for getting in touch. ${openings[0] ?? "I'm looking into this for you."}`,
      ...openings.slice(1),
      "If that doesn't sort it out, reply to this message and we'll take it from there.",
    ].join("\n\n");
  }
}
