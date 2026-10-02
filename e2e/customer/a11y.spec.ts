import { expect, test } from "@playwright/test";

import { uniqueEmail } from "../support/env";
import {
  accessibilityViolations,
  CUSTOMER_PAGES,
  settled,
} from "../support/pages";

/* UI-2: real labels, contrast and keyboard use, checked with axe. */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const path of CUSTOMER_PAGES) {
      test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(path);
        await settled(page);
        expect(await accessibilityViolations(page)).toEqual([]);
      });
    }
  });
}

test("a request can be sent using only the keyboard", async ({ page }) => {
  await page.goto("/new");
  await settled(page);

  // The skip link comes first, then the page.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");

  const email = page.getByLabel("Your email");
  while (
    !(await email.evaluate((element) => element === document.activeElement))
  ) {
    await page.keyboard.press("Tab");
  }
  await page.keyboard.type(uniqueEmail("keyboard"));
  await page.keyboard.press("Tab"); // the "Sign in" link in the hint
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Subject")).toBeFocused();
  await page.keyboard.type("Sent without a mouse");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("What happened?")).toBeFocused();
  await page.keyboard.type("Every step of this form works from the keyboard.");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Add files/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Send request" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "We've got your request" }),
  ).toBeVisible();
});
