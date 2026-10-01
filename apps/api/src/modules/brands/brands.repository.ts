import { Inject, Injectable } from "@nestjs/common";
import { agentBrandMemberships, brands } from "@dsd/db/schema";
import { PROBLEM_TYPES } from "@dsd/shared";
import { asc, eq } from "drizzle-orm";
import { ZodValidationException } from "nestjs-zod";
import { z } from "zod";

import { ProblemException } from "../../common/problem-details.js";
import type { Env } from "../../config/env.js";
import type { Executor } from "../../infrastructure/database.js";
import { ENV } from "../../infrastructure/tokens.js";

/**
 * Brands (ADR-0004, section 6). v1 has one, but staff work is always done
 * in the agent's brands, and public intake and the public knowledge base
 * use the brand named by `TICKET_BRAND_SLUG`, so a second brand is data,
 * not code.
 */
@Injectable()
export class BrandsRepository {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** The brand public routes serve; a missing one is a deployment error. */
  async publicBrandId(executor: Executor): Promise<string> {
    const slug = this.env.TICKET_BRAND_SLUG;
    const [row] = await executor
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.slug, slug));
    if (row === undefined) {
      throw new Error(`TICKET_BRAND_SLUG names no brand: ${slug}`);
    }
    return row.id;
  }

  /** The brands an agent works in. */
  async ofAgent(executor: Executor, agentId: string): Promise<string[]> {
    const rows = await executor
      .select({ id: agentBrandMemberships.brandId })
      .from(agentBrandMemberships)
      .where(eq(agentBrandMemberships.agentId, agentId))
      .orderBy(asc(agentBrandMemberships.brandId));
    return rows.map((row) => row.id);
  }

  /**
   * The brand something new goes into: the one named, which must be one of
   * the agent's (404 otherwise, as for anything outside their brands), or
   * else the agent's only brand. An agent in several brands must name one.
   */
  async forNewContent(
    executor: Executor,
    agentId: string,
    requested: string | undefined,
  ): Promise<string> {
    const own = await this.ofAgent(executor, agentId);
    if (requested !== undefined) {
      if (!own.includes(requested)) {
        throw new ProblemException(
          404,
          PROBLEM_TYPES.blank,
          "No such brand among yours.",
        );
      }
      return requested;
    }
    const [only, ...others] = own;
    if (only === undefined || others.length > 0) {
      throw new ZodValidationException(
        new z.ZodError([
          {
            code: "custom",
            path: ["brandId"],
            message:
              only === undefined
                ? "You belong to no brand, so nothing can be created"
                : "You belong to several brands: say which one",
            input: undefined,
          },
        ]),
      );
    }
    return only;
  }
}
