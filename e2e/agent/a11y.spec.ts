import { expect, type Locator, type Page, test } from "@playwright/test";

import { AGENT_URL, freshContext } from "../support/env";
import { accessibilityViolations, settled } from "../support/pages";
import { staffState } from "../support/staff";

/*
 * UI-2 in the states the page-by-page checks in layout.spec.ts don't reach:
 * open dialogs and menus, the AI panel with a draft, the customer page, an
 * existing article and the invite page. Plus the keyboard: dialogs keep
 * focus inside and hand it back when they close, an agent can reply and
 * insert a draft without a mouse, and the panel announces its changes.
 */
test.use({ baseURL: AGENT_URL, storageState: staffState("supervisor") });

/** A seeded open ticket whose subject the knowledge base covers, so the mock drafts for it. */
async function openGroundedTicket(page: Page): Promise<void> {
  await page.goto("/queue?status=open&status=pending_customer&sort=oldest");
  await settled(page);
  await page
    .getByRole("table", { name: "Tickets" })
    .getByRole("link", {
      name: /Charged twice|Refund for my returned|won't connect to Wi-Fi|offline since the latest update/,
    })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await settled(page);
}

/** Tabs through a dialog and checks focus never leaves it. */
async function focusStaysIn(page: Page, dialog: Locator): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
}

test("ticket dialogs, pickers and the shortcuts sheet pass axe and keep focus", async ({
  page,
}) => {
  await openGroundedTicket(page);

  const escalate = page.getByRole("button", { name: "Escalate" });
  await escalate.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Reason")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await focusStaysIn(page, dialog);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(escalate).toBeFocused();

  await page.getByRole("button", { name: "Assign to a colleague" }).click();
  await expect(page.getByRole("list", { name: "Colleagues" })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Canned response" }).click();
  await expect(
    page.getByRole("list", { name: "Canned responses" }),
  ).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await page.locator("body").press("?");
  const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(shortcuts).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(shortcuts).toHaveCount(0);
});

test("the AI panel with a draft passes axe, announces it, and a draft goes into the reply by keyboard", async ({
  page,
}) => {
  await openGroundedTicket(page);
  const assist = page.getByRole("region", { name: "Suggested reply" });
  // Changes to the panel are announced politely to screen readers.
  await expect(assist.locator('[aria-live="polite"]')).toHaveCount(1);
  await assist.getByRole("button", { name: /^(Generate|Regenerate)$/ }).click();
  const insert = assist.getByRole("button", { name: "Insert into reply" });
  await expect(insert).toBeEnabled({ timeout: 30_000 });
  // While a newer draft is written, the old one stays readable.
  expect(await accessibilityViolations(page)).toEqual([]);
  await expect(assist.getByRole("status")).toHaveCount(0, { timeout: 30_000 });
  expect(await accessibilityViolations(page)).toEqual([]);

  await insert.focus();
  await page.keyboard.press("Enter");
  const composer = page.getByLabel("Reply to the customer");
  await expect(composer).not.toHaveValue("");
  await expect(page.getByText("Based on an AI suggestion")).toBeVisible();
});

test("an agent replies with the keyboard alone", async ({ page }) => {
  await openGroundedTicket(page);
  const composer = page.getByLabel("Reply to the customer");
  // A shortcut pressed while the page is still wiring its listeners does
  // nothing, as in any app; press it again until it lands, but never into
  // a composer that already has focus.
  await expect(async () => {
    if (!(await composer.evaluate((el) => el === document.activeElement))) {
      await page.keyboard.press("r");
    }
    await expect(composer).toBeFocused({ timeout: 1_000 });
  }).toPass();
  await page.keyboard.type(
    "Thanks, I'm checking this now and will update you.",
  );
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Reply sent")).toBeVisible();
});

test("the team page's dialogs and menus pass axe and hand focus back", async ({
  page,
}) => {
  await page.goto("/team");
  await settled(page);
  const invite = page.getByRole("button", { name: "Invite a colleague" });
  await invite.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Work email")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await focusStaysIn(page, dialog);
  await page.keyboard.press("Escape");
  await expect(invite).toBeFocused();

  const actions = page.getByRole("button", { name: /Actions for/ }).first();
  await actions.click();
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.getByRole("menuitem", { name: "Change role" }).click();
  await expect(page.getByRole("dialog").getByLabel("Role")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Opened from a menu, it hands focus back to the menu's button.
  await expect(actions).toBeFocused();
});

test("the customer page and an existing article pass axe", async ({ page }) => {
  await openGroundedTicket(page);
  await page.locator('a[href^="/customers/"]').first().click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  await settled(page);
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.goto("/kb");
  await settled(page);
  await page
    .locator(
      'a[href^="/kb/"]:not([href="/kb/new"]):not([href="/kb/categories"])',
    )
    .first()
    .click();
  await expect(page.getByLabel("Body (markdown)")).toBeVisible();
  await settled(page);
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("the navigation sheet on a phone passes axe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/queue");
  await settled(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("the invite page passes axe, even with no link", async ({ browser }) => {
  const visitor = await freshContext(browser, AGENT_URL);
  const page = await visitor.newPage();
  await page.goto("/invite");
  await settled(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await visitor.close();
});
