import { Injectable } from "@nestjs/common";
import { attachments } from "@dsd/db/schema";
import type { AttachmentContentType } from "@dsd/shared";

import type { Executor } from "../../infrastructure/database.js";
import type { Actor } from "../audit/audit.repository.js";
import type { StoredFile } from "./attachment-intake.js";

export interface AttachmentRow {
  id: string;
  messageId: string | null;
  filename: string;
  contentType: AttachmentContentType;
  sizeBytes: number;
  createdAt: Date;
}

const columns = {
  id: attachments.id,
  messageId: attachments.messageId,
  filename: attachments.filename,
  contentType: attachments.contentType,
  sizeBytes: attachments.sizeBytes,
  createdAt: attachments.createdAt,
};

/** Only content types the intake produced are ever stored. */
const asRow = (
  row: Omit<AttachmentRow, "contentType"> & { contentType: string },
) => row as AttachmentRow;

/**
 * Attachment rows (ADR-0009). An attachment belongs to its ticket and, when
 * it came with a reply or a note, to that message, whose visibility it
 * shares.
 */
@Injectable()
export class AttachmentsRepository {
  /** Rows for files the intake has just stored, in the caller's transaction. */
  async insert(
    executor: Executor,
    target: { ticketId: string; messageId: string | null },
    uploader: Actor,
    files: readonly StoredFile[],
  ): Promise<AttachmentRow[]> {
    if (files.length === 0) return [];
    const rows = await executor
      .insert(attachments)
      .values(
        files.map((file) => ({
          ticketId: target.ticketId,
          messageId: target.messageId,
          uploaderType: uploader.type,
          uploaderCustomerId:
            uploader.type === "customer" ? uploader.customerId : null,
          uploaderAgentId: uploader.type === "agent" ? uploader.agentId : null,
          objectKey: file.objectKey,
          filename: file.filename,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
        })),
      )
      .returning(columns);
    return rows.map(asRow);
  }
}
