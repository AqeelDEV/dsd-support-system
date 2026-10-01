import { z } from "zod";

/**
 * Upload limits (ADR-0009, section 2). `maxBytes` matches the
 * `attachments_size_ck` constraint, so the database refuses anything the
 * API would.
 */
export const ATTACHMENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 5,
  /** The cleaned display name is cut to this many UTF-8 bytes. */
  filenameMaxBytes: 255,
} as const;

/**
 * Every content type an attachment can be stored and served as. It is
 * always detected from the file's bytes, never taken from the upload
 * (ADR-0009, section 1).
 */
export const ATTACHMENT_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain; charset=utf-8",
] as const;
export const attachmentContentTypeSchema = z.enum(ATTACHMENT_CONTENT_TYPES);
export type AttachmentContentType = z.infer<typeof attachmentContentTypeSchema>;

/** The multipart field that carries files on every route that accepts them. */
export const ATTACHMENTS_FIELD = "attachments";

export const attachmentSchema = z.object({
  id: z.uuid(),
  filename: z
    .string()
    .describe("For display and as the download name; never part of a URL"),
  contentType: attachmentContentTypeSchema,
  sizeBytes: z.number().int().min(1),
  createdAt: z.iso.datetime(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
