import { hash } from "@node-rs/argon2";
import { PASSWORD_HASHING } from "@dsd/shared";

/**
 * argon2id with the shared cost parameters (ADR-0003, NFR-5). argon2id is
 * @node-rs/argon2's default algorithm; its `Algorithm` enum is an ambient
 * const enum that isolated modules can't reference, so the default is
 * relied on, and the seed test checks every hash starts with `$argon2id$`.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: PASSWORD_HASHING.memoryCostKiB,
    timeCost: PASSWORD_HASHING.timeCost,
    parallelism: PASSWORD_HASHING.parallelism,
  });
}
