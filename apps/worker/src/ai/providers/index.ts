import type { Env } from "../../config/env.js";
import { aiSettings } from "../settings.js";
import { GeminiChatModel, GeminiEmbeddingModel } from "./gemini.js";
import { MockChatModel } from "./mock-chat.js";
import { MockEmbeddingModel } from "./mock-embeddings.js";
import type { AiModels, ChatModel, EmbeddingModel } from "./types.js";

/** A key the environment check has already required for this provider. */
function keyFor(name: string, key: string | undefined): string {
  if (key === undefined) throw new Error(`${name} is not set`);
  return key;
}

/**
 * Builds the configured chat and embedding models (ADR-0006, section 2).
 * API keys go from the environment straight to the clients; the settings
 * the pipeline passes around never hold them.
 */
export function createModels(env: Env): AiModels {
  const settings = aiSettings(env);
  const gemini = (model: string, timeoutMs: number) => ({
    apiKey: keyFor("GEMINI_API_KEY", env.GEMINI_API_KEY),
    model,
    timeoutMs,
    ...(env.GEMINI_BASE_URL === undefined
      ? {}
      : { baseUrl: env.GEMINI_BASE_URL }),
  });

  const { chat } = settings;
  let chatModel: ChatModel;
  switch (chat.provider) {
    case "mock":
      chatModel = new MockChatModel(chat.model, chat.mockMode);
      break;
    case "gemini":
      chatModel = new GeminiChatModel(
        gemini(chat.model, chat.timeoutMs),
        chat.effort,
      );
      break;
  }

  const { embeddings } = settings;
  let embeddingModel: EmbeddingModel | null = null;
  switch (embeddings?.provider) {
    case undefined:
      break;
    case "mock":
      embeddingModel = new MockEmbeddingModel(embeddings.model);
      break;
    case "gemini":
      embeddingModel = new GeminiEmbeddingModel(
        gemini(embeddings.model, embeddings.timeoutMs),
      );
      break;
  }

  return { chat: chatModel, embeddings: embeddingModel };
}
