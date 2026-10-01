import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Logger } from "@nestjs/common";
import { PROBLEM_TYPES } from "@dsd/shared";

import { ProblemException } from "../common/problem-details.js";
import type { Env } from "../config/env.js";

/** The connection to the S3-compatible store, configured for self-hosted stores too. */
export function createS3Client(env: Env): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    // Newer SDKs add CRC checksums to every request by default, which not
    // every S3-compatible store understands. The API hashes each file with
    // SHA-256 itself (ADR-0009).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    // Fail fast: an unreachable store is a 503, not a hung request.
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 2_000, requestTimeout: 30_000 },
  });
}

/** No object under that key. A row without its object is a bug, not a client error. */
export class ObjectMissingError extends Error {
  constructor(key: string) {
    super(`No object stored under ${key}`);
    this.name = "ObjectMissingError";
  }
}

/**
 * The private bucket that holds attachment bytes (ADR-0009, section 3).
 * Keys are chosen by the caller and never derived from a filename. When the
 * store can't be reached, uploads and downloads answer 503 while everything
 * without a file keeps working (ARCHITECTURE, "When a dependency fails").
 */
export class ObjectStore {
  private readonly logger = new Logger("ObjectStore");

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.call("store", () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        }),
      ),
    );
  }

  /** The object's bytes as a stream, for sending straight on to the client. */
  async get(key: string): Promise<Readable> {
    const response = await this.call("read", async () => {
      try {
        return await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        );
      } catch (error) {
        if (error instanceof NoSuchKey) throw new ObjectMissingError(key);
        throw error;
      }
    });
    if (!(response.Body instanceof Readable)) {
      throw new Error("The object store returned a body that isn't a stream");
    }
    return response.Body;
  }

  async delete(key: string): Promise<void> {
    await this.call("delete", () =>
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
  }

  close(): void {
    this.client.destroy();
  }

  private async call<T>(action: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ObjectMissingError) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Couldn't ${action} an object: ${reason}`);
      throw new ProblemException(
        503,
        PROBLEM_TYPES.blank,
        "File storage is unavailable for a moment. Try again shortly, or send your message without attachments.",
        { "retry-after": "30" },
      );
    }
  }
}
