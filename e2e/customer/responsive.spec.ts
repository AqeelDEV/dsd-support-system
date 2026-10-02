import { expect, test } from "@playwright/test";

import {
  CUSTOMER_PAGES,
  noHorizontalOverflow,
  watchConsole,
  settled,
} from "../support/pages";

/*
 * UI-1: every customer page works at a phone width and a desktop width,
 * with no sideways scrolling, and loads without a CSP violation or a
 * script error (NFR-7).
 */
for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const path of CUSTOMER_PAGES) {
      test(`${path} fits the screen and runs cleanly`, async ({ page }) => {
        const problems = watchConsole(page);
        await page.goto(path);
        await settled(page);
        expect(await noHorizontalOverflow(page)).toBe(true);
        expect(problems).toEqual([]);
      });
    }
  });
}

test("the phone menu reaches every main page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  for (const item of [
    "Contact support",
    "Help centre",
    "Find a request",
    "Sign in",
  ]) {
    await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "Help centre" }).click();
  await expect(page).toHaveURL(/\/help$/);
});
