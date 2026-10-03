import { expect, type Page, test } from "@playwright/test";

import { openGuestLink, PNG } from "../support/customer";
import { AGENT_URL, uniqueEmail } from "../support/env";
import { settled, watchConsole } from "../support/pages";
import { openFromQueue, staffState } from "../support/staff";

const PAYLOAD = `<img src=x onerror="window.__xss='img'"><script>window.__xss='script'</script>`;

/** No payload ran: no handler attribute in the DOM, no script added, nothing set. */
async function nothingRan(page: Page): Promise<void> {
  await expect(page.locator("[onerror]")).toHaveCount(0);
  await expect(page.locator("main script")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as { __xss?: string }).__xss),
  ).toBeUndefined();
}

/*
 * NFR-7, stored XSS: what a customer types is shown as text, never run as
 * markup, to the customer and to every agent who opens it. One ticket
 * carries the payloads in each field the customer controls (the suite
 * stays under the per-address submission limit this way).
 */
test("markup a customer types is displayed as text, to them and to agents", async ({
  page,
  browser,
}) => {
  const email = uniqueEmail("xss");
  const subject = `Hello ${email.slice(-20, -12)} ${PAYLOAD}`;
  await page.goto("/new");
  await page.getByLabel("Your email").fill(email);
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("What happened?").fill(`Body ${PAYLOAD}`);
  await page
    .locator('input[type="file"]')
    .setInputFiles({ ...PNG, name: "<img src=x onerror=alert(1)>.png" });
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(
    page.getByRole("heading", { name: "We've got your request" }),
  ).toBeVisible();
  await openGuestLink(page, email);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(subject);
  await expect(page.getByText(`Body ${PAYLOAD}`)).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
  await nothingRan(page);

  // The same ticket in the agent app: queue, ticket and customer page.
  const agent = await browser.newContext({
    baseURL: AGENT_URL,
    storageState: staffState("supervisor"),
  });
  const desk = await agent.newPage();
  const problems = watchConsole(desk);
  await openFromQueue(desk, subject);
  await settled(desk);
  await expect(desk.getByText(`Body ${PAYLOAD}`)).toBeVisible();
  await expect(desk.getByRole("list", { name: "Attachments" })).toContainText(
    "onerror=alert(1)",
  );
  await nothingRan(desk);

  await desk.getByRole("link", { name: email }).first().click();
  await expect(desk).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  await settled(desk);
  await expect(desk.getByRole("link", { name: subject })).toBeVisible();
  await nothingRan(desk);

  await desk.goto("/queue?status=open&sort=newest");
  await settled(desk);
  await expect(
    desk.getByRole("table", { name: "Tickets" }).getByText(subject),
  ).toBeVisible();
  await nothingRan(desk);
  expect(problems).toEqual([]);
  await agent.close();
});
