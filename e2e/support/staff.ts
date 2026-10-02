import path from "node:path";

import { expect, type Page } from "@playwright/test";

export const STAFF_ROLES = ["agent", "supervisor", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Where the global setup keeps each demo role's signed-in cookies. */
export const staffState = (role: StaffRole) =>
  path.resolve(import.meta.dirname, "../.auth", `${role}.json`);

/** Opens a ticket from the queue by its subject, newest first, so a fresh ticket is near the top. */
export async function openFromQueue(
  page: Page,
  subject: string,
): Promise<void> {
  await page.goto("/queue?status=open&status=pending_customer&sort=newest");
  const tickets = page.getByRole("table", { name: "Tickets" });
  await tickets.getByRole("link", { name: subject }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(subject);
}
