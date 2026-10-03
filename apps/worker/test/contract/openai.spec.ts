import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  OpenAiChatModel,
  OpenAiEmbeddingModel,
} from "../../src/ai/providers/openai.js";
import type { GenerateRequest } from "../../src/ai/providers/types.js";
import { REPLY_DRAFT_JSON_SCHEMA } from "../../src/ai/suggestions/reply-draft.js";
import { StubServer, vectorOf } from "../support/stub-server.js";

const KEY = "test-openai-key";

const request = (signal = new AbortController().signal): GenerateRequest => ({
  system: "You draft replies for support agents.",
  user: "<sources>...</sources><ticket>Where is my refund?</ticket>",
  schema: REPLY_DRAFT_JSON_SCHEMA,
  sources: [],
  signal,
});

const ANSWER = JSON.stringify({
  status: "answered",
  reply: "Refunds take 3 to 5 working days.",
  citations: [{ sourceId: "S1" }],
});

const response = (overrides: Record<string, unknown> = {}) => ({
  id: "resp_test",
  object: "response",
  created_at: 1_790_000_000,
  model: "gpt-test-2026-09-01",
  status: "completed",
  incomplete_details: null,
  output: [
    {
      id: "msg_test",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: ANSWER, annotations: [] }],
    },
  ],
  usage: {
    input_tokens: 700,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 90,
    output_tokens_details: { reasoning_tokens: 30 },
    total_tokens: 790,
  },
  ...overrides,
});

/**
 * The OpenAI adapters against a local stand-in for the OpenAI API: what
 * the SDK sends for our settings and how answers, refusals and failures
 * come back. Not run against the live API in this project (no key).
 */
describe("OpenAI adapters", () => {
  let stub: StubServer;
  const options = (model: string, timeoutMs = 5_000) => ({
    apiKey: KEY,
    baseUrl: `${stub.url}/v1`,
    model,
    timeoutMs,
  });

  beforeAll(async () => {
    stub = await StubServer.start();
  });

  beforeEach(() => {
    stub.reset();
  });

  afterAll(async () => {
    await stub.close();
  });

  describe("chat", () => {
    const chat = (effort: "low" | null = null, timeoutMs?: number) =>
      new OpenAiChatModel(options("gpt-test", timeoutMs), effort);

    it("asks for strict JSON in the reply contract's schema, stores nothing at OpenAI, and sends no reasoning effort unless configured", async () => {
      stub.reply(() => ({ body: response() }));
      await chat().generate(request());

      expect(stub.requests).toHaveLength(1);
      const [sent] = stub.requests;
      expect(sent?.path).toBe("/v1/responses");
      expect(sent?.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(sent?.body).toEqual({
        model: "gpt-test",
        instructions: request().system,
        input: request().user,
        text: {
          format: {
            type: "json_schema",
            name: "reply_draft",
            schema: REPLY_DRAFT_JSON_SCHEMA,
            strict: true,
          },
        },
        max_output_tokens: 8_192,
        store: false,
      });
    });

    it("sends the reasoning effort when one is configured", async () => {
      stub.reply(() => ({ body: response() }));
      await chat("low").generate(request());
      expect(stub.requests[0]?.body).toMatchObject({
        reasoning: { effort: "low" },
      });
    });

    it("returns the output text, the model and the tokens", async () => {
      stub.reply(() => ({ body: response() }));
      expect(await chat().generate(request())).toEqual({
        kind: "output",
        text: ANSWER,
        model: "gpt-test-2026-09-01",
        usage: { inputTokens: 700, outputTokens: 90 },
      });
    });

    it.each([
      [
        "a refusal",
        {
          output: [
            {
              id: "msg_test",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                { type: "refusal", refusal: "I can't help with that." },
              ],
            },
          ],
        },
      ],
      [
        "a content filter stop",
        {
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
          output: [],
        },
      ],
    ])("reports %s as a refusal, not an error", async (_case, overrides) => {
      stub.reply(() => ({ body: response(overrides) }));
      const result = await chat().generate(request());
      expect(result.kind).toBe("refused");
    });

    it.each([429, 500, 503])(
      "fails on HTTP %i after one request, leaving retries to the queue",
      async (status) => {
        stub.reply(() => ({
          status,
          body: { error: { message: "try later", type: "server_error" } },
        }));
        await expect(chat().generate(request())).rejects.toThrow();
        expect(stub.requests).toHaveLength(1);
      },
    );

    it("gives up when the server doesn't answer in time", async () => {
      stub.reply(() => ({ hang: true }));
      const started = Date.now();
      await expect(chat(null, 300).generate(request())).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(stub.requests).toHaveLength(1);
    });
  });

  describe("embeddings", () => {
    const embeddings = () =>
      new OpenAiEmbeddingModel(options("text-embedding-3-small"));

    const vectors = (count: number, length = 1_024) => ({
      object: "list",
      model: "text-embedding-3-small",
      // Out of order on purpose: the adapter orders them by index.
      data: Array.from({ length: count }, (_, index) => ({
        object: "embedding",
        index: count - 1 - index,
        embedding: vectorOf(count - 1 - index, length),
      })),
      usage: { prompt_tokens: 12, total_tokens: 12 },
    });

    it("asks for 1,024-dimension floats and returns them in input order", async () => {
      stub.reply(() => ({ body: vectors(2) }));
      expect(
        await embeddings().embedDocuments([
          { title: "Refunds", text: "Refunds > Timing\n\nThree to five days." },
          { title: "Pairing", text: "Pairing > Steps\n\nHold the button." },
        ]),
      ).toEqual([vectorOf(0), vectorOf(1)]);
      const [sent] = stub.requests;
      expect(sent?.path).toBe("/v1/embeddings");
      expect(sent?.body).toEqual({
        model: "text-embedding-3-small",
        input: [
          "Refunds > Timing\n\nThree to five days.",
          "Pairing > Steps\n\nHold the button.",
        ],
        dimensions: 1_024,
        encoding_format: "float",
      });
    });

    it("embeds a query as it is", async () => {
      stub.reply(() => ({ body: vectors(1) }));
      expect(await embeddings().embedQuery("Where is my refund?")).toEqual(
        vectorOf(0),
      );
      expect(stub.requests[0]?.body).toMatchObject({
        input: ["Where is my refund?"],
      });
    });

    it("refuses vectors of another dimension", async () => {
      stub.reply(() => ({ body: vectors(1, 1_536) }));
      await expect(embeddings().embedQuery("refund")).rejects.toThrow(
        /1536 dimensions; the index holds 1024/,
      );
    });
  });
});
