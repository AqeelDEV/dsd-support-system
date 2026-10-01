import { createHash, randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import {
  ATTACHMENT_LIMITS,
  type CustomerTicket,
  type StaffTicket,
} from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseEnv } from "../../src/config/env.js";
import {
  ObjectMissingError,
  ObjectStore,
} from "../../src/infrastructure/object-store.js";
import { closedPort, TEST_ENV } from "../support/app.js";
import { type Credentials, DEMO, ORIGIN, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { FILES } from "../support/files.js";
import { newTicket, otherBrandId } from "../support/tickets.js";

/** Reads any response body as raw bytes; in Node, superagent hands parsers the stream. */
function bytes(
  response: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
) {
  const stream = response as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
}

/** Attachments, from upload to download (FR-19, NFR-8; ADR-0009, Verification). */
describe("attachments", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let objects: ObjectStore;
  let customerId: string;
  let customer: Credentials;
  let otherCustomer: Credentials;
  let agent: Credentials;
  let ticketId: string;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_attachments");
    app = await startAppOn(database);
    objects = app.get(ObjectStore);
    customerId = await idOf(database, "customers", DEMO.customer);
    customer = await sessionFor(app, { kind: "customer", customerId });
    const [other] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM customers WHERE id <> $1 AND password_hash IS NOT NULL LIMIT 1",
      [customerId],
    );
    otherCustomer = await sessionFor(app, {
      kind: "customer",
      customerId: other?.id ?? "",
    });
    agent = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.agent),
    });
    ticketId = await newTicket(database, { customerId });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const post = (path: string, caller: Credentials) =>
    request(app.getHttpServer())
      .post(path)
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken);

  const reply = (caller: Credentials, target = ticketId) =>
    post(`/api/v1/customer/tickets/${target}/messages`, caller).field(
      "body",
      "See the attached file.",
    );

  const download = (
    realm: "customer" | "staff",
    caller: Credentials,
    target: string,
    id: string,
  ) =>
    request(app.getHttpServer())
      .get(`/api/v1/${realm}/tickets/${target}/attachments/${id}`)
      .set("cookie", caller.cookie)
      .buffer(true)
      .parse(bytes);

  const exists = async (key: string) => {
    try {
      (await objects.get(key)).destroy();
      return true;
    } catch (error) {
      if (error instanceof ObjectMissingError) return false;
      throw error;
    }
  };

  /** The files on the newest message of the ticket. */
  const lastFiles = (body: unknown) =>
    (body as CustomerTicket).messages.at(-1)?.attachments ?? [];

  describe("upload", () => {
    it.each([
      ["a PNG", FILES.png, "image/png"],
      ["a JPEG", FILES.jpeg, "image/jpeg"],
      ["a GIF", FILES.gif, "image/gif"],
      ["a WebP image", FILES.webp, "image/webp"],
      ["a PDF", FILES.pdf, "application/pdf"],
      ["a UTF-8 log", FILES.log, "text/plain; charset=utf-8"],
    ])(
      "accepts %s, stored as %s whatever it was called",
      async (_name, file, type) => {
        const response = await reply(customer).attach(
          "attachments",
          file,
          "upload.bin",
        );
        expect(response.status).toBe(201);
        expect(lastFiles(response.body)).toEqual([
          expect.objectContaining({
            contentType: type,
            sizeBytes: file.length,
          }),
        ]);
      },
    );

    it.each([
      ["a Windows executable renamed to .pdf", FILES.exe, "invoice.pdf"],
      ["an ELF binary", FILES.elf, "tool"],
      ["a zip archive", FILES.zip, "logs.zip"],
      ["a text file with NUL bytes", FILES.textWithNul, "notes.txt"],
    ])(
      "refuses %s with 415, and stores nothing",
      async (_name, file, filename) => {
        const put = vi.spyOn(objects, "put");
        const before = await asOwner(database, "SELECT count(*) FROM messages");
        const response = await reply(customer).attach(
          "attachments",
          file,
          filename,
        );
        expect(response.status).toBe(415);
        expect(put).not.toHaveBeenCalled();
        put.mockRestore();
        expect(
          await asOwner(database, "SELECT count(*) FROM messages"),
        ).toEqual(before);
      },
    );

    it("takes a file of exactly 10 MB and refuses one byte more with 413", async () => {
      const limit = ATTACHMENT_LIMITS.maxBytes;
      const atLimit = await reply(customer).attach(
        "attachments",
        Buffer.alloc(limit, "a"),
        "big.log",
      );
      expect(atLimit.status).toBe(201);
      const over = await reply(customer).attach(
        "attachments",
        Buffer.alloc(limit + 1, "a"),
        "bigger.log",
      );
      expect(over.status).toBe(413);
    });

    it("refuses six files in one message with 400", async () => {
      let form = reply(customer);
      for (let index = 0; index < ATTACHMENT_LIMITS.maxFiles + 1; index += 1) {
        form = form.attach(
          "attachments",
          FILES.png,
          `shot-${String(index)}.png`,
        );
      }
      const response = await form;
      expect(response.status).toBe(400);
      expect((response.body as { errors: { path: string }[] }).errors).toEqual([
        expect.objectContaining({ path: "attachments" }),
      ]);
    });

    it("keys each object randomly, never by its filename", async () => {
      const response = await reply(customer).attach(
        "attachments",
        FILES.png,
        "my-secret-plans.png",
      );
      const [file] = lastFiles(response.body);
      const [row] = await asOwner<{ object_key: string; sha256: Buffer }>(
        database,
        "SELECT object_key, sha256 FROM attachments WHERE id = $1",
        [file?.id],
      );
      expect(row?.object_key).toMatch(/^attachments\/[0-9a-f-]{36}$/);
      expect(row?.object_key).not.toContain("secret");
      expect(row?.sha256).toEqual(
        createHash("sha256").update(FILES.png).digest(),
      );
    });

    it("deletes the stored files when the transaction refuses the message", async () => {
      const closed = await newTicket(database, {
        customerId,
        status: "closed",
      });
      const put = vi.spyOn(objects, "put");
      const response = await reply(customer, closed).attach(
        "attachments",
        FILES.pdf,
        "late.pdf",
      );
      expect(response.status).toBe(409);
      const keys = put.mock.calls.map(([key]) => key);
      put.mockRestore();
      expect(keys).toHaveLength(1);
      expect(await exists(keys[0] ?? "")).toBe(false);
    });
  });

  describe("download", () => {
    let publicFile: string;
    let noteFile: string;

    beforeAll(async () => {
      const response = await reply(customer).attach(
        "attachments",
        FILES.pdf,
        "Router manual (v2) — café.pdf",
      );
      publicFile = lastFiles(response.body)[0]?.id ?? "";
      const note = await post(`/api/v1/staff/tickets/${ticketId}/notes`, agent)
        .field("body", "Internal diagnostics attached.")
        .attach("attachments", FILES.log, "diagnostics.log");
      noteFile =
        (note.body as StaffTicket).messages.at(-1)?.attachments[0]?.id ?? "";
    });

    it("streams the exact bytes with exactly ADR-0009's headers", async () => {
      for (const [realm, caller] of [
        ["customer", customer],
        ["staff", agent],
      ] as const) {
        const response = await download(realm, caller, ticketId, publicFile);
        expect(response.status).toBe(200);
        expect(response.body).toEqual(FILES.pdf);
        expect(response.headers).toMatchObject({
          "content-type": "application/pdf",
          "content-length": String(FILES.pdf.length),
          "content-disposition":
            "attachment; filename*=UTF-8''Router%20manual%20%28v2%29%20%E2%80%94%20caf%C3%A9.pdf",
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
          "content-security-policy": "default-src 'none'; sandbox",
        });
      }
    });

    it("hides a file on an internal note from the customer (404), not from staff", async () => {
      expect(
        (await download("customer", customer, ticketId, noteFile)).status,
      ).toBe(404);
      const staff = await download("staff", agent, ticketId, noteFile);
      expect(staff.status).toBe(200);
      expect(staff.body).toEqual(FILES.log);
    });

    it("answers 404 to another customer, and to a guest on another ticket", async () => {
      expect(
        (await download("customer", otherCustomer, ticketId, publicFile))
          .status,
      ).toBe(404);
      const guestTicket = await newTicket(database, { customerId });
      const guest = await sessionFor(app, {
        kind: "guest",
        customerId,
        ticketId: guestTicket,
      });
      expect(
        (await download("customer", guest, ticketId, publicFile)).status,
      ).toBe(404);
    });

    it("never matches a file to a ticket it isn't on", async () => {
      const elsewhere = await newTicket(database, { customerId });
      expect(
        (await download("customer", customer, elsewhere, publicFile)).status,
      ).toBe(404);
      expect(
        (await download("staff", agent, ticketId, randomUUID())).status,
      ).toBe(404);
    });

    it("answers 404 to staff outside the ticket's brand", async () => {
      const elsewhere = await newTicket(database, {
        customerId,
        brandId: await otherBrandId(database),
      });
      const [file] = await asOwner<{ id: string }>(
        database,
        `INSERT INTO attachments (ticket_id, uploader_type, uploader_customer_id, object_key,
                                  filename, content_type, size_bytes, sha256)
         VALUES ($1, 'customer', $2, $3, 'elsewhere.png', 'image/png', 70, $4)
         RETURNING id`,
        [
          elsewhere,
          customerId,
          `attachments/${randomUUID()}`,
          Buffer.alloc(32),
        ],
      );
      expect(
        (await download("staff", agent, elsewhere, file?.id ?? "")).status,
      ).toBe(404);
    });

    it("isn't reachable on the object store without its credentials", async () => {
      const [row] = await asOwner<{ object_key: string }>(
        database,
        "SELECT object_key FROM attachments WHERE id = $1",
        [publicFile],
      );
      const env = parseEnv(TEST_ENV);
      const anonymous = await fetch(
        `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${row?.object_key ?? ""}`,
      );
      expect(anonymous.status).toBe(403);
    });

    it("answers 503 while the object store is down", async () => {
      const withoutStore = await startAppOn(database, {
        S3_ENDPOINT: `http://127.0.0.1:${await closedPort()}`,
      });
      try {
        const response = await request(withoutStore.getHttpServer())
          .get(`/api/v1/customer/tickets/${ticketId}/attachments/${publicFile}`)
          .set("cookie", customer.cookie);
        expect(response.status).toBe(503);
      } finally {
        await withoutStore.close();
      }
    });
  });
});
