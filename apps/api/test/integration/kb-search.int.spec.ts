import type { TestDatabase } from "@dsd/db/testing";
import type { KbPublicArticleSummary } from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSeededDatabase, startAppOn } from "../support/database.js";
import { newArticle, newCategory } from "../support/kb.js";
import { otherBrandId } from "../support/tickets.js";

interface Page {
  items: KbPublicArticleSummary[];
  nextCursor: string | null;
}

/**
 * The help centre's browse and keyword search (FR-4; ADR-0012): published
 * articles of the public brand only, ranked with the title first, snippets
 * as plain-text segments, and keyset pages with no gaps or repeats.
 */
describe("knowledge-base search", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_kb_search");
    app = await startAppOn(database);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const search = async (query: string): Promise<Page> => {
    const response = await request(app.getHttpServer()).get(
      `/api/v1/public/kb/articles?${query}`,
    );
    expect(response.status).toBe(200);
    return response.body as Page;
  };

  /** Every page, following `nextCursor`. */
  const allPages = async (query: string, limit: number) => {
    const slugs: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Page = await search(
        `${query}&limit=${limit}${cursor === null ? "" : `&cursor=${cursor}`}`,
      );
      slugs.push(...page.items.map((item) => item.slug));
      cursor = page.nextCursor;
    } while (cursor !== null);
    return slugs;
  };

  it("ranks a match in the title above one in the body", async () => {
    const inBody = await newArticle(database, {
      status: "published",
      title: "Lights on the front panel",
      body: "If the quokkalink light blinks, wait a minute.",
    });
    const inTitle = await newArticle(database, {
      status: "published",
      title: "Pairing a Quokkalink sensor",
      body: "Hold the button until it pairs.",
    });
    const page = await search("q=quokkalink");
    expect(page.items.map((item) => item.slug)).toEqual([
      inTitle.slug,
      inBody.slug,
    ]);
  });

  it("never returns drafts, archived articles or another brand's", async () => {
    for (const status of ["draft", "archived"] as const) {
      await newArticle(database, {
        status,
        title: `Wallabyport ${status} article`,
      });
    }
    await newArticle(database, {
      status: "published",
      brandId: await otherBrandId(database),
      title: "Wallabyport in another brand",
    });
    const live = await newArticle(database, {
      status: "published",
      title: "Wallabyport setup",
    });
    expect((await search("q=wallabyport")).items.map((i) => i.slug)).toEqual([
      live.slug,
    ]);
    expect(await allPages("category=none-such", 50)).toEqual([]);
    const browsed = await allPages("tag=none", 100);
    expect(browsed).toEqual([]);

    const draft = await newArticle(database, { title: "Draft by slug" });
    const direct = await request(app.getHttpServer()).get(
      `/api/v1/public/kb/articles/${draft.slug}`,
    );
    expect(direct.status).toBe(404);
  });

  it("returns snippets as plain-text segments with the matches marked", async () => {
    await newArticle(database, {
      status: "published",
      title: "Numbatcam night mode",
      body: "Switch <b>night mode</b> on so the numbatcam sees in the dark.",
    });
    const [item] = (await search("q=numbatcam")).items;
    const snippet = item?.snippet ?? [];
    expect(snippet.length).toBeGreaterThan(1);
    expect(
      snippet
        .filter((segment) => segment.highlighted)
        .map((s) => s.text.toLowerCase()),
    ).toContain("numbatcam");
    const text = snippet.map((segment) => segment.text).join("");
    expect(text).not.toMatch(/[\uE000\uE001]/);
    // ts_headline drops markup from what it quotes; nothing HTML-like is left.
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain("night mode");
  });

  it("understands quoted phrases and exclusions", async () => {
    const both = await newArticle(database, {
      status: "published",
      title: "Bilbyhub firmware update",
    });
    const other = await newArticle(database, {
      status: "published",
      title: "Bilbyhub battery care",
    });
    expect(
      (await search(`q=${encodeURIComponent("bilbyhub -firmware")}`)).items.map(
        (i) => i.slug,
      ),
    ).toEqual([other.slug]);
    expect(
      (
        await search(`q=${encodeURIComponent('"bilbyhub firmware"')}`)
      ).items.map((i) => i.slug),
    ).toEqual([both.slug]);
  });

  it("filters by category and tag", async () => {
    const category = await newCategory(database);
    const filed = await newArticle(database, {
      status: "published",
      title: "Dingoplug in a category",
      categoryId: category.id,
      tags: ["power"],
    });
    await newArticle(database, {
      status: "published",
      title: "Dingoplug elsewhere",
    });
    expect(
      (await search(`q=dingoplug&category=${category.slug}`)).items.map(
        (i) => i.slug,
      ),
    ).toEqual([filed.slug]);
    expect(
      (await search("q=dingoplug&tag=power")).items.map((i) => i.slug),
    ).toEqual([filed.slug]);
    const categories = await request(app.getHttpServer()).get(
      "/api/v1/public/kb/categories",
    );
    expect(categories.body).toContainEqual({
      slug: category.slug,
      name: "A test category",
      articleCount: 1,
    });
  });

  it("pages search results and browsing without gaps or repeats", async () => {
    const made: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      made.push(
        (
          await newArticle(database, {
            status: "published",
            title: `Emupad guide ${index}`,
            body: "emupad ".repeat(index + 1),
          })
        ).slug,
      );
    }
    const searched = await allPages("q=emupad", 2);
    expect([...searched].sort()).toEqual([...made].sort());
    expect(new Set(searched).size).toBe(searched.length);

    const browsed = await allPages("", 3);
    expect(new Set(browsed).size).toBe(browsed.length);
    for (const slug of made) expect(browsed).toContain(slug);
  });

  it("refuses a cursor from the other list", async () => {
    await newArticle(database, { status: "published", title: "Koalanet one" });
    await newArticle(database, { status: "published", title: "Koalanet two" });
    const page = await search("q=koalanet&limit=1");
    const cursor = page.nextCursor ?? "";
    const response = await request(app.getHttpServer()).get(
      `/api/v1/public/kb/articles?limit=1&cursor=${cursor}`,
    );
    expect(response.status).toBe(400);
  });
});
