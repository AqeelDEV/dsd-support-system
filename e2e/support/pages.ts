import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The customer pages anyone can open, for the layout and accessibility checks. */
export const CUSTOMER_PAGES = [
  "/",
  "/help",
  "/help?q=camera",
  "/help/harbor-camera-offline",
  "/new",
  "/find-ticket",
  "/sign-in",
  "/signup",
  "/forgot-password",
];

/**
 * Waits until the page has drawn its data: the main region is there and no
 * loading skeleton is left. (Waiting for the network to go quiet is fragile:
 * Next.js prefetches links in the background.)
 */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".animate-pulse")).toHaveCount(0);
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
}

/** Whether the page fits its viewport without scrolling sideways (UI-1). */
export const noHorizontalOverflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );

/**
 * Collects script errors and CSP violations while a page loads. Failed API
 * calls the page expects (401 from `me` when nobody is signed in) are
 * network errors, not script errors, and aren't counted.
 */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      !text.startsWith("Failed to load resource")
    ) {
      problems.push(text);
    }
    if (/Content Security Policy/i.test(text)) problems.push(text);
  });
  return problems;
}

/** WCAG 2.1 A and AA violations axe finds on the page (UI-2). */
export async function accessibilityViolations(
  page: Page,
): Promise<
  { rule: string; impact: string | null | undefined; nodes: string[] }[]
> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}
