import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AnthropicChatModel } from "../../src/ai/providers/anthropic.js";
import type { GenerateRequest } from "../../src/ai/providers/types.js";
import { REPLY_DRAFT_JSON_SCHEMA } from "../../src/ai/suggestions/reply-draft.js";
import { StubServer } from "../support/stub-server.js";

const KEY = "test-anthropic-key";

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

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: ANSWER },
  ],
  stop_reason: "end_turn",
  stop_details: null,
  usage: { input_tokens: 900, output_tokens: 120 },
  ...overrides,
});

/**
 * The Anthropic adapter against a local stand-in for the Messages API:
 * what the SDK sends for our settings and how answers, refusals and
 * failures come back. Not run against the live API in this project (no
 * key); EVALUATION.md says so.
 */
describe("Anthropic chat adapter", () => {
  let stub: StubServer;
  const chat = (
    effort: "low" | "medium" | "high" | null = "medium",
    timeoutMs = 5_000,
  ) =>
    new AnthropicChatModel(
      { apiKey: KEY, baseUrl: stub.url, model: "claude-sonnet-5-5", timeoutMs },
      effort,
    );

  beforeAll(async () => {
    stub = await StubServer.start();
  });

  beforeEach(() => {
    stub.reset();
  });

  afterAll(async () => {
    await stub.close();
  });

  it("asks for JSON in the reply contract's schema at the configured effort, with server-side fallback, and no thinking or sampling settings", async () => {
    stub.reply(() => ({ body: message() }));
    await chat().generate(request());

    expect(stub.requests).toHaveLength(1);
    const [sent] = stub.requests;
    expect(sent?.method).toBe("POST");
    expect(sent?.path).toBe("/v1/messages?beta=true");
    expect(sent?.headers["x-api-key"]).toBe(KEY);
    expect(sent?.headers["anthropic-beta"]).toBe(
      "server-side-fallback-2026-07-01",
    );
    expect(sent?.body).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 16_000,
      system: request().system,
      messages: [{ role: "user", content: request().user }],
      output_config: {
        format: { type: "json_schema", schema: REPLY_DRAFT_JSON_SCHEMA },
        effort: "medium",
      },
      fallbacks: "default",
    });
  });

  it("leaves effort to the model when none is configured", async () => {
    stub.reply(() => ({ body: message() }));
    await chat(null).generate(request());
    const body = stub.requests[0]?.body as {
      output_config: Record<string, unknown>;
    };
    expect(body.output_config).not.toHaveProperty("effort");
  });

  it("returns the text blocks, the model that served the answer and the tokens", async () => {
    stub.reply(() => ({ body: message({ model: "claude-sonnet-5" }) }));
    expect(await chat().generate(request())).toEqual({
      kind: "output",
      text: ANSWER,
      model: "claude-sonnet-5",
      usage: { inputTokens: 900, outputTokens: 120 },
    });
  });

  it("reports a refusal as a refusal, not an error", async () => {
    stub.reply(() => ({
      body: message({
        content: [],
        stop_reason: "refusal",
        stop_details: {
          type: "refusal",
          category: "general_harms",
          explanation: null,
        },
        usage: { input_tokens: 900, output_tokens: 0 },
      }),
    }));
    expect(await chat().generate(request())).toEqual({
      kind: "refused",
      model: "claude-sonnet-5-5",
      usage: { inputTokens: 900, outputTokens: 0 },
    });
  });

  it.each([429, 500, 529])(
    "fails on HTTP %i after one request, leaving retries to the queue",
    async (status) => {
      stub.reply(() => ({
        status,
        body: {
          type: "error",
          error: { type: "overloaded_error", message: "try later" },
        },
      }));
      await expect(chat().generate(request())).rejects.toThrow();
      expect(stub.requests).toHaveLength(1);
    },
  );

  it("gives up when the server doesn't answer in time", async () => {
    stub.reply(() => ({ hang: true }));
    const started = Date.now();
    await expect(chat("medium", 300).generate(request())).rejects.toThrow();
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

  it("refuses a minimal effort, which Anthropic doesn't offer", () => {
    expect(
      () =>
        new AnthropicChatModel(
          { apiKey: KEY, model: "claude-sonnet-5-5", timeoutMs: 1_000 },
          "minimal",
        ),
    ).toThrow(/no minimal effort/);
  });
});
