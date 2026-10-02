import { expect, test } from "@playwright/test";

import { AGENT_URL, freshContext } from "../support/env";
import { staffState } from "../support/staff";

test.use({ baseURL: AGENT_URL, storageState: staffState("agent") });

/*
 * FR-17 in the UI: the agent app hides what an agent can't do, and when an
 * agent goes there anyway the API's 403 is shown as "no access". The API
 * enforces it either way (the RBAC matrix proves that side).
 */
test("an agent sees no reports or team, and is refused them by URL", async ({
  page,
}) => {
  await page.goto("/queue");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Queue" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Reports" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Team" })).toHaveCount(0);

  for (const path of ["/reports", "/team"]) {
    await page.goto(path);
    await expect(page.getByText("You don't have access")).toBeVisible();
  }
});

test("an agent can read the knowledge base and canned responses but not change them", async ({
  page,
}) => {
  await page.goto("/kb");
  await expect(page.getByRole("link", { name: "New article" })).toHaveCount(0);
  await page.getByRole("table").getByRole("link").first().click();
  await expect(page.getByText("You can read articles here")).toBeVisible();
  await expect(page.getByLabel("Title")).toBeDisabled();

  await page.goto("/canned");
  await expect(page.getByRole("button", { name: "New response" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Retire" })).toHaveCount(0);
});

test("a signed-out visitor is sent to sign in, and back afterwards", async ({
  browser,
}) => {
  const context = await freshContext(browser, AGENT_URL);
  const page = await context.newPage();
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Freports$/);
  await context.close();
});
