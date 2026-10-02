import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  type BrowserContextOptions,
  expect,
  type Page,
  request,
  test,
} from "@playwright/test";

import { AGENT_URL, CUSTOMER_URL, DEMO } from "./support/env";
import { settled } from "./support/pages";
import { staffState } from "./support/staff";

/*
 * Screenshots of the key screens for the README (docs/screenshots). Run
 * with `pnpm screenshots` against a freshly seeded stack. With
 * SCREENSHOT_REVIEW=1, every screen is also captured at both widths in
 * both themes into e2e/test-results/review, for the design review at the
 * end of each phase (ADR-0013).
 */

const DOCS = path.resolve(import.meta.dirname, "../docs/screenshots");
const REVIEW = path.resolve(import.meta.dirname, "test-results/review");
const reviewing = process.env.SCREENSHOT_REVIEW === "1";

interface Shot {
  name: string;
  signedIn?: boolean;
  /** Signed in as the demo supervisor, in the agent app. */
  staff?: boolean;
  /** Opens the screen and waits for its content. */
  open: (page: Page) => Promise<void>;
  /** The width used for the README copy. */
  width: 390 | 1280;
}

type StorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;

let customerSession: Promise<StorageState> | undefined;

/**
 * The demo customer's cookies, from one sign-in shared by every shot, so
 * the screenshots stay well under the per-email sign-in limit.
 */
function customerState(): Promise<StorageState> {
  customerSession ??= (async () => {
    const api = await request.newContext({ baseURL: CUSTOMER_URL });
    const response = await api.post("/api/v1/auth/customer/login", {
      data: { email: DEMO.customer, password: DEMO.password },
      headers: { origin: CUSTOMER_URL },
    });
    expect(response.ok()).toBe(true);
    const state = await api.storageState();
    await api.dispose();
    return state;
  })();
  return customerSession;
}

const CUSTOMER_SHOTS: Shot[] = [
  {
    name: "customer-home",
    width: 1280,
    open: async (page) => {
      await page.goto(`${CUSTOMER_URL}/`);
    },
  },
  {
    name: "customer-help-search",
    width: 1280,
    open: async (page) => {
      await page.goto(`${CUSTOMER_URL}/help?q=wifi`);
    },
  },
  {
    name: "customer-article",
    width: 1280,
    open: async (page) => {
      await page.goto(`${CUSTOMER_URL}/help/harbor-camera-offline`);
    },
  },
  {
    name: "customer-new-request",
    width: 1280,
    open: async (page) => {
      await page.goto(`${CUSTOMER_URL}/new`);
      await page.getByLabel("Subject").fill("Camera offline");
      await expect(
        page.getByRole("complementary").getByRole("link").first(),
      ).toBeVisible();
    },
  },
  {
    name: "customer-my-requests",
    width: 1280,
    signedIn: true,
    open: async (page) => {
      await page.goto(`${CUSTOMER_URL}/tickets`);
    },
  },
  {
    name: "customer-thread-mobile",
    width: 390,
    signedIn: true,
    open: async (page) => {
      await page.goto(`${CUSTOMER_URL}/tickets`);
      await page
        .getByRole("link", { name: /Change the email address/ })
        .click();
      await expect(
        page.getByRole("list", { name: "Conversation" }),
      ).toBeVisible();
    },
  },
];

const AGENT_SHOTS: Shot[] = [
  {
    name: "agent-queue",
    width: 1280,
    staff: true,
    open: async (page) => {
      await page.goto(`${AGENT_URL}/queue`);
    },
  },
  {
    name: "agent-ticket",
    width: 1280,
    staff: true,
    open: async (page) => {
      await page.goto(`${AGENT_URL}/queue`);
      await page
        .locator('a[href^="/tickets/"]:visible', {
          hasText: "Order 3030-9011 is past its delivery date",
        })
        .click();
      await expect(
        page.getByRole("list", { name: "Conversation" }),
      ).toBeVisible();
    },
  },
  {
    name: "agent-reports",
    width: 1280,
    staff: true,
    open: async (page) => {
      await page.goto(`${AGENT_URL}/reports`);
    },
  },
  {
    name: "agent-team",
    width: 1280,
    staff: true,
    open: async (page) => {
      await page.goto(`${AGENT_URL}/team`);
    },
  },
  {
    name: "agent-kb-editor",
    width: 1280,
    staff: true,
    open: async (page) => {
      await page.goto(`${AGENT_URL}/kb?status=published`);
      await page.getByRole("table").getByRole("link").first().click();
      await expect(page.getByLabel("Body (markdown)")).not.toHaveValue("");
    },
  },
  {
    name: "agent-queue-mobile",
    width: 390,
    staff: true,
    open: async (page) => {
      await page.goto(`${AGENT_URL}/queue`);
    },
  },
];

const SIZES = {
  390: { width: 390, height: 844 },
  1280: { width: 1280, height: 800 },
};

for (const shot of [...CUSTOMER_SHOTS, ...AGENT_SHOTS]) {
  test(shot.name, async ({ browser }) => {
    const variants = reviewing
      ? ([390, 1280] as const).flatMap((width) =>
          (["light", "dark"] as const).map((scheme) => ({ width, scheme })),
        )
      : [{ width: shot.width, scheme: "light" as const }];

    for (const { width, scheme } of variants) {
      const context = await browser.newContext({
        viewport: SIZES[width],
        colorScheme: scheme,
        deviceScaleFactor: 2,
        ...(shot.signedIn === true
          ? { storageState: await customerState() }
          : {}),
        ...(shot.staff === true
          ? { storageState: staffState("supervisor") }
          : {}),
      });
      const page = await context.newPage();
      await shot.open(page);
      await settled(page);
      // Let fonts and the relative times settle before the capture.
      await page.evaluate(() => document.fonts.ready);
      const fullPage = width === 390;
      if (!reviewing || (width === shot.width && scheme === "light")) {
        mkdirSync(DOCS, { recursive: true });
        await page.screenshot({
          path: path.join(DOCS, `${shot.name}.png`),
          fullPage,
        });
      }
      if (reviewing) {
        mkdirSync(REVIEW, { recursive: true });
        await page.screenshot({
          path: path.join(REVIEW, `${shot.name}-${width}-${scheme}.png`),
          fullPage: true,
        });
      }
      await context.close();
    }
  });
}
