import { PASSWORD_HASHING } from "@dsd/shared";
import { hash } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";

import { PasswordHasher } from "./password-hasher.js";

const hasher = new PasswordHasher();
const PASSWORD = "correct horse battery staple";

describe("PasswordHasher", () => {
  it("hashes with argon2id and the shared parameters (NFR-5)", async () => {
    const stored = await hasher.hash(PASSWORD);
    expect(stored).toMatch(
      new RegExp(
        String.raw`^\$argon2id\$v=19\$m=${PASSWORD_HASHING.memoryCostKiB},t=${PASSWORD_HASHING.timeCost},p=${PASSWORD_HASHING.parallelism}\$`,
      ),
    );
    expect(stored).not.toContain(PASSWORD);
  });

  it("salts every hash", async () => {
    expect(await hasher.hash(PASSWORD)).not.toBe(await hasher.hash(PASSWORD));
  });

  it("accepts the right password and refuses a wrong one", async () => {
    const stored = await hasher.hash(PASSWORD);
    expect(await hasher.verify(stored, PASSWORD)).toBe(true);
    expect(await hasher.verify(stored, `${PASSWORD} `)).toBe(false);
  });

  it("refuses an account without a password, after doing the same work", async () => {
    const started = performance.now();
    expect(await hasher.verify(null, PASSWORD)).toBe(false);
    const missing = performance.now() - started;

    const stored = await hasher.hash(PASSWORD);
    const again = performance.now();
    await hasher.verify(stored, "wrong password");
    const wrong = performance.now() - again;

    // Same algorithm and cost, so the same order of magnitude. A shortcut
    // (returning at once) would be over a hundred times faster.
    expect(missing).toBeGreaterThan(wrong / 5);
  });

  it("treats a malformed stored hash as a mismatch, not an error", async () => {
    expect(await hasher.verify("not-a-hash", PASSWORD)).toBe(false);
  });

  it("asks for a rehash only when the parameters are out of date", async () => {
    expect(hasher.needsRehash(await hasher.hash(PASSWORD))).toBe(false);
    const older = await hash(PASSWORD, {
      memoryCost: 8192,
      timeCost: 1,
      parallelism: 1,
    });
    expect(hasher.needsRehash(older)).toBe(true);
  });
});
