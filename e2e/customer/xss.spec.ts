import { expect, test } from "@playwright/test";

import { openGuestLink, submitAsGuest } from "../support/customer";
import { uniqueEmail } from "../support/env";

const PAYLOAD = `<img src=x onerror="window.__xss='img'"><script>window.__xss='script'</script>`;

/* NFR-7: what a customer types is shown as text, never run as markup. */
test("markup in a subject and description is displayed as text", async ({
  page,
}) => {
  const email = uniqueEmail("xss");
  await submitAsGuest(page, {
    email,
    subject: `Hello ${PAYLOAD}`,
    description: `Body ${PAYLOAD}`,
  });
  await openGuestLink(page, email);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Hello ${PAYLOAD}`,
  );
  await expect(page.getByText(`Body ${PAYLOAD}`)).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as { __xss?: string }).__xss),
  ).toBeUndefined();
});
