import { createHash, randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { type AttachmentContentType, PROBLEM_TYPES } from "@dsd/shared";

import { ProblemException } from "../../common/problem-details.js";
import { ObjectStore } from "../../infrastructure/object-store.js";
import { checkContent } from "./content-check.js";
import { cleanFilename } from "./filename.js";
import type { IncomingFile } from "./multipart.js";

/** A file that passed every check and sits in the object store, waiting for its row. */
export interface StoredFile {
  objectKey: string;
  filename: string;
  contentType: AttachmentContentType;
  sizeBytes: number;
  sha256: Buffer;
}

/**
 * Takes uploaded files into the object store (ADR-0009, as amended by
 * ADR-0011). Each file is read in full, up to the 10 MB cap, and checked
 * before anything is written, so the bucket never holds bytes that failed a
 * check. Files go one at a time, so a request holds at most one file in
 * memory. Objects get random keys; the filename is display text only.
 */
@Injectable()
export class AttachmentIntake {
  private readonly logger = new Logger("Attachments");

  constructor(private readonly objects: ObjectStore) {}

  /**
   * Stores every file, then runs `commit` (the transaction that writes their
   * rows). If a file is refused, the store fails or `commit` throws, the
   * objects already stored are deleted again, so a failed request leaves no
   * files behind. A crash between the two steps is what the orphan sweep is
   * for.
   */
  async storeThen<T>(
    files: AsyncIterable<IncomingFile>,
    commit: (stored: StoredFile[]) => Promise<T>,
  ): Promise<T> {
    const stored: StoredFile[] = [];
    try {
      for await (const file of files) stored.push(await this.store(file));
      return await commit(stored);
    } catch (error) {
      await this.discard(stored);
      throw error;
    }
  }

  private async store(file: IncomingFile): Promise<StoredFile> {
    const filename = cleanFilename(file.filename);
    const bytes = await file.read();
    const check = await checkContent(bytes);
    if (!check.accepted) {
      throw new ProblemException(
        415,
        PROBLEM_TYPES.blank,
        `"${filename}" can't be attached because ${check.reason}. Attach images (PNG, JPEG, GIF, WebP), PDFs or plain text.`,
      );
    }
    const objectKey = `attachments/${randomUUID()}`;
    await this.objects.put(objectKey, bytes, check.contentType);
    return {
      objectKey,
      filename,
      contentType: check.contentType,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest(),
    };
  }

  private async discard(stored: readonly StoredFile[]): Promise<void> {
    for (const file of stored) {
      try {
        await this.objects.delete(file.objectKey);
      } catch {
        // Already logged by the store; the orphan sweep removes it later.
        this.logger.warn(`Left ${file.objectKey} for the orphan sweep`);
      }
    }
  }
}
