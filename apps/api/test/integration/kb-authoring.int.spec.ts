import type { TestDatabase } from "@dsd/db/testing";
import { type KbStaffArticle, PROBLEM_TYPES } from "@dsd/shared";
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
import { newCategory } from "../support/kb.js";
import { otherBrandId } from "../support/tickets.js";

/**
 * Writing and publishing knowledge-base articles (FR-15; ADR-0012): drafts
 * stay private, every publish is a new version with its history and its
 * event, and markdown is sanitised before it is stored.
 */
describe("knowledge-base authoring", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let supervisorId: string;
  let supervisor: Credentials;
  let agent: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_kb_authoring");
    app = await startAppOn(database);
    supervisorId = await idOf(database, "agents", DEMO.supervisor);
    supervisor = await sessionFor(app, {
      kind: "staff",
      agentId: supervisorId,
    });
    agent = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.agent),
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const send = (
    method: "post" | "patch" | "delete",
    path: string,
    caller: Credentials,
    body?: Record<string, unknown>,
  ) => {
    const http = request(app.getHttpServer());
    const call = http[method](`/api/v1/staff/kb${path}`)
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken);
    return body === undefined ? call : call.send(body);
  };

  const publicArticle = (slug: string) =>
    request(app.getHttpServer()).get(`/api/v1/public/kb/articles/${slug}`);

  const draft = async (title: string, extra: Record<string, unknown> = {}) => {
    const response = await send("post", "/articles", supervisor, {
      title,
      bodyMarkdown: `About ${title}.`,
      ...extra,
    });
    expect(response.status).toBe(201);
    return response.body as KbStaffArticle;
  };

  const history = (articleId: string) =>
    asOwner<{
      action: string;
      actor_agent_id: string;
      before: unknown;
      after: unknown;
    }>(
      database,
      `SELECT action, actor_agent_id, before, after FROM audit_events
        WHERE entity_type = 'kb_article' AND entity_id = $1 ORDER BY created_at, id`,
      [articleId],
    );

  const events = (articleId: string) =>
    asOwner<{ event_type: string; payload: unknown }>(
      database,
      `SELECT event_type, payload FROM outbox_events
        WHERE aggregate_type = 'kb_article' AND aggregate_id = $1 ORDER BY id`,
      [articleId],
    );

  it("starts as a private draft, with a slug made from the title", async () => {
    const article = await draft("Resetting the Hub 2 router");
    expect(article).toMatchObject({
      slug: "resetting-the-hub-2-router",
      status: "draft",
      version: 0,
      publishedAt: null,
      author: { id: supervisorId },
    });
    expect((await publicArticle(article.slug)).status).toBe(404);
    const listed = await request(app.getHttpServer()).get(
      "/api/v1/public/kb/articles?limit=100",
    );
    expect(
      (listed.body as { items: { slug: string }[] }).items.map((i) => i.slug),
    ).not.toContain(article.slug);
    expect(await history(article.id)).toEqual([]);
  });

  it("sanitises the markdown before storing it", async () => {
    const article = await draft("Sanitised article", {
      bodyMarkdown:
        "Steps:\n\n<script>alert(document.cookie)</script>\n\nClick [here](javascript:alert(1)) or <b onmouseover=alert(1)>hover</b>.",
    });
    expect(article.bodyMarkdown).toBe("Steps:\n\n\n\nClick here or hover.");
    const [row] = await asOwner<{ body_markdown: string }>(
      database,
      "SELECT body_markdown FROM kb_articles WHERE id = $1",
      [article.id],
    );
    expect(row?.body_markdown).toBe(article.bodyMarkdown);
  });

  it("publishes a version, with its history and its event, and then shows it publicly", async () => {
    const article = await draft("Publishing walkthrough");
    const published = await send(
      "post",
      `/articles/${article.id}/publish`,
      supervisor,
    );
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ status: "published", version: 1 });
    expect((published.body as KbStaffArticle).publishedAt).not.toBeNull();
    expect((await publicArticle(article.slug)).status).toBe(200);

    // Publishing what is already published changes nothing.
    await send("post", `/articles/${article.id}/publish`, supervisor);
    expect(await history(article.id)).toEqual([
      {
        action: "kb.article_published",
        actor_agent_id: supervisorId,
        before: { status: "draft", version: 0 },
        after: { status: "published", version: 1 },
      },
    ]);
    expect(await events(article.id)).toEqual([
      {
        event_type: "kb.article_published",
        payload: { articleId: article.id, version: 1 },
      },
    ]);
  });

  it("republishes a published article when it is saved, so readers and the index agree", async () => {
    const article = await draft("Republish on save");
    await send("post", `/articles/${article.id}/publish`, supervisor);
    const saved = await send("patch", `/articles/${article.id}`, supervisor, {
      bodyMarkdown: "The new text.",
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ status: "published", version: 2 });
    const live = await publicArticle(article.slug);
    expect(live.body).toMatchObject({ bodyMarkdown: "The new text." });
    expect((await events(article.id)).map((event) => event.payload)).toEqual([
      { articleId: article.id, version: 1 },
      { articleId: article.id, version: 2 },
    ]);
  });

  it("saves a draft without publishing it", async () => {
    const article = await draft("Quiet draft edits");
    const saved = await send("patch", `/articles/${article.id}`, supervisor, {
      title: "Quiet draft edits, revised",
      tags: ["router", "router", "wifi"],
    });
    expect(saved.body).toMatchObject({
      status: "draft",
      version: 0,
      title: "Quiet draft edits, revised",
      tags: ["router", "wifi"],
    });
    expect(await events(article.id)).toEqual([]);
  });

  it("unpublishes and archives, telling the index only when public content changes", async () => {
    const live = await draft("Goes back to draft");
    await send("post", `/articles/${live.id}/publish`, supervisor);
    const unpublished = await send(
      "post",
      `/articles/${live.id}/unpublish`,
      supervisor,
    );
    expect(unpublished.body).toMatchObject({ status: "draft", version: 1 });
    expect((await publicArticle(live.slug)).status).toBe(404);
    expect((await history(live.id)).map((event) => event.action)).toEqual([
      "kb.article_published",
      "kb.article_unpublished",
    ]);
    expect((await events(live.id)).map((event) => event.event_type)).toEqual([
      "kb.article_published",
      "kb.article_unpublished",
    ]);

    const neverLive = await draft("Archived straight away");
    const archived = await send(
      "post",
      `/articles/${neverLive.id}/archive`,
      supervisor,
    );
    expect(archived.body).toMatchObject({ status: "archived" });
    expect((await history(neverLive.id)).map((event) => event.action)).toEqual([
      "kb.article_archived",
    ]);
    expect(await events(neverLive.id)).toEqual([]);

    // An archived article can be published again.
    const revived = await send(
      "post",
      `/articles/${neverLive.id}/publish`,
      supervisor,
    );
    expect(revived.body).toMatchObject({ status: "published", version: 1 });
  });

  it("refuses a slug the brand already uses", async () => {
    const first = await draft("Slug owner");
    const second = await send("post", "/articles", supervisor, {
      title: "Something else",
      slug: first.slug,
      bodyMarkdown: "Text.",
    });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ type: PROBLEM_TYPES.alreadyExists });

    const other = await draft("Another slug owner");
    const renamed = await send("patch", `/articles/${other.id}`, supervisor, {
      slug: first.slug,
    });
    expect(renamed.status).toBe(409);
  });

  it("files articles under a category of their own brand only", async () => {
    const category = await newCategory(database);
    const filed = await draft("Filed article", { categoryId: category.id });
    expect(filed.category).toMatchObject({ id: category.id });

    const foreign = await newCategory(database, await otherBrandId(database));
    const refused = await send("post", "/articles", supervisor, {
      title: "Wrong brand category",
      bodyMarkdown: "Text.",
      categoryId: foreign.id,
    });
    expect(refused.status).toBe(422);

    const inUse = await send(
      "delete",
      `/categories/${category.id}`,
      supervisor,
    );
    expect(inUse.status).toBe(409);
    await send("patch", `/articles/${filed.id}`, supervisor, {
      categoryId: null,
    });
    const deleted = await send(
      "delete",
      `/categories/${category.id}`,
      supervisor,
    );
    expect(deleted.status).toBe(204);
  });

  it("manages categories, with slugs made from names", async () => {
    const created = await send("post", "/categories", supervisor, {
      name: "Billing & Payments",
      position: 3,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      slug: "billing-payments",
      position: 3,
    });
    const duplicate = await send("post", "/categories", supervisor, {
      name: "Billing payments",
    });
    expect(duplicate.status).toBe(409);
    const renamed = await send(
      "patch",
      `/categories/${(created.body as { id: string }).id}`,
      supervisor,
      { name: "Billing" },
    );
    expect(renamed.body).toMatchObject({
      name: "Billing",
      slug: "billing-payments",
    });
    expect(
      (
        await send(
          "patch",
          `/categories/${(created.body as { id: string }).id}`,
          supervisor,
          {},
        )
      ).status,
    ).toBe(400);
  });

  it("keeps content in the author's brands", async () => {
    const outside = await send("post", "/articles", supervisor, {
      brandId: await otherBrandId(database),
      title: "Not my brand",
      bodyMarkdown: "Text.",
    });
    expect(outside.status).toBe(404);
  });

  it("lets agents read but not write or publish", async () => {
    const article = await draft("Agents may read this");
    const read = await request(app.getHttpServer())
      .get(`/api/v1/staff/kb/articles/${article.id}`)
      .set("cookie", agent.cookie);
    expect(read.status).toBe(200);
    expect(
      (await send("patch", `/articles/${article.id}`, agent, { title: "X" }))
        .status,
    ).toBe(403);
    expect(
      (await send("post", `/articles/${article.id}/publish`, agent)).status,
    ).toBe(403);
  });

  it("lists drafts for staff, filtered by status", async () => {
    const article = await draft("Listed for staff");
    const response = await request(app.getHttpServer())
      .get("/api/v1/staff/kb/articles?status=draft&limit=100")
      .set("cookie", supervisor.cookie);
    const items = (response.body as { items: KbStaffArticle[] }).items;
    expect(items.map((item) => item.id)).toContain(article.id);
    expect(items.every((item) => item.status === "draft")).toBe(true);
  });
});
