import { expect, test } from "@playwright/test";

import { openGuestLink, PNG, submitAsGuest } from "../support/customer";
import { uniqueEmail } from "../support/env";

/*
 * FR-1, FR-2, FR-3: a guest submits a request with a file, opens it from
 * the emailed link, sees the thread and replies.
 */
test("a guest submits a request with a file, opens it from the email and replies", async ({
  page,
}) => {
  const email = uniqueEmail("guest");
  const reference = await submitAsGuest(page, {
    email,
    subject: "Hub keeps dropping off Wi-Fi",
    description: "Since Tuesday the hub disconnects every evening around 9pm.",
    withFile: true,
  });
  expect(reference).toMatch(/^DSD-\d{6,}$/);
  await expect(page.getByText(email)).toBeVisible();

  await openGuestLink(page, email);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Hub keeps dropping off Wi-Fi",
  );
  await expect(
    page.getByText("Since Tuesday the hub disconnects"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(PNG.name) }),
  ).toBeVisible();
  await expect(
    page.getByText("You opened this request from an email link"),
  ).toBeVisible();

  await page.getByLabel("Reply").fill("It happened again tonight at 9:05pm.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(
    page
      .getByRole("list", { name: "Conversation" })
      .getByText("It happened again tonight"),
  ).toBeVisible();
  await expect(page.getByLabel("Reply")).toHaveValue("");
});

test("an expired or broken link explains itself and offers a new one", async ({
  page,
}) => {
  await page.goto(`/access#token=${"x".repeat(43)}`);
  await expect(
    page.getByText("This link has expired or was already used"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Get a new link" }).click();
  await expect(page).toHaveURL(/\/find-ticket$/);
});

test("a guest asks for a new link with their reference", async ({ page }) => {
  const email = uniqueEmail("relink");
  const reference = await submitAsGuest(page, {
    email,
    subject: "Where is my order?",
    description: "Order 5908-2211 hasn't moved for a week.",
  });

  await page.goto("/find-ticket");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Reference").fill(reference.toLowerCase());
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
});
