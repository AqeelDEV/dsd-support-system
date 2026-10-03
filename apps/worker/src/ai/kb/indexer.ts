import type { Executor } from "../../infrastructure/executor.js";
import type { Logger } from "../../logger.js";
import { checkedVectors, type EmbeddingModel } from "../providers/types.js";
import { chunkArticle } from "./chunker.js";
import type {
  ArticleState,
  KnowledgeIndexRepository,
} from "./knowledge-index.repository.js";

export type IndexOutcome =
  "indexed" | "embedded" | "up-to-date" | "retired" | "superseded" | "missing";

/**
 * Keeps an article's chunks in step with the article (ADR-0006, section
 * 3). It works from the article as it is now, not from the event that
 * asked, so it can run for any reason, any number of times, in any order:
 *
 * - a published version with no chunks yet is chunked and embedded;
 * - a version already chunked keeps its text exactly as written, and only
 *   gets new vectors when the embedding model has changed, so a stored
 *   suggestion can always show the text it was based on;
 * - that version's chunks become the current ones, and every older
 *   version's stop being current;
 * - an unpublished or archived article's chunks all stop being current,
 *   which takes them out of retrieval at once.
 *
 * Embedding happens outside any transaction, because it can take seconds;
 * the writes then run under the article's lock, after checking that the
 * article hasn't moved on meanwhile. If it has, a newer job does the work.
 */
export class KnowledgeIndexer {
  constructor(
    private readonly repository: KnowledgeIndexRepository,
    private readonly embeddings: EmbeddingModel | null,
    private readonly logger: Logger,
  ) {}

  async index(articleId: string): Promise<IndexOutcome> {
    const outcome = await this.run(articleId);
    this.logger.info({ articleId, outcome }, "knowledge base article indexed");
    return outcome;
  }

  private async run(articleId: string): Promise<IndexOutcome> {
    const repository = this.repository;
    const article = await repository.article(articleId);
    if (article === undefined) return "missing";
    if (article.status !== "published") {
      await repository.locked(articleId, (tx) =>
        repository.retire(tx, articleId),
      );
      return "retired";
    }

    const stored = await repository.chunksOf(articleId, article.version);
    if (stored.length === 0) return this.write(article);

    const model = this.embeddings?.model ?? null;
    const stale =
      model === null
        ? []
        : stored.filter((chunk) => chunk.embeddingModel !== model);
    const vectors = await this.embed(
      article.title,
      stale.map((chunk) => `${chunk.headingPath}\n\n${chunk.content}`),
    );
    return repository.locked(articleId, async (tx) => {
      if (!(await this.stillPublished(article, tx))) return "superseded";
      if (vectors !== null && model !== null && stale.length > 0) {
        await repository.updateEmbeddings(
          tx,
          stale.map((chunk, index) => ({
            id: chunk.id,
            embedding: vectors[index] ?? [],
            model,
          })),
        );
      }
      await repository.makeCurrent(tx, articleId, article.version);
      return stale.length > 0 ? "embedded" : "up-to-date";
    });
  }

  /** Chunks and embeds a version that has no chunks yet. */
  private async write(article: ArticleState): Promise<IndexOutcome> {
    const repository = this.repository;
    const chunks = chunkArticle(article);
    const vectors = await this.embed(
      article.title,
      chunks.map((chunk) => `${chunk.headingPath}\n\n${chunk.content}`),
    );
    const model = this.embeddings?.model ?? null;
    return repository.locked(article.id, async (tx) => {
      if (!(await this.stillPublished(article, tx))) return "superseded";
      // Another job may have written this version while we were embedding.
      const written = await repository.chunksOf(
        article.id,
        article.version,
        tx,
      );
      if (written.length === 0) {
        await repository.insertChunks(
          tx,
          article.id,
          article.version,
          chunks.map((chunk, index) => ({
            ...chunk,
            embedding: vectors?.[index] ?? null,
            embeddingModel: vectors === null ? null : model,
          })),
        );
      }
      await repository.makeCurrent(tx, article.id, article.version);
      return "indexed";
    });
  }

  private async stillPublished(
    article: ArticleState,
    tx: Executor,
  ): Promise<boolean> {
    const now = await this.repository.article(article.id, tx);
    return now?.status === "published" && now.version === article.version;
  }

  /** Vectors for `texts`, or null when no embedding model is configured. */
  private async embed(
    title: string,
    texts: readonly string[],
  ): Promise<number[][] | null> {
    if (this.embeddings === null) return null;
    if (texts.length === 0) return [];
    const vectors = await this.embeddings.embedDocuments(
      texts.map((text) => ({ title, text })),
    );
    return checkedVectors(vectors, texts.length, this.embeddings.model);
  }
}
