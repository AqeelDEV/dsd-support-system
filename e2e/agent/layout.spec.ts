import { expect, test } from "@playwright/test";

import { AGENT_URL, freshContext } from "../support/env";
import {
  accessibilityViolations,
  noHorizontalOverflow,
  settled,
  watchConsole,
} from "../support/pages";
import { staffState } from "../support/staff";

/*
 * UI-1 and UI-2 for the agent app: every section at a phone and a desktop
 * width with no sideways scrolling, no CSP violation or script error, and
 * no WCAG A/AA violation in light or dark.
 */
const PAGES = [
  "/queue",
  "/kb",
  "/kb/new",
  "/kb/categories",
  "/canned",
  "/reports",
  "/team",
];

test.use({ baseURL: AGENT_URL, storageState: staffState("supervisor") });

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const path of [...PAGES, "ticket"]) {
      test(`${path} fits and runs cleanly`, async ({ page }) => {
        const problems = watchConsole(page);
        if (path === "ticket") {
          await page.goto("/queue");
          await settled(page);
          await page.locator('a[href^="/tickets/"]:visible').first().click();
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        } else {
          await page.goto(path);
        }
        await settled(page);
        expect(await noHorizontalOverflow(page)).toBe(true);
        expect(problems).toEqual([]);
      });
    }
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const path of [...PAGES, "ticket"]) {
      test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
        if (path === "ticket") {
          await page.goto("/queue");
          await settled(page);
          await page.locator('a[href^="/tickets/"]:visible').first().click();
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        } else {
          await page.goto(path);
        }
        await settled(page);
        expect(await accessibilityViolations(page)).toEqual([]);
      });
    }
  });
}

test("the phone menu opens the sections", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/queue");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/reports/);
});

test("the theme menu is in the sidebar and in the phone bar", async ({
  page,
}) => {
  await page.goto("/queue");
  await settled(page);
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
});

test("the sign-in page is accessible", async ({ browser }) => {
  const context = await freshContext(browser, AGENT_URL);
  const page = await context.newPage();
  await page.goto("/sign-in");
  await settled(page);
  expect(await accessibilityViolations(page)).toEqual([]);
  await context.close();
});
