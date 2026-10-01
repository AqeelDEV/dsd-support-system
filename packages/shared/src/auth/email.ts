/**
 * The form an email address is stored and compared in: trimmed and
 * lowercased. Uniqueness, sign-in, guest-link requests and rate limits all
 * use it, so `Ana@Example.com ` and `ana@example.com` are one person.
 *
 * The local part is lowercased too. RFC 5321 allows case-sensitive local
 * parts, but no mainstream provider uses them, and treating two spellings
 * as two people would let one inbox hold two accounts.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
