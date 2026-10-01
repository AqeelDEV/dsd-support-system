import type { AttachmentContentType } from "@dsd/shared";
import { fileTypeFromBuffer } from "file-type";

/** Formats accepted by their binary signature (ADR-0009, section 1). */
const SIGNED_TYPES = new Set<AttachmentContentType>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const PLAIN_TEXT: AttachmentContentType = "text/plain; charset=utf-8";

export type ContentCheck =
  | { accepted: true; contentType: AttachmentContentType }
  | { accepted: false; reason: string };

const isSigned = (mime: string): mime is AttachmentContentType =>
  SIGNED_TYPES.has(mime as AttachmentContentType);

/**
 * Plain text in the strict sense ADR-0009 uses: valid UTF-8 with no
 * control characters other than tab, line feed and carriage return. That
 * rules out NUL bytes, terminal escape sequences and anything binary.
 */
export function isPlainText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const control =
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f);
    if (control) return false;
  }
  return true;
}

/**
 * Decides what a file is from its bytes alone; the name and the type the
 * browser declared are never consulted. An allowlisted signature wins.
 * Otherwise only strict plain text gets in, and it is always served as
 * `text/plain`: that covers logs and config files, and means SVG, HTML or
 * XML can only ever be downloaded as text, never rendered. Anything else
 * is refused, including executables, archives and Office documents.
 */
export async function checkContent(bytes: Uint8Array): Promise<ContentCheck> {
  if (bytes.length === 0) return { accepted: false, reason: "it is empty" };
  const detected = await fileTypeFromBuffer(bytes);
  if (detected !== undefined && isSigned(detected.mime)) {
    return { accepted: true, contentType: detected.mime };
  }
  if (isPlainText(bytes)) return { accepted: true, contentType: PLAIN_TEXT };
  return {
    accepted: false,
    reason:
      detected === undefined
        ? "it isn't an image, a PDF or plain UTF-8 text"
        : `it is ${detected.mime}, which isn't accepted`,
  };
}
