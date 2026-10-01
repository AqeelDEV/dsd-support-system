import { Inject, Injectable } from "@nestjs/common";
import {
  type CannedResponse,
  type CannedResponseCreateRequest,
  type CannedResponseListQuery,
  type CannedResponseUpdateRequest,
  PROBLEM_TYPES,
  type RenderedCannedResponse,
  renderCanned,
  variablesIn,
} from "@dsd/shared";
import { z } from "zod";

import type { StaffPrincipal } from "../../auth/principal.js";
import { decodeCursor, encodeCursor, pageFrom } from "../../common/cursor.js";
import { violates } from "../../common/pg-errors.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import { BrandsRepository } from "../brands/brands.repository.js";
import {
  ACTIVE_TITLE_KEY,
  CannedResponsesRepository,
} from "./canned-responses.repository.js";

const BY_TITLE = "title";

const notFound = (what: "canned response" | "ticket") =>
  new ProblemException(
    404,
    PROBLEM_TYPES.blank,
    `No such ${what} in your brands.`,
  );

type Row = NonNullable<Awaited<ReturnType<CannedResponsesRepository["one"]>>>;

function toResponse(row: Row): CannedResponse {
  return {
    id: row.id,
    brandId: row.brandId,
    title: row.title,
    body: row.body,
    variables: variablesIn(row.body),
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Runs `write`, turning a clash with another active title into a 409. */
async function uniqueTitle<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (violates(error, ACTIVE_TITLE_KEY)) {
      throw new ProblemException(
        409,
        PROBLEM_TYPES.alreadyExists,
        "Another active template in this brand has that title.",
      );
    }
    throw error;
  }
}

/**
 * Reply templates (FR-12; ADR-0012). Every agent lists them and fills one
 * in for a ticket; supervisors and admins write and retire them. Filling
 * in happens here, from the ticket as it is now, and the result is plain
 * text that the agent edits before sending: a template never reaches a
 * customer on its own.
 */
@Injectable()
export class CannedResponsesService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly templates: CannedResponsesRepository,
    private readonly brands: BrandsRepository,
  ) {}

  async list(principal: StaffPrincipal, query: CannedResponseListQuery) {
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, BY_TITLE, z.tuple([z.string()]));
    const rows = await this.templates.page(
      this.db,
      principal.agent.id,
      { q: query.q, includeRetired: query.includeRetired },
      { limit: query.limit, after },
    );
    return pageFrom(rows, query.limit, toResponse, (row) =>
      encodeCursor(BY_TITLE, { keys: [row.title], id: row.id }),
    );
  }

  async create(
    principal: StaffPrincipal,
    request: CannedResponseCreateRequest,
  ): Promise<CannedResponse> {
    const brandId = await this.brands.forNewContent(
      this.db,
      principal.agent.id,
      request.brandId,
    );
    const id = await uniqueTitle(() =>
      this.templates.insert(this.db, {
        brandId,
        title: request.title,
        body: request.body,
        agentId: principal.agent.id,
      }),
    );
    return this.get(principal, id);
  }

  async update(
    principal: StaffPrincipal,
    id: string,
    request: CannedResponseUpdateRequest,
  ): Promise<CannedResponse> {
    await this.get(principal, id);
    await uniqueTitle(() =>
      this.templates.update(this.db, id, principal.agent.id, request),
    );
    return this.get(principal, id);
  }

  async retire(principal: StaffPrincipal, id: string): Promise<CannedResponse> {
    await this.get(principal, id);
    await this.templates.retire(this.db, id, principal.agent.id);
    return this.get(principal, id);
  }

  /**
   * The template filled in for one ticket. The ticket must be in the
   * agent's brands, and in the template's brand: each brand has its own
   * voice.
   */
  async render(
    principal: StaffPrincipal,
    id: string,
    ticketId: string,
  ): Promise<RenderedCannedResponse> {
    const template = await this.templates.one(this.db, principal.agent.id, id);
    // Missing, or retired: either way not one to use.
    if (template?.retiredAt !== null) {
      throw notFound("canned response");
    }
    const ticket = await this.templates.ticketForRendering(
      this.db,
      principal.agent.id,
      ticketId,
    );
    if (ticket === undefined) throw notFound("ticket");
    if (ticket.brandId !== template.brandId) {
      throw new ProblemException(
        422,
        PROBLEM_TYPES.blank,
        "This template belongs to another brand than the ticket.",
      );
    }
    return {
      body: renderCanned(template.body, {
        "customer.name": ticket.customerName ?? "there",
        "customer.email": ticket.customerEmail,
        "ticket.reference": ticket.reference,
        "ticket.subject": ticket.subject,
        "agent.name": principal.agent.displayName,
      }),
    };
  }

  private async get(
    principal: StaffPrincipal,
    id: string,
  ): Promise<CannedResponse> {
    const row = await this.templates.one(this.db, principal.agent.id, id);
    if (row === undefined) throw notFound("canned response");
    return toResponse(row);
  }
}
