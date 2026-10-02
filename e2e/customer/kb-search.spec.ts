import { expect, test } from "@playwright/test";

/* FR-4: browse and search the help centre, read an article. */
test("a customer searches the help centre and reads an article", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("searchbox", { name: "Search the help centre" })
    .fill("camera offline");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/help\?q=camera(%20|\+)offline$/);
  const results = page.getByRole("region", { name: /Results for/ });
  await expect(results.locator("mark").first()).toBeVisible();

  await results.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/help\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toContainText("Help centre");
  await expect(
    page.getByRole("link", { name: "Contact support" }).last(),
  ).toBeVisible();
});

test("topics filter the article list", async ({ page }) => {
  await page.goto("/help");
  const topics = page.getByRole("navigation", { name: "Topics" });
  await topics.getByRole("link", { name: /Troubleshooting/ }).click();
  await expect(page).toHaveURL(/category=troubleshooting/);
  await expect(
    page.getByRole("heading", { name: "Troubleshooting" }),
  ).toBeVisible();
  await expect(
    topics.getByRole("link", { name: /Troubleshooting/ }),
  ).toHaveAttribute("aria-current", "page");
});

test("a search with no matches says so and offers support", async ({
  page,
}) => {
  await page.goto("/help?q=zzzqqqxxyy");
  await expect(page.getByText("No articles match")).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Contact support" }),
  ).toBeVisible();
});

test("an unknown article is a clear not-found state", async ({ page }) => {
  await page.goto("/help/no-such-article");
  await expect(page.getByText("This article isn't available")).toBeVisible();
});
