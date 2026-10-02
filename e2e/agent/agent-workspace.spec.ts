import { expect, test } from "@playwright/test";

import { openGuestLink, submitAsGuest } from "../support/customer";
import {
  AGENT_URL,
  CUSTOMER_URL,
  freshContext,
  uniqueEmail,
} from "../support/env";
import { openFromQueue, staffState } from "../support/staff";

test.use({ baseURL: AGENT_URL, storageState: staffState("agent") });

/*
 * The agent's tools on one ticket (FR-9, FR-10, FR-11, UC-6), and the
 * guarantee that an internal note never reaches the customer.
 */
test("notes, priority, assignment and escalation, with the note kept from the customer", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("tools");
  const subject = `Smart plug won't pair ${email.slice(4, 12)}`;
  const customer = await freshContext(browser, CUSTOMER_URL);
  const customerPage = await customer.newPage();
  await submitAsGuest(customerPage, {
    email,
    subject,
    description: "The plug blinks red and never pairs.",
  });

  await openFromQueue(page, subject);

  // An internal note: amber, marked, and only for staff.
  await page.keyboard.press("n");
  const note =
    "Looks like the known pairing bug on firmware 2.1. Check with engineering.";
  await page.getByLabel("Internal note").fill(note);
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(page.getByText("Note added")).toBeVisible();
  const thread = page.getByRole("list", { name: "Conversation" });
  await expect(
    thread
      .getByRole("article")
      .filter({ hasText: note })
      .getByText("Internal note"),
  ).toBeVisible();

  await page.getByLabel("Priority").selectOption("urgent");
  await expect(thread.getByText("Priority set to Urgent")).toBeVisible();

  await page.getByRole("button", { name: "Assign to a colleague" }).click();
  const colleagues = page.getByRole("list", { name: "Colleagues" });
  const someone = colleagues
    .getByRole("button", { name: /^(?!.*\(you\)).*, / })
    .first();
  const label = (await someone.getAttribute("aria-label")) ?? "";
  const name = label.slice(0, label.lastIndexOf(","));
  await someone.click();
  await expect(page.getByText(`Assigned to ${name}`).first()).toBeVisible();

  await page.getByRole("button", { name: "Escalate" }).click();
  await page
    .getByLabel("Reason")
    .fill("Customer has tried every step; needs an engineering ticket.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Escalate" })
    .click();
  await expect(page.getByText("Escalated").first()).toBeVisible();

  // The activity tab lists every change, with who made it.
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByRole("list", { name: "Activity" })).toContainText(
    "Added an internal note",
  );

  // The customer never sees the note.
  await openGuestLink(customerPage, email);
  await expect(customerPage.getByRole("heading", { level: 1 })).toHaveText(
    subject,
  );
  await expect(customerPage.getByText(note)).toHaveCount(0);
  await expect(customerPage.getByText("engineering")).toHaveCount(0);
  await customer.close();
});

test("the queue works from the keyboard and its filters live in the address", async ({
  page,
}) => {
  await page.goto("/queue");
  await expect(page.getByRole("heading", { name: "All open" })).toBeVisible();
  await page.getByRole("link", { name: "Unassigned" }).click();
  await expect(page).toHaveURL(/assignee=unassigned/);
  await page.getByLabel("Sort").selectOption("oldest");
  await expect(page).toHaveURL(/sort=oldest/);

  await page.goto("/queue");
  const first = page
    .getByRole("table", { name: "Tickets" })
    .getByRole("row")
    .nth(1);
  const subject = (await first.getByRole("link").textContent()) ?? "";
  await page.locator("body").press("j");
  await page.locator("body").press("k");
  await page.locator("body").press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    subject.trim(),
  );

  await page.locator("body").press("?");
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
});
