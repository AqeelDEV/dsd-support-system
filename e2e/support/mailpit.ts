import { expect } from "@playwright/test";

import { MAILPIT_URL } from "./env";

interface Summary {
  ID: string;
  Subject: string;
}

export interface Email {
  subject: string;
  text: string;
}

/**
 * Waits for the newest email to `address` whose subject matches, through
 * Mailpit's API. Emails are sent by the worker from the outbox, so they
 * arrive a moment after the request that caused them.
 */
export async function emailTo(
  address: string,
  subject: RegExp,
): Promise<Email> {
  let found: Summary | undefined;
  // Set by the poll below before it passes.
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${address}"`);
        const response = await fetch(
          `${MAILPIT_URL}/api/v1/search?query=${query}`,
        );
        const body = (await response.json()) as { messages?: Summary[] };
        found = body.messages?.find((message) => subject.test(message.Subject));
        return found !== undefined;
      },
      {
        timeout: 30_000,
        message: `an email to ${address} matching ${subject}`,
      },
    )
    .toBe(true);
  const id = found?.ID ?? "";
  const message = (await (
    await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)
  ).json()) as {
    Subject: string;
    Text: string;
  };
  return { subject: message.Subject, text: message.Text };
}

/**
 * A link from an email, as a path on the app under test. Emails link to
 * the configured app URL; the path and fragment are what matter, so the
 * browser stays on the host its cookies belong to.
 */
export function linkIn(email: Email, path: string): string {
  const match = new RegExp(
    `https?://[^\\s"<>]+${path.replaceAll("/", "\\/")}[^\\s"<>)]*`,
  ).exec(email.text);
  if (match === null) throw new Error(`No ${path} link in "${email.subject}"`);
  const url = new URL(match[0]);
  return `${url.pathname}${url.search}${url.hash}`;
}
