import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import type { Env } from "../config/env.js";

export interface StoredObject {
  key: string;
  lastModified: Date;
}

/**
 * The attachment bucket, as the worker uses it: to list and delete objects
 * nobody refers to (ADR-0009, section 3). It never reads a file.
 */
export class ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    env: Pick<
      Env,
      | "S3_ENDPOINT"
      | "S3_REGION"
      | "S3_BUCKET"
      | "S3_ACCESS_KEY_ID"
      | "S3_SECRET_ACCESS_KEY"
      | "S3_FORCE_PATH_STYLE"
    >,
  ) {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
    this.bucket = env.S3_BUCKET;
  }

  /** Every object under `prefix`, a page at a time. */
  async *list(prefix: string): AsyncGenerator<StoredObject[]> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      yield (page.Contents ?? []).flatMap((object) =>
        object.Key === undefined || object.LastModified === undefined
          ? []
          : [{ key: object.Key, lastModified: object.LastModified }],
      );
      token =
        page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
  }

  /** Deletes up to 1,000 objects in one request. */
  async deleteMany(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const result = await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
      }),
    );
    const failed = result.Errors ?? [];
    if (failed.length > 0) {
      throw new Error(`Could not delete ${failed.length} object(s)`);
    }
  }

  close(): void {
    this.client.destroy();
  }
}
