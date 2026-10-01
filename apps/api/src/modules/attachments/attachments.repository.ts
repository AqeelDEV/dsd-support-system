import { Injectable } from "@nestjs/common";
import { attachments, messages } from "@dsd/db/schema";
import type { AttachmentContentType } from "@dsd/shared";
import { and, asc, eq, isNull, or } from "drizzle-orm";

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

  /**
   * A ticket's attachments, oldest first. With `public`, files on internal
   * notes are left out in the query itself, so a customer response can't
   * contain them.
   */
  async forTicket(
    executor: Executor,
    ticketId: string,
    visibility: "public" | "all",
  ): Promise<AttachmentRow[]> {
    const rows = await executor
      .select(columns)
      .from(attachments)
      .leftJoin(messages, eq(messages.id, attachments.messageId))
      .where(
        and(
          eq(attachments.ticketId, ticketId),
          visibility === "all"
            ? undefined
            : or(
                isNull(attachments.messageId),
                eq(messages.visibility, "public"),
              ),
        ),
      )
      .orderBy(asc(attachments.createdAt), asc(attachments.id));
    return rows.map(asRow);
  }

  /**
   * One attachment of one ticket, for download. With `public`, a file on an
   * internal note doesn't exist (ADR-0009, section 4), and an ID from
   * another ticket never matches.
   */
  async findForDownload(
    executor: Executor,
    ticketId: string,
    attachmentId: string,
    visibility: "public" | "all",
  ) {
    const [row] = await executor
      .select({
        objectKey: attachments.objectKey,
        filename: attachments.filename,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
      })
      .from(attachments)
      .leftJoin(messages, eq(messages.id, attachments.messageId))
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.ticketId, ticketId),
          visibility === "all"
            ? undefined
            : or(
                isNull(attachments.messageId),
                eq(messages.visibility, "public"),
              ),
        ),
      );
    return row;
  }
}
