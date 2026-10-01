import type { TestDatabase } from "@dsd/db/testing";
import { type CannedResponse, PROBLEM_TYPES } from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Credentials, DEMO, ORIGIN, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { newTicket, otherBrandId } from "../support/tickets.js";

/** Reply templates (FR-12; ADR-0012). */
describe("canned responses", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let agentName: string;
  let agent: Credentials;
  let supervisor: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_canned_responses");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    const [demoAgent] = await asOwner<{ display_name: string }>(
      database,
      "SELECT display_name FROM agents WHERE email_normalized = $1",
      [DEMO.agent],
    );
    agentName = demoAgent?.display_name ?? "";
    agent = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.agent),
    });
    supervisor = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.supervisor),
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const send = (
    method: "post" | "patch",
    path: string,
    caller: Credentials,
    body?: Record<string, unknown>,
  ) => {
    const http = request(app.getHttpServer());
    const call = http[method](`/api/v1/staff/canned-responses${path}`)
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken);
    return body === undefined ? call : call.send(body);
  };

  const get = (path: string, caller: Credentials) =>
    request(app.getHttpServer())
      .get(`/api/v1/staff/canned-responses${path}`)
      .set("cookie", caller.cookie);

  const create = async (title: string, body: string) => {
    const response = await send("post", "", supervisor, { title, body });
    expect(response.status).toBe(201);
    return response.body as CannedResponse;
  };

  it("lists the seeded templates by title for every agent", async () => {
    const response = await get("?limit=100", agent);
    expect(response.status).toBe(200);
    const titles = (response.body as { items: CannedResponse[] }).items.map(
      (item) => item.title,
    );
    expect(titles).toContain("Refund issued");
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  });

  it("fills a template in for a ticket, as plain text", async () => {
    const template = await create(
      "Greeting with every variable",
      "Hi {{customer.name}} ({{ customer.email }}), about {{ticket.reference}}: {{ticket.subject}}. {{agent.name}}",
    );
    expect(template.variables).toEqual([
      "customer.name",
      "customer.email",
      "ticket.reference",
      "ticket.subject",
      "agent.name",
    ]);
    const ticketId = await newTicket(database, {
      customerId,
      subject: "Sensor {{agent.name}} <b>offline</b>",
    });
    const [ticket] = await asOwner<{ reference: string; name: string }>(
      database,
      `SELECT t.reference, c.display_name AS name FROM tickets t
         JOIN customers c ON c.id = t.customer_id WHERE t.id = $1`,
      [ticketId],
    );
    const rendered = await get(
      `/${template.id}/render?ticketId=${ticketId}`,
      agent,
    );
    expect(rendered.status).toBe(200);
    expect(rendered.body).toEqual({
      body: `Hi ${ticket?.name ?? ""} (${DEMO.customer}), about ${ticket?.reference ?? ""}: Sensor {{agent.name}} <b>offline</b>. ${agentName}`,
    });
  });

  it('greets a customer without a name as "there"', async () => {
    const template = await create("Plain greeting", "Hi {{customer.name}}");
    const [guest] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM customers WHERE display_name IS NULL LIMIT 1",
    );
    const ticketId = await newTicket(database, { customerId: guest?.id ?? "" });
    const rendered = await get(
      `/${template.id}/render?ticketId=${ticketId}`,
      agent,
    );
    expect(rendered.body).toEqual({ body: "Hi there" });
  });

  it("refuses unknown variables when a template is saved", async () => {
    const response = await send("post", "", supervisor, {
      title: "Typo template",
      body: "Hi {{customer.nmae}}, see {{order.id}}",
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("{{customer.nmae}}");
  });

  it("keeps active titles unique, and frees a title once retired", async () => {
    const first = await create("Unique title", "First.");
    const clash = await send("post", "", supervisor, {
      title: "Unique title",
      body: "Second.",
    });
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ type: PROBLEM_TYPES.alreadyExists });

    const retired = await send("post", `/${first.id}/retire`, supervisor);
    expect(retired.status).toBe(200);
    expect((retired.body as CannedResponse).retiredAt).not.toBeNull();
    await create("Unique title", "Second.");

    const active = (await get("?limit=100&q=unique", agent)).body as {
      items: CannedResponse[];
    };
    expect(active.items.map((item) => item.body)).toEqual(["Second."]);
    const all = (await get("?limit=100&q=unique&includeRetired=true", agent))
      .body as { items: CannedResponse[] };
    expect(all.items).toHaveLength(2);

    const renderRetired = await get(
      `/${first.id}/render?ticketId=${await newTicket(database, { customerId })}`,
      agent,
    );
    expect(renderRetired.status).toBe(404);
  });

  it("edits a template", async () => {
    const template = await create("To be edited", "Old text.");
    const edited = await send("patch", `/${template.id}`, supervisor, {
      body: "New text for {{customer.name}}.",
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      title: "To be edited",
      body: "New text for {{customer.name}}.",
      variables: ["customer.name"],
    });
  });

  it("treats a search term's wildcards as text", async () => {
    await create("100% sure", "Text.");
    const items = (
      (await get(`?q=${encodeURIComponent("%")}`, agent)).body as {
        items: CannedResponse[];
      }
    ).items;
    expect(items.map((item) => item.title)).toEqual(["100% sure"]);
  });

  it("renders only for a ticket in the agent's brands and the template's brand", async () => {
    const template = await create("Brand check", "Hi.");
    const foreign = await newTicket(database, {
      customerId,
      brandId: await otherBrandId(database),
    });
    expect(
      (await get(`/${template.id}/render?ticketId=${foreign}`, agent)).status,
    ).toBe(404);
    expect((await get(`/${template.id}/render`, agent)).status).toBe(400);
  });

  it("lets agents use templates but not write them", async () => {
    const template = await create("Agents read this", "Text.");
    expect(
      (await send("post", "", agent, { title: "Mine", body: "Text." })).status,
    ).toBe(403);
    expect(
      (await send("patch", `/${template.id}`, agent, { body: "Changed." }))
        .status,
    ).toBe(403);
    expect((await send("post", `/${template.id}/retire`, agent)).status).toBe(
      403,
    );
  });
});
