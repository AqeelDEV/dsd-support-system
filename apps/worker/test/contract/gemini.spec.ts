import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  GeminiChatModel,
  GeminiEmbeddingModel,
} from "../../src/ai/providers/gemini.js";
import type { GenerateRequest } from "../../src/ai/providers/types.js";
import { REPLY_DRAFT_JSON_SCHEMA } from "../../src/ai/suggestions/reply-draft.js";
import { StubServer, vectorOf } from "../support/stub-server.js";

const KEY = "test-gemini-key";

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

const answered = {
  candidates: [
    {
      content: { role: "model", parts: [{ text: ANSWER }] },
      finishReason: "STOP",
    },
  ],
  usageMetadata: {
    promptTokenCount: 812,
    candidatesTokenCount: 40,
    thoughtsTokenCount: 25,
    totalTokenCount: 877,
  },
  modelVersion: "gemini-3.5-flash-lite-001",
};

/**
 * The Gemini adapters against a local stand-in for the Gemini API: what
 * the SDK sends for our settings, and how each kind of answer, refusal and
 * failure comes back. A live run is recorded separately (EVALUATION.md).
 */
describe("Gemini adapters", () => {
  let stub: StubServer;
  const options = (overrides: { timeoutMs?: number } = {}) => ({
    apiKey: KEY,
    baseUrl: stub.url,
    timeoutMs: overrides.timeoutMs ?? 5_000,
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
    const chat = (effort: "low" | "high" | null = "low", timeoutMs?: number) =>
      new GeminiChatModel(
        { ...options({ timeoutMs }), model: "gemini-3.5-flash-lite" },
        effort,
      );

    it("asks for JSON in the reply contract's schema, with the instructions apart and the thinking level set", async () => {
      stub.reply(() => ({ body: answered }));
      await chat().generate(request());

      expect(stub.requests).toHaveLength(1);
      const [sent] = stub.requests;
      expect(sent?.method).toBe("POST");
      expect(sent?.path).toBe(
        "/v1beta/models/gemini-3.5-flash-lite:generateContent",
      );
      expect(sent?.headers["x-goog-api-key"]).toBe(KEY);
      expect(sent?.body).toEqual({
        contents: [
          {
            role: "user",
            parts: [{ text: request().user }],
          },
        ],
        systemInstruction: {
          role: "user",
          parts: [{ text: request().system }],
        },
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: REPLY_DRAFT_JSON_SCHEMA,
          maxOutputTokens: 8_192,
          thinkingConfig: { thinkingLevel: "LOW" },
        },
      });
    });

    it("sends no thinking level when none is configured, and never sampling settings", async () => {
      stub.reply(() => ({ body: answered }));
      await chat(null).generate(request());
      const config = (stub.requests[0]?.body as Record<string, unknown>)
        .generationConfig as Record<string, unknown>;
      expect(config).not.toHaveProperty("thinkingConfig");
      expect(config).not.toHaveProperty("temperature");
      expect(config).not.toHaveProperty("topP");
    });

    it("returns the answer's text, the model that answered and the tokens, counting thinking as output", async () => {
      stub.reply(() => ({ body: answered }));
      expect(await chat().generate(request())).toEqual({
        kind: "output",
        text: ANSWER,
        model: "gemini-3.5-flash-lite-001",
        usage: { inputTokens: 812, outputTokens: 65 },
      });
    });

    it("leaves thoughts out of the answer's text", async () => {
      stub.reply(() => ({
        body: {
          ...answered,
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  { text: "Let me think about refunds.", thought: true },
                  { text: ANSWER },
                ],
              },
              finishReason: "STOP",
            },
          ],
        },
      }));
      const result = await chat().generate(request());
      expect(result.kind === "output" && result.text).toBe(ANSWER);
    });

    it.each([
      [
        "a blocked prompt",
        {
          promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
          usageMetadata: { promptTokenCount: 812 },
        },
      ],
      [
        "an answer stopped for safety",
        {
          candidates: [{ finishReason: "SAFETY" }],
          usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 0 },
        },
      ],
    ])("reports %s as a refusal, not an error", async (_case, body) => {
      stub.reply(() => ({ body }));
      expect(await chat().generate(request())).toEqual({
        kind: "refused",
        model: "gemini-3.5-flash-lite",
        usage: { inputTokens: 812, outputTokens: 0 },
      });
    });

    it.each([429, 500, 503])(
      "fails on HTTP %i after one request, leaving retries to the queue",
      async (status) => {
        stub.reply(() => ({
          status,
          body: { error: { code: status, message: "try later" } },
        }));
        await expect(chat().generate(request())).rejects.toThrow();
        expect(stub.requests).toHaveLength(1);
      },
    );

    it("gives up when the server doesn't answer in time", async () => {
      stub.reply(() => ({ hang: true }));
      const started = Date.now();
      await expect(chat("low", 300).generate(request())).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(stub.requests).toHaveLength(1);
    });

    it("stops waiting when the attempt is aborted", async () => {
      stub.reply(() => ({ hang: true }));
      const controller = new AbortController();
      const pending = chat().generate(request(controller.signal));
      setTimeout(() => {
        controller.abort(new Error("attempt timed out"));
      }, 100);
      await expect(pending).rejects.toThrow();
    });
  });

  describe("embeddings", () => {
    const embeddings = () =>
      new GeminiEmbeddingModel({
        ...options(),
        model: "gemini-embedding-2",
      });

    const vectors = (count: number, length = 1_024) => ({
      embeddings: Array.from({ length: count }, (_, index) => ({
        values: vectorOf(index, length),
      })),
    });

    it("sends each document as its own input, titled, at 1,024 dimensions", async () => {
      stub.reply(() => ({ body: vectors(2) }));
      const result = await embeddings().embedDocuments([
        { title: "How long refunds take", text: "Refunds take 3 to 5 days." },
        { title: "", text: "Orphan chunk" },
      ]);

      expect(result).toEqual([vectorOf(0), vectorOf(1)]);
      const [sent] = stub.requests;
      expect(sent?.path).toBe(
        "/v1beta/models/gemini-embedding-2:batchEmbedContents",
      );
      expect(sent?.headers["x-goog-api-key"]).toBe(KEY);
      expect(sent?.body).toEqual({
        requests: [
          {
            content: {
              role: "user",
              parts: [
                {
                  text: "title: How long refunds take | text: Refunds take 3 to 5 days.",
                },
              ],
            },
            outputDimensionality: 1_024,
            model: "models/gemini-embedding-2",
          },
          {
            content: {
              role: "user",
              parts: [{ text: "title: none | text: Orphan chunk" }],
            },
            outputDimensionality: 1_024,
            model: "models/gemini-embedding-2",
          },
        ],
      });
    });

    it("words a query as a search for an answer", async () => {
      stub.reply(() => ({ body: vectors(1) }));
      expect(await embeddings().embedQuery("Where is my refund?")).toEqual(
        vectorOf(0),
      );
      const body = stub.requests[0]?.body as {
        requests: { content: { parts: { text: string }[] } }[];
      };
      expect(body.requests[0]?.content.parts[0]?.text).toBe(
        "task: search result | query: Where is my refund?",
      );
    });

    it("refuses vectors of another dimension, or the wrong number of them", async () => {
      stub.reply(() => ({ body: vectors(1, 3_072) }));
      await expect(embeddings().embedQuery("refund")).rejects.toThrow(
        /3072 dimensions; the index holds 1024/,
      );
      stub.reply(() => ({ body: vectors(1) }));
      await expect(
        embeddings().embedDocuments([
          { title: "A", text: "one" },
          { title: "B", text: "two" },
        ]),
      ).rejects.toThrow(/1 embeddings for 2 inputs/);
    });

    it("fails on HTTP 429 after one request", async () => {
      stub.reply(() => ({
        status: 429,
        body: { error: { code: 429, message: "quota" } },
      }));
      await expect(embeddings().embedQuery("refund")).rejects.toThrow();
      expect(stub.requests).toHaveLength(1);
    });
  });
});
