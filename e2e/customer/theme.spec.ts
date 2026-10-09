import { expect, type Page, test } from "@playwright/test";

import { settled } from "../support/pages";

/*
 * The theme menu: a choice overrides the system's light or dark setting,
 * the server renders it into the next page (so the first paint is already
 * right), and "System" hands the decision back.
 */
const look = (page: Page) =>
  page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.body).backgroundColor,
  }));

async function choose(page: Page, theme: "System" | "Light" | "Dark") {
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name: theme }).click();
}

test.describe("on a dark system", () => {
  test.use({ colorScheme: "dark" });

  test("light overrides it, survives a reload, and System hands it back", async ({
    page,
    context,
  }) => {
    await page.goto("/help");
    await settled(page);
    const html = page.locator("html");
    await expect(html).not.toHaveAttribute("data-theme");
    const dark = await look(page);
    expect(dark.colorScheme).toBe("dark");

    await choose(page, "Light");
    await expect(html).toHaveAttribute("data-theme", "light");
    const light = await look(page);
    expect(light.colorScheme).toBe("light");
    expect(light.background).not.toBe(dark.background);
    const cookie = (await context.cookies()).find(
      ({ name }) => name === "dsd_theme",
    );
    expect(cookie).toMatchObject({ value: "light", sameSite: "Lax" });

    const response = await page.reload();
    expect(await response?.text()).toMatch(/<html[^>]* data-theme="light"/);
    await settled(page);
    expect(await look(page)).toEqual(light);
    await page.getByRole("button", { name: "Theme" }).click();
    await expect(
      page.getByRole("menuitemradio", { name: "Light" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await choose(page, "System");
    await expect(html).not.toHaveAttribute("data-theme");
    expect(await look(page)).toEqual(dark);
    expect(
      (await context.cookies()).some(({ name }) => name === "dsd_theme"),
    ).toBe(false);
  });
});

test.describe("on a light system", () => {
  test.use({ colorScheme: "light", viewport: { width: 390, height: 844 } });

  test("dark overrides it, from the header at a phone width", async ({
    page,
  }) => {
    await page.goto("/");
    await settled(page);
    await choose(page, "Dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect((await look(page)).colorScheme).toBe("dark");
  });
});
