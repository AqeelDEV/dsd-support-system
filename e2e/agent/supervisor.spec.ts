import { expect, test } from "@playwright/test";

import {
  AGENT_URL,
  CUSTOMER_URL,
  freshContext,
  uniqueEmail,
} from "../support/env";
import { emailTo, linkIn } from "../support/mailpit";
import { staffState } from "../support/staff";

test.use({ baseURL: AGENT_URL, storageState: staffState("supervisor") });

/* FR-13: the reporting dashboard draws the API's figures. */
test("reports show volume, response times and tickets per agent", async ({
  page,
}) => {
  await page.goto("/reports");
  await expect(
    page.getByText("Tickets received", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("First response (median)")).toBeVisible();
  await expect(
    page.getByRole("table", { name: /Tickets received per day/ }),
  ).toBeAttached();
  await page.getByRole("link", { name: "By week" }).click();
  await expect(page).toHaveURL(/interval=week/);
  await expect(
    page.getByRole("table", { name: /Tickets received per week/ }),
  ).toBeAttached();
  await page.getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/range=7/);
});

/* FR-14 and the agent invite email: invite, accept, sign in, change role. */
test("a supervisor invites a colleague who joins from the email", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("invite");
  await page.goto("/team");
  await page.getByRole("button", { name: "Invite a colleague" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Work email").fill(email);
  await dialog.getByLabel("Name").fill("Jordan Example");
  await dialog.getByLabel("Role").selectOption("agent");
  await dialog.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invite sent to ${email}`)).toBeVisible();
  const row = page
    .getByRole("list", { name: "Colleagues" })
    .getByRole("listitem")
    .filter({ hasText: email });
  await expect(row.getByText("Invited")).toBeVisible();

  const invite = await emailTo(email, /invited/);
  const newcomer = await freshContext(browser, AGENT_URL);
  const newcomerPage = await newcomer.newPage();
  await newcomerPage.goto(linkIn(invite, "/invite"));
  await newcomerPage
    .getByLabel("Password", { exact: true })
    .fill("a long enough passphrase");
  await newcomerPage
    .getByRole("button", { name: "Set password and sign in" })
    .click();
  await expect(newcomerPage).toHaveURL(/\/queue/);
  const nav = newcomerPage.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Queue" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Team" })).toHaveCount(0);
  await newcomer.close();

  await page.reload();
  await row.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Change role" }).click();
  await page.getByRole("dialog").getByLabel("Role").selectOption("supervisor");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(row.getByText("Supervisor")).toBeVisible();
});

/* FR-15: write, publish, and find the article in the help centre. */
test("a supervisor writes and publishes an article that customers can read", async ({
  page,
  browser,
}) => {
  const title = `Pairing a Smart Plug ${uniqueEmail("kb").slice(7, 15)}`;
  await page.goto("/kb/new");
  await page.getByLabel("Title").fill(title);
  await page
    .getByLabel("Summary")
    .fill("How to pair the plug with the hub in under a minute.");
  await page
    .getByLabel("Body (markdown)")
    .fill(
      "## Before you start\n\nHold the button for **5 seconds**.<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))",
    );
  await expect(
    page
      .getByRole("region", { name: "Preview" })
      .getByRole("heading", { name: "Before you start" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/kb\/[0-9a-f-]{36}\?markup=removed$/);
  await expect(
    page.getByText("Some markup was removed when saving"),
  ).toBeVisible();
  await expect(page.getByLabel("Body (markdown)")).not.toHaveValue(/<script>/);

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/Published as version 1/)).toBeVisible();

  const customer = await freshContext(browser, CUSTOMER_URL);
  const customerPage = await customer.newPage();
  await customerPage.goto(`/help?q=${encodeURIComponent(title)}`);
  await customerPage.getByRole("link", { name: title }).click();
  await expect(customerPage.getByRole("heading", { level: 1 })).toHaveText(
    title,
  );
  await expect(customerPage.getByText("Unsafe")).toBeVisible();
  await expect(customerPage.getByRole("link", { name: "Unsafe" })).toHaveCount(
    0,
  );
  await customer.close();
});
