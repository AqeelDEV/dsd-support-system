import { expect, type Page } from "@playwright/test";

import { emailTo, linkIn } from "./mailpit";

/** A real 1x1 PNG, so the API's byte check (ADR-0009) accepts it. */
export const PNG = {
  name: "router-lights.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
};

/** Submits the public form as a guest and returns the reference shown on the confirmation. */
export async function submitAsGuest(
  page: Page,
  ticket: {
    email: string;
    subject: string;
    description: string;
    withFile?: boolean;
  },
): Promise<string> {
  await page.goto("/new");
  await page.getByLabel("Your email").fill(ticket.email);
  await page.getByLabel("Subject").fill(ticket.subject);
  await page.getByLabel("What happened?").fill(ticket.description);
  if (ticket.withFile === true) {
    await page.locator('input[type="file"]').setInputFiles(PNG);
    await expect(
      page.getByRole("list", { name: "Files to send" }),
    ).toContainText(PNG.name);
  }
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(
    page.getByRole("heading", { name: "We've got your request" }),
  ).toBeVisible();
  const reference = await page
    .getByRole("button", { name: /^Copy reference / })
    .first()
    .textContent();
  return (reference ?? "").trim();
}

/** Opens the guest link from the ticket's confirmation email and lands on the thread. */
export async function openGuestLink(page: Page, email: string): Promise<void> {
  const message = await emailTo(email, /received your request/);
  await page.goto(linkIn(message, "/access"));
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
}
