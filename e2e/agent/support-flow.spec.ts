import { expect, test } from "@playwright/test";

import { openGuestLink, submitAsGuest } from "../support/customer";
import {
  AGENT_URL,
  CUSTOMER_URL,
  freshContext,
  uniqueEmail,
} from "../support/env";
import { emailTo, linkIn } from "../support/mailpit";
import { openFromQueue, staffState } from "../support/staff";

/*
 * The whole support loop across both apps (FR-1, FR-3, FR-5, FR-8, FR-9,
 * FR-12): a customer asks, an agent picks the ticket up, answers with a
 * canned response and waits on the customer, the customer reads the reply
 * from the email, and the agent resolves the ticket.
 */
test("a customer's request is answered by an agent and resolved", async ({
  browser,
}) => {
  const email = uniqueEmail("loop");
  const subject = `Thermostat schedule resets ${email.slice(4, 12)}`;

  const customer = await freshContext(browser, CUSTOMER_URL);
  const customerPage = await customer.newPage();
  await submitAsGuest(customerPage, {
    email,
    subject,
    description:
      "Every morning the heating schedule is back to the factory default.",
  });

  const agent = await browser.newContext({
    baseURL: AGENT_URL,
    storageState: staffState("agent"),
  });
  const agentPage = await agent.newPage();
  await openFromQueue(agentPage, subject);
  await expect(agentPage.getByText("Unverified contact")).toBeVisible();

  await agentPage.getByRole("button", { name: "Take it" }).click();
  await expect(agentPage.getByText("It's yours")).toBeVisible();

  await agentPage.getByRole("button", { name: "Canned response" }).click();
  await agentPage
    .getByRole("list", { name: "Canned responses" })
    .getByRole("button")
    .first()
    .click();
  const composer = agentPage.getByLabel("Reply to the customer");
  await expect(composer).not.toHaveValue("");
  // The template was filled in for this ticket: no variables are left.
  await expect(composer).not.toHaveValue(/\{\{/);
  await composer.press("End");
  await composer.pressSequentially(
    "\n\nCould you tell us which firmware version the app shows?",
  );
  await agentPage
    .getByLabel("Then")
    .selectOption({ label: "Set Awaiting customer" });
  await agentPage.getByRole("button", { name: /^Send/ }).click();
  await expect(agentPage.getByText("Reply sent")).toBeVisible();
  await expect(
    agentPage.getByRole("main").getByText("Awaiting customer").first(),
  ).toBeVisible();

  // The customer hears about it by email and reads the reply in the thread.
  const reply = await emailTo(email, /New reply/);
  expect(reply.text).toContain("which firmware version");
  await customerPage.goto(linkIn(reply, "/access"));
  await expect(customerPage.getByText("which firmware version")).toBeVisible();
  await expect(
    customerPage.getByText("Awaiting your reply").first(),
  ).toBeVisible();

  await agentPage.getByLabel("Status").selectOption({ label: "Resolved" });
  await expect(agentPage.getByText("Status set to Resolved")).toBeVisible();
  await customerPage.reload();
  await expect(customerPage.getByText("Resolved").first()).toBeVisible();

  await customer.close();
  await agent.close();
});

test("an emailed guest link and the agent's thread agree on the conversation", async ({
  browser,
}) => {
  const email = uniqueEmail("agree");
  const subject = `Doorbell offline ${email.slice(4, 12)}`;
  const customer = await freshContext(browser, CUSTOMER_URL);
  const customerPage = await customer.newPage();
  await submitAsGuest(customerPage, {
    email,
    subject,
    description: "It shows offline in the app.",
  });
  await openGuestLink(customerPage, email);
  await customerPage
    .getByLabel("Reply")
    .fill("It came back for a minute, then dropped again.");
  await customerPage.getByRole("button", { name: "Send reply" }).click();
  await expect(customerPage.getByLabel("Reply")).toHaveValue("");

  const agent = await browser.newContext({
    baseURL: AGENT_URL,
    storageState: staffState("agent"),
  });
  const agentPage = await agent.newPage();
  await openFromQueue(agentPage, subject);
  const thread = agentPage.getByRole("list", { name: "Conversation" });
  await expect(thread.getByText("It shows offline in the app.")).toBeVisible();
  await expect(thread.getByText("It came back for a minute")).toBeVisible();
  // Opening the emailed link verified the contact.
  await expect(agentPage.getByText("Verified email")).toBeVisible();
  await customer.close();
  await agent.close();
});
