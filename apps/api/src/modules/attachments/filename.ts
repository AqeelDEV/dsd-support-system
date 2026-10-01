import { ATTACHMENT_LIMITS } from "@dsd/shared";

const FALLBACK = "attachment";

/**
 * Characters that never belong in a displayed filename: C0 and C1 control
 * characters, and the invisible formatting characters that can disguise
 * one, such as a right-to-left override turning `invoice‮fdp.exe` into
 * what looks like `invoiceexe.pdf`.
 */
const UNSAFE = /[\p{Cc}\p{Cf}]/gu;

/** The longest prefix of `value` that fits in `maxBytes` of UTF-8, cut between characters. */
function fitBytes(value: string, maxBytes: number): string {
  let bytes = 0;
  let kept = "";
  for (const character of value) {
    bytes += Buffer.byteLength(character, "utf8");
    if (bytes > maxBytes) break;
    kept += character;
  }
  return kept;
}

/**
 * The name an uploaded file is shown and downloaded under (ADR-0009,
 * section 2). Only the last path segment is kept, unsafe characters are
 * removed, and the result is cut to 255 bytes, keeping a short extension.
 * It is display text only: storage keys are random and never use it.
 */
export function cleanFilename(raw: string | undefined): string {
  const lastSegment = (raw ?? "").split(/[/\\]/).at(-1) ?? "";
  const name = lastSegment.normalize("NFC").replace(UNSAFE, "").trim();
  if (name === "" || name === "." || name === "..") return FALLBACK;

  const max = ATTACHMENT_LIMITS.filenameMaxBytes;
  if (Buffer.byteLength(name, "utf8") <= max) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot) : "";
  if (extension.length > 1 && Buffer.byteLength(extension, "utf8") <= 16) {
    const stem = fitBytes(
      name.slice(0, dot),
      max - Buffer.byteLength(extension, "utf8"),
    );
    return `${stem}${extension}`;
  }
  return fitBytes(name, max);
}
