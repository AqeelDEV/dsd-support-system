/** The longest retrieval query: enough for any real ticket's gist, small enough to embed cheaply. */
export const QUERY_MAX_CHARS = 2_000;

/** How many of the customer's latest messages join the query. */
export const QUERY_MESSAGES = 2;

/**
 * What retrieval searches with (ADR-0006, section 4): the subject, the
 * customer's latest messages (newest first, because they say what is
 * being asked now) and the description, cut to a fixed length.
 */
export function retrievalQuery(ticket: {
  subject: string;
  description: string;
  customerMessages: readonly string[];
}): string {
  const latest = ticket.customerMessages.slice(-QUERY_MESSAGES).reverse();
  const query = [ticket.subject, ...latest, ticket.description]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n");
  return query.length <= QUERY_MAX_CHARS
    ? query
    : query.slice(0, QUERY_MAX_CHARS);
}
