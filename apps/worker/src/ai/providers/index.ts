import type { AiSettings } from "../settings.js";
import { MockChatModel } from "./mock-chat.js";
import { MockEmbeddingModel } from "./mock-embeddings.js";
import type { AiModels } from "./types.js";

/** Builds the configured chat and embedding models (ADR-0006, section 2). */
export function createModels(settings: AiSettings): AiModels {
  return {
    chat: new MockChatModel(settings.chat.model, settings.chat.mockMode),
    embeddings:
      settings.embeddings === null
        ? null
        : new MockEmbeddingModel(settings.embeddings.model),
  };
}
