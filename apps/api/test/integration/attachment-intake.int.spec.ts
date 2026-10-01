import { createHash } from "node:crypto";
import { buffer } from "node:stream/consumers";

import { afterAll, describe, expect, it } from "vitest";

import { ProblemException } from "../../src/common/problem-details.js";
import { parseEnv } from "../../src/config/env.js";
import {
  createS3Client,
  ObjectMissingError,
  ObjectStore,
} from "../../src/infrastructure/object-store.js";
import {
  AttachmentIntake,
  type StoredFile,
} from "../../src/modules/attachments/attachment-intake.js";
import type { IncomingFile } from "../../src/modules/attachments/multipart.js";
import { TEST_ENV } from "../support/app.js";
import { FILES } from "../support/files.js";

/** Files as the multipart reader hands them over. */
function incoming(...files: [string, Buffer][]): AsyncIterable<IncomingFile> {
  return (async function* () {
    for (const [filename, bytes] of files) {
      await Promise.resolve();
      yield { filename, read: () => Promise.resolve(bytes) };
    }
  })();
}

/** The real store, noting every key written, so a test can check what was cleaned up. */
class RecordingStore extends ObjectStore {
  readonly written: string[] = [];

  override async put(key: string, body: Buffer, contentType: string) {
    await super.put(key, body, contentType);
    this.written.push(key);
  }
}

/** The intake against the real object store (ADR-0009, section 3). */
describe("AttachmentIntake", () => {
  const env = parseEnv(TEST_ENV);
  const objects = new RecordingStore(createS3Client(env), env.S3_BUCKET);
  const intake = new AttachmentIntake(objects);

  afterAll(() => {
    objects.close();
  });

  const exists = async (key: string) => {
    try {
      await buffer(await objects.get(key));
      return true;
    } catch (error) {
      if (error instanceof ObjectMissingError) return false;
      throw error;
    }
  };

  it("stores accepted files under random keys, with what their bytes say they are", async () => {
    const stored = await intake.storeThen(
      incoming(
        ["C:\\fakepath\\receipt.pdf", FILES.pdf],
        ["hub.log", FILES.log],
      ),
      (files) => Promise.resolve(files),
    );
    expect(
      stored.map(({ filename, contentType, sizeBytes }) => ({
        filename,
        contentType,
        sizeBytes,
      })),
    ).toEqual([
      {
        filename: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: FILES.pdf.length,
      },
      {
        filename: "hub.log",
        contentType: "text/plain; charset=utf-8",
        sizeBytes: FILES.log.length,
      },
    ]);
    for (const file of stored) {
      expect(file.objectKey).toMatch(/^attachments\/[0-9a-f-]{36}$/);
      expect(file.objectKey).not.toContain(file.filename);
      expect(await exists(file.objectKey)).toBe(true);
    }
    expect(stored[0]?.sha256).toEqual(
      createHash("sha256").update(FILES.pdf).digest(),
    );
  });

  it("refuses a renamed executable with 415 and removes what it had stored", async () => {
    const committed: StoredFile[] = [];
    const writtenBefore = objects.written.length;
    const error = await intake
      .storeThen(
        incoming(["photo.png", FILES.png], ["invoice.pdf", FILES.exe]),
        (files) => {
          committed.push(...files);
          return Promise.resolve(files);
        },
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).getStatus()).toBe(415);
    expect((error as ProblemException).message).toContain("invoice.pdf");
    expect(committed).toEqual([]);
    // The PNG was stored before the executable was seen; it is gone again,
    // and the executable never reached the store.
    const written = objects.written.slice(writtenBefore);
    expect(written).toHaveLength(1);
    expect(await exists(written[0] ?? "")).toBe(false);
  });

  it("deletes the stored files when the commit fails", async () => {
    let keys: string[] = [];
    await expect(
      intake.storeThen(
        incoming(["a.png", FILES.png], ["b.gif", FILES.gif]),
        (files) => {
          keys = files.map((file) => file.objectKey);
          return Promise.reject(new Error("the transaction failed"));
        },
      ),
    ).rejects.toThrow("the transaction failed");
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(await exists(key)).toBe(false);
  });
});
