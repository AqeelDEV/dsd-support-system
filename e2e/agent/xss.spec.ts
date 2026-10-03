import { expect, test } from "@playwright/test";

import { AGENT_URL, uniqueEmail } from "../support/env";
import { watchConsole } from "../support/pages";
import { staffState } from "../support/staff";

/*
 * NFR-7 in the knowledge-base editor: its live preview renders markdown the
 * author hasn't saved yet (and the API hasn't sanitised), so it must drop
 * raw HTML and script links itself. Customers' text in the agent app is
 * checked in customer/xss.spec.ts, on the same ticket the customer sees.
 */
test.use({ baseURL: AGENT_URL, storageState: staffState("supervisor") });

test("an article's raw HTML and script links are never rendered in the editor's preview", async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.goto("/kb/new");
  await page.getByLabel("Title").fill(`Preview check ${uniqueEmail("kb")}`);
  await page
    .getByLabel("Body (markdown)")
    .fill(
      `## Steps\n\nRestart the hub. <img src=x onerror="window.__xss='img'"><script>window.__xss='script'</script>\n\n[Open settings](javascript:window.__xss='link')\n\n<a href="javascript:window.__xss='a'">Raw link</a>`,
    );
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByRole("heading", { name: "Steps" })).toBeVisible();
  await expect(preview.getByText("Open settings")).toBeVisible();
  await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(preview.locator("img, script")).toHaveCount(0);
  await expect(page.locator("[onerror]")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as { __xss?: string }).__xss),
  ).toBeUndefined();
  expect(problems).toEqual([]);
});
