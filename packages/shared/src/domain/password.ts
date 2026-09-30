/**
 * Password rules (ADR-0003, section 3). Length only, no composition rules,
 * as NIST SP 800-63B advises; the upper bound stops a huge "password" being
 * used to burn CPU on hashing.
 */
export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
} as const;

/**
 * argon2id cost parameters: the OWASP baseline of 19 MiB, 2 iterations,
 * 1 lane. They are stored inside each hash, so raising them later only
 * affects new hashes, and old ones can be upgraded at the next login.
 * Defined once so the seed and the API's hasher can't disagree.
 */
export const PASSWORD_HASHING = {
  memoryCostKiB: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
