import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { parseEnvironment } from "@dsd/shared";
import { z } from "zod";

import type { SeedObjectStore } from "../seed/index.js";

/*
 * The object store the seed puts the demo tickets' files in: the same
 * S3-compatible bucket the API serves downloads from (ADR-0009), with the
 * same settings names. Without S3_ENDPOINT the seed writes no files, which
 * is how the test harness runs it.
 */

const settingsSchema = z.object({
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(3).default("dsd-attachments"),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
});

/** Error names that mean the bucket is already there, from S3 and its look-alikes. */
const ALREADY_THERE = new Set([
  "BucketAlreadyOwnedByYou",
  "BucketAlreadyExists",
]);

export function objectStoreFromEnv(): SeedObjectStore | undefined {
  const env = parseEnvironment(settingsSchema, process.env);
  if (env.S3_ENDPOINT === undefined) return undefined;
  if (
    env.S3_ACCESS_KEY_ID === undefined ||
    env.S3_SECRET_ACCESS_KEY === undefined
  ) {
    throw new Error(
      "S3_ENDPOINT is set, so S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be too",
    );
  }
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  const bucket = env.S3_BUCKET;
  return {
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return;
      } catch (error) {
        const missing =
          error instanceof S3ServiceException &&
          (error.$metadata.httpStatusCode === 404 || error.name === "NotFound");
        if (!missing) throw error;
      }
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (!(
          error instanceof S3ServiceException && ALREADY_THERE.has(error.name)
        )) {
          throw error;
        }
      }
    },
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          ContentLength: bytes.length,
        }),
      );
    },
  };
}
