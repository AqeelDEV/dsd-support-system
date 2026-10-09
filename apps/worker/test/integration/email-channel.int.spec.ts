import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { EmailChannel } from "../../src/notifications/email-channel.js";
import { emailsTo, eventually } from "../support/worker.js";

/*
 * Mailpit offers no STARTTLS, which is exactly a server, or a connection
 * tampered with on the way, that would carry the credentials in clear.
 */
const MAILPIT = {
  SMTP_HOST: process.env.TEST_SMTP_HOST ?? "127.0.0.1",
  SMTP_PORT: Number(process.env.TEST_SMTP_PORT ?? "1025"),
  SMTP_SECURE: false,
  SMTP_USER: "mailer",
  SMTP_PASSWORD: "not-a-real-password",
};

const FROM = { name: "DSD Support", address: "support@dsd.example" };

function message(subject: string) {
  return { subject, text: "Hello", html: "<p>Hello</p>" };
}

describe("email channel", () => {
  it("refuses to send when STARTTLS is required and the server doesn't offer it", async () => {
    const channel = new EmailChannel({ ...MAILPIT, SMTP_REQUIRE_TLS: true });
    const to = `require-tls-${randomUUID()}@example.com`;
    try {
      await expect(
        channel.send(to, FROM, message("Must not arrive")),
      ).rejects.toMatchObject({ code: "ETLS" });
    } finally {
      channel.close();
    }
    expect(await emailsTo(to)).toEqual([]);
  });

  it("sends over a plain connection when STARTTLS isn't required", async () => {
    const channel = new EmailChannel({ ...MAILPIT, SMTP_REQUIRE_TLS: false });
    const to = `plain-${randomUUID()}@example.com`;
    try {
      await channel.send(to, FROM, message("Arrives"));
    } finally {
      channel.close();
    }
    const emails = await eventually(async () => {
      const found = await emailsTo(to);
      return found.length > 0 ? found : undefined;
    });
    expect(emails.map((email) => email.subject)).toEqual(["Arrives"]);
  });
});
