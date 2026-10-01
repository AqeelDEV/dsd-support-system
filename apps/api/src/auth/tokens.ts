import { createHash, randomBytes } from "node:crypto";

/** 256 bits: far beyond guessing, so a fast hash is enough to store it (ADR-0003). */
const TOKEN_BYTES = 32;

/**
 * A new secret for a session cookie or an emailed link: 32 bytes from the
 * operating system's secure generator, base64url-encoded (43 characters).
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * What the database stores instead of the token. SHA-256 rather than a
 * slow hash: a 256-bit random token can't be brute-forced from its hash,
 * and a fast hash lets every request find its session by an indexed lookup.
 */
export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
