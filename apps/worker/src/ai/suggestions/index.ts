import type { Database } from "@dsd/db";

import type { Logger } from "../../logger.js";
import type { AiModels } from "../providers/types.js";
import { Retriever } from "../retrieval/retriever.js";
import type { AiSettings } from "../settings.js";
import { SuggestionDrafter } from "./drafter.js";
import { SuggestionHandler } from "./handler.js";
import { SuggestionsRepository } from "./suggestions.repository.js";
import { TicketContextRepository } from "./ticket-context.js";

/** Everything a suggestion job needs, wired from the database, the models and the settings. */
export function createSuggestionHandler(
  db: Database,
  models: AiModels,
  settings: Pick<AiSettings, "thresholds"> & {
    chat: Pick<AiSettings["chat"], "timeoutMs">;
  },
  logger: Logger,
): SuggestionHandler {
  const suggestions = new SuggestionsRepository(db);
  const drafter = new SuggestionDrafter(
    new Retriever(db, models.embeddings),
    models.chat,
    settings.thresholds,
    settings.chat.timeoutMs,
    (chunkIds) => suggestions.stillPublished(chunkIds),
  );
  return new SuggestionHandler(
    new TicketContextRepository(db),
    suggestions,
    drafter,
    models.chat,
    models.embeddings === null ? "fts_only" : "hybrid",
    logger,
  );
}
