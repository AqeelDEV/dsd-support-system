import { randomUUID } from "node:crypto";
import { text } from "node:stream/consumers";

import { afterAll, describe, expect, it } from "vitest";

import { ProblemException } from "../../src/common/problem-details.js";
import { parseEnv } from "../../src/config/env.js";
import {
  createS3Client,
  ObjectMissingError,
  ObjectStore,
} from "../../src/infrastructure/object-store.js";
import { closedPort, TEST_ENV } from "../support/app.js";

/** The compose SeaweedFS, as the API reaches it (ADR-0009, section 3). */
describe("ObjectStore (S3)", () => {
  const env = parseEnv(TEST_ENV);
  const store = new ObjectStore(createS3Client(env), env.S3_BUCKET);
  const key = `attachments/${randomUUID()}`;

  afterAll(() => {
    store.close();
  });

  it("stores, reads back and deletes an object", async () => {
    await store.put(key, Buffer.from("printer log\n"), "text/plain");
    expect(await text(await store.get(key))).toBe("printer log\n");
    await store.delete(key);
    await expect(store.get(key)).rejects.toBeInstanceOf(ObjectMissingError);
  });

  it("refuses anonymous reads, so a leaked key alone opens nothing", async () => {
    const anonymousKey = `attachments/${randomUUID()}`;
    await store.put(anonymousKey, Buffer.from("secret"), "text/plain");
    try {
      const response = await fetch(
        `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${anonymousKey}`,
      );
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("secret");
    } finally {
      await store.delete(anonymousKey);
    }
  });

  it("answers 503 when the store can't be reached", async () => {
    const down = parseEnv({
      ...TEST_ENV,
      S3_ENDPOINT: `http://127.0.0.1:${await closedPort()}`,
    });
    const unreachable = new ObjectStore(createS3Client(down), down.S3_BUCKET);
    try {
      const error = await unreachable
        .put(key, Buffer.from("x"), "text/plain")
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).getStatus()).toBe(503);
    } finally {
      unreachable.close();
    }
  });
});
