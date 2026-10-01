import type { Readable } from "node:stream";

import type { FastifyReply } from "fastify";

/** A stored file on its way to the client. */
export interface Download {
  filename: string;
  contentType: string;
  sizeBytes: number;
  stream: Readable;
}

/** RFC 8187 encoding for `filename*`: percent-encoded UTF-8, including the characters encodeURIComponent leaves alone. */
function encodeFilename(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function contentDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeFilename(filename)}`;
}

/**
 * The headers every download carries (ADR-0009, section 4): always a
 * download, never displayed; the detected type, which the browser mustn't
 * second-guess; never cached by shared caches; and a sandboxing policy as
 * the last line of defence if a browser renders the file anyway.
 */
export function sendDownload(reply: FastifyReply, file: Download): Readable {
  void reply.headers({
    "content-type": file.contentType,
    "content-length": String(file.sizeBytes),
    "content-disposition": contentDisposition(file.filename),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
    "content-security-policy": "default-src 'none'; sandbox",
  });
  return file.stream;
}
