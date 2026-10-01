/**
 * Small real files for upload tests: each starts with the bytes its format
 * really starts with, so content detection sees what it would see in a
 * genuine upload.
 */

const base64 = (value: string) => Buffer.from(value, "base64");

/** A local file header for one stored entry, a central directory and its end record. */
function zipArchive(): Buffer {
  const name = Buffer.from("notes.txt");
  const local = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.alloc(12),
    Buffer.from([name.length, 0, 0, 0]),
    name,
  ]);
  const central = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.alloc(12),
    Buffer.from([name.length, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.alloc(4),
    name,
  ]);
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0]),
    Buffer.from([central.length, 0, 0, 0, local.length, 0, 0, 0, 0, 0]),
  ]);
  return Buffer.concat([local, central, end]);
}

export const FILES = {
  /** A 1x1 transparent PNG. */
  png: base64(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  /** A 1x1 JPEG. */
  jpeg: base64(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  ),
  /** A 1x1 GIF. */
  gif: base64("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="),
  /** A 1x1 lossy WebP. */
  webp: base64("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"),
  /** A minimal PDF, with the binary comment line real PDFs carry. */
  pdf: Buffer.concat([
    Buffer.from("%PDF-1.7\n%"),
    Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]),
    Buffer.from(
      "\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
    ),
  ]),
  /** A support log, with a UTF-8 byte-order mark and non-ASCII text. */
  log: Buffer.from(
    "﻿2026-10-01 09:12:44 ERROR hub-01 lost Wi-Fi\r\n\tretrying… (café)\n",
  ),
  /** A Windows executable's header: what a renamed `invoice.pdf` really is. */
  exe: Buffer.concat([
    Buffer.from("MZ"),
    Buffer.from([0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]),
    Buffer.alloc(54),
    Buffer.from("This program cannot be run in DOS mode.\r\n"),
  ]),
  /** A Linux executable's header. */
  elf: Buffer.concat([
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    Buffer.alloc(56),
  ]),
  zip: zipArchive(),
  /** Looks like text until a NUL byte, as binary files often do. */
  textWithNul: Buffer.from("printer log\u0000\u0000binary tail"),
  /** Not valid UTF-8. */
  latin1: Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
  /** Text with a terminal escape sequence in it. */
  textWithEscape: Buffer.from("status: \u001b[31mfailed\u001b[0m\n"),
  /** Script with no binary signature: only ever stored as plain text. */
  svg: Buffer.from(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  ),
  html: Buffer.from("<!doctype html><script>alert(document.cookie)</script>"),
} as const;
