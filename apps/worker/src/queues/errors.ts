/**
 * A job that can never succeed, such as a payload that doesn't match its
 * event's schema. Retrying won't help, so it is dead-lettered at once.
 */
export class InvalidEventError extends Error {
  override name = "InvalidEventError";
}
