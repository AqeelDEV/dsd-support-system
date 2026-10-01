import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.js";
import type {
  NotificationChannel,
  Recipient,
  RenderedNotification,
  Sender,
} from "./channel.js";
import {
  type DeliveryKey,
  type DeliveryStore,
  NotificationService,
} from "./notification-service.js";
import type { TemplateData } from "./templates.js";

const logger = createLogger({ LOG_LEVEL: "silent" });

/** Deliveries in memory, keyed like the table's unique key. */
class MemoryStore implements DeliveryStore {
  readonly rows = new Map<
    string,
    { status: string; attempts: number; lastError: string | null }
  >();

  private id(key: DeliveryKey) {
    return `${key.eventId}|${key.channel}|${key.address}`;
  }

  open(key: DeliveryKey) {
    const row = this.rows.get(this.id(key)) ?? {
      status: "pending",
      attempts: 0,
      lastError: null,
    };
    this.rows.set(this.id(key), row);
    return Promise.resolve({ alreadySent: row.status === "sent" });
  }

  attempted(key: DeliveryKey) {
    const row = this.rows.get(this.id(key));
    if (row !== undefined) row.attempts += 1;
    return Promise.resolve();
  }

  sent(key: DeliveryKey) {
    const row = this.rows.get(this.id(key));
    if (row !== undefined) row.status = "sent";
    return Promise.resolve();
  }

  attemptFailed(key: DeliveryKey, error: string) {
    const row = this.rows.get(this.id(key));
    if (row !== undefined) row.lastError = error;
    return Promise.resolve();
  }
}

/** A channel that records what it was asked to send. */
class FakeChannel implements NotificationChannel {
  readonly sent: { to: string; message: RenderedNotification }[] = [];
  failNext = false;

  constructor(
    readonly kind: string,
    private readonly address: (recipient: Recipient) => string | null,
  ) {}

  addressOf(recipient: Recipient) {
    return this.address(recipient);
  }

  send(to: string, _from: Sender, message: RenderedNotification) {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("provider unavailable"));
    }
    this.sent.push({ to, message });
    return Promise.resolve({ providerMessageId: `${this.kind}-1` });
  }
}

const customer: Recipient = {
  kind: "customer",
  customerId: "c1",
  email: "ana@example.com",
};
const from: Sender = { name: "DSD Support", address: "support@dsd.example" };
const ticketData = (): Promise<TemplateData["statusChanged"]> =>
  Promise.resolve({
    brandName: "DSD",
    reference: "DSD-000042",
    subject: "Router keeps dropping",
    status: "resolved",
    link: { kind: "account", url: "https://help.example/tickets/1" },
  });

describe("NotificationService", () => {
  it("sends through every channel that can reach the recipient, without any change to the caller", async () => {
    const email = new FakeChannel("email", (recipient) => recipient.email);
    // A second channel, as SMS would be: same interface, its own address.
    const sms = new FakeChannel("sms", () => "+44 7700 900123");
    const service = new NotificationService(
      [email, sms],
      new MemoryStore(),
      logger,
    );

    await service.notify({
      eventId: "e1",
      ticketId: "t1",
      recipient: customer,
      from,
      template: "statusChanged",
      data: ticketData,
    });

    expect(email.sent.map((sent) => sent.to)).toEqual(["ana@example.com"]);
    expect(sms.sent.map((sent) => sent.to)).toEqual(["+44 7700 900123"]);
    expect(sms.sent[0]?.message.text).toContain("has been resolved");
  });

  it("skips a channel that has no address for the recipient", async () => {
    const email = new FakeChannel("email", (recipient) => recipient.email);
    const sms = new FakeChannel("sms", () => null);
    const service = new NotificationService(
      [email, sms],
      new MemoryStore(),
      logger,
    );
    await service.notify({
      eventId: "e1",
      ticketId: "t1",
      recipient: customer,
      from,
      template: "statusChanged",
      data: ticketData,
    });
    expect(sms.sent).toEqual([]);
    expect(email.sent).toHaveLength(1);
  });

  it("sends nothing twice, and builds the data only when it sends", async () => {
    const email = new FakeChannel("email", (recipient) => recipient.email);
    const store = new MemoryStore();
    const service = new NotificationService([email], store, logger);
    let built = 0;
    const notification = {
      eventId: "e1",
      ticketId: "t1",
      recipient: customer,
      from,
      template: "statusChanged" as const,
      data: () => {
        built += 1;
        return ticketData();
      },
    };
    await service.notify(notification);
    await service.notify(notification);
    expect(email.sent).toHaveLength(1);
    expect(built).toBe(1);
  });

  it("records a failed attempt and rethrows it, then sends on the retry", async () => {
    const email = new FakeChannel("email", (recipient) => recipient.email);
    const store = new MemoryStore();
    const service = new NotificationService([email], store, logger);
    const notification = {
      eventId: "e2",
      ticketId: "t1",
      recipient: customer,
      from,
      template: "statusChanged" as const,
      data: ticketData,
    };
    email.failNext = true;
    await expect(service.notify(notification)).rejects.toThrow(
      "provider unavailable",
    );
    expect([...store.rows.values()]).toEqual([
      { status: "pending", attempts: 1, lastError: "provider unavailable" },
    ]);
    await service.notify(notification);
    expect([...store.rows.values()]).toMatchObject([
      { status: "sent", attempts: 2 },
    ]);
  });
});
