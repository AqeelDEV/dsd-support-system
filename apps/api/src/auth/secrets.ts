import { createHmac } from "node:crypto";

/**
 * A separate key for each use of AUTH_SECRET, so a value computed for one
 * purpose (a CSRF token) can never be replayed as another (a rate-limit
 * key). HMAC-SHA256 with the purpose as the message is a standard
 * single-step key derivation for a high-entropy secret.
 */
export function deriveKey(secret: string, purpose: string): Buffer {
  return createHmac("sha256", secret).update(purpose, "utf8").digest();
}
