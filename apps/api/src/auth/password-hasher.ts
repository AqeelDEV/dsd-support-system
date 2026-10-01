import { randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { PASSWORD_HASHING } from "@dsd/shared";
import { hash, verify } from "@node-rs/argon2";

const OPTIONS = {
  memoryCost: PASSWORD_HASHING.memoryCostKiB,
  timeCost: PASSWORD_HASHING.timeCost,
  parallelism: PASSWORD_HASHING.parallelism,
};

/**
 * The parameter section every current hash carries. argon2id is
 * @node-rs/argon2's default algorithm; its `Algorithm` enum is an ambient
 * const enum that isolated modules can't reference.
 */
const CURRENT_PREFIX = `$argon2id$v=19$m=${PASSWORD_HASHING.memoryCostKiB},t=${PASSWORD_HASHING.timeCost},p=${PASSWORD_HASHING.parallelism}$`;

/** argon2id password hashing (ADR-0003, section 3; NFR-5). */
@Injectable()
export class PasswordHasher {
  /**
   * Checked when the account doesn't exist or has no password, so a failed
   * sign-in takes as long either way and the timing doesn't reveal which
   * emails have accounts. Its password is random and thrown away.
   */
  private readonly dummyHash = hash(randomBytes(32).toString("hex"), OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  /** Whether `password` matches `stored`. A missing hash never matches, but costs the same. */
  async verify(stored: string | null, password: string): Promise<boolean> {
    if (stored === null) {
      await verify(await this.dummyHash, password);
      return false;
    }
    try {
      return await verify(stored, password);
    } catch {
      // A malformed hash in the database must not become a 500 that tells
      // the caller this account is special.
      return false;
    }
  }

  /**
   * True when `stored` was made with older parameters. The caller rehashes
   * at the next successful sign-in, which is the only time the plain
   * password is available.
   */
  needsRehash(stored: string): boolean {
    return !stored.startsWith(CURRENT_PREFIX);
  }
}
