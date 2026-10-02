import { expect, type Page, test } from "@playwright/test";

import { uniqueEmail } from "../support/env";
import { emailTo, linkIn } from "../support/mailpit";

const PASSWORD = "a long enough passphrase";

async function signUp(page: Page, email: string, name: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  const message = await emailTo(email, /Finish creating your .* account/);
  await page.goto(linkIn(message, "/signup/complete"));
  // The token is read from the fragment and then removed from the address bar.
  await expect(page).toHaveURL(/\/signup\/complete$/);
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
}

/*
 * FR-2: an account from an emailed link; the customer's requests in one
 * place; signing out and in again; and a forgotten password.
 */
test("a customer signs up, raises a request, signs out and back in", async ({
  page,
}) => {
  const email = uniqueEmail("account");
  await signUp(page, email, "Robin Example");
  await expect(page.getByText("No requests yet")).toBeVisible();

  await page.getByRole("link", { name: "New request" }).click();
  await expect(page.getByText(`We'll reply to ${email}.`)).toBeVisible();
  await page.getByLabel("Subject").fill("Doorbell chime is very quiet");
  await page
    .getByLabel("What happened?")
    .fill("Volume is at maximum but it's hard to hear.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Doorbell chime is very quiet",
  );

  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto("/tickets");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Ftickets$/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByText("Doorbell chime is very quiet")).toBeVisible();
});

test("a wrong password is refused with a clear message", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(uniqueEmail("nobody"));
  await page.getByLabel("Password", { exact: true }).fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("The email or password is wrong")).toBeVisible();
});

test("a customer resets a forgotten password from the email", async ({
  page,
}) => {
  const email = uniqueEmail("reset");
  await signUp(page, email, "Sam Example");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  const message = await emailTo(email, /Reset your .* password/);
  await page.goto(linkIn(message, "/reset-password"));
  await page.getByLabel("New password").fill("a different long passphrase");
  await page.getByRole("button", { name: "Save password and sign in" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByText("Password changed")).toBeVisible();
});

test("validation explains each field in plain words", async ({ page }) => {
  await page.goto("/new");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(
    page.getByText("Enter the email address we should reply to."),
  ).toBeVisible();
  await expect(
    page.getByText("Add a short summary, up to 200 characters."),
  ).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});
