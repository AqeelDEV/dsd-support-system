import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

import type { AttachmentContentType } from "@dsd/shared";

/*
 * The files the demo tickets carry (ADR-0009): small, real files built here
 * rather than checked in, so their bytes pass the same content check an
 * upload gets (a PNG is a PNG, a PDF is a PDF, a log is UTF-8 text) and the
 * same ticket always gets the same file.
 */

export type SeedFileKind = "photo" | "screenshot" | "receipt" | "log";

export interface SeedFileDetails {
  product: string;
  order: string;
  amount: string;
  date: string;
}

export interface SeedFile {
  bytes: Buffer;
  contentType: AttachmentContentType;
}

/** What an object store has to offer the seed: the bucket, and somewhere to put bytes. */
export interface SeedObjectStore {
  /** Creates the bucket if it isn't there yet. */
  ensureBucket(): Promise<void>;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
}

/** A stored file, as its attachments row describes it. */
export interface StoredFile {
  objectKey: string;
  contentType: AttachmentContentType;
  sizeBytes: number;
  sha256: Buffer;
}

export function sha256(bytes: Buffer): Buffer {
  return createHash("sha256").update(bytes).digest();
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** A truecolour PNG whose pixels come from `paint`. */
function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bits per channel
  header.writeUInt8(2, 9); // RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3); // filter byte 0: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      row.writeUInt8(r, 1 + x * 3);
      row.writeUInt8(g, 2 + x * 3);
      row.writeUInt8(b, 3 + x * 3);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A one-page PDF with a few lines of text, with a correct cross-reference table. */
function pdf(lines: readonly string[]): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines
    .map(
      (line, index) =>
        `BT /F1 12 Tf 72 ${String(740 - index * 20)} Td (${escape(line)}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${String(Buffer.byteLength(text, "latin1"))} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** The bytes and type of one demo file. */
export function seedFile(
  kind: SeedFileKind,
  details: SeedFileDetails,
): SeedFile {
  switch (kind) {
    case "photo":
      // A parcel label on a brown box, near enough for a demo.
      return {
        contentType: "image/png",
        bytes: png(96, 64, (x, y) =>
          x > 24 && x < 72 && y > 16 && y < 48
            ? (x + y) % 6 < 2 && y > 36
              ? [40, 40, 40]
              : [245, 245, 240]
            : [176 + ((x * 3 + y) % 12), 134, 86],
        ),
      };
    case "screenshot":
      // Two identical payment rows in a banking app.
      return {
        contentType: "image/png",
        bytes: png(80, 120, (x, y) => {
          const row = Math.floor(y / 24);
          if (y % 24 < 2) return [220, 224, 230];
          if (row === 1 || row === 2)
            return x < 50 ? [30, 41, 59] : [190, 18, 60];
          return [248, 250, 252];
        }),
      };
    case "receipt":
      return {
        contentType: "application/pdf",
        bytes: pdf([
          "DSD returns receipt",
          `Order ${details.order}`,
          `Item: ${details.product}`,
          `Received at the returns centre on ${details.date}`,
          `Refund due: ${details.amount}`,
          "This is synthetic demo data.",
        ]),
      };
    case "log":
      return {
        contentType: "text/plain; charset=utf-8",
        bytes: Buffer.from(
          [
            `device: ${details.product}`,
            `firmware: 4.2.1 (updated ${details.date})`,
            "08:01:12 wifi: connected, signal -61 dBm",
            "08:01:15 cloud: handshake ok",
            "08:14:40 ota: update applied, rebooting",
            "08:15:02 wifi: connected, signal -60 dBm",
            "08:15:05 cloud: handshake failed (certificate not yet valid)",
            "08:15:35 cloud: handshake failed (certificate not yet valid)",
            "08:16:05 cloud: giving up, retry in 30 min",
            "",
          ].join("\n"),
          "utf8",
        ),
      };
  }
}
