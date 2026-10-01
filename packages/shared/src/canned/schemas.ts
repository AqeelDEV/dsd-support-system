import { z } from "zod";

import { pageFields, text } from "../http/fields.js";
import { CANNED_VARIABLES, unknownVariables } from "./variables.js";

/*
 * Canned responses (FR-12): reply templates that agents insert into the
 * composer and edit before sending.
 */

const variableList = Object.keys(CANNED_VARIABLES)
  .map((name) => `{{${name}}}`)
  .join(", ");

/** A template body: only known variables, so a typo is a 400, not a reply with braces in it. */
const templateBody = text(5_000)
  .describe(`Plain text. Variables: ${variableList}`)
  .superRefine((body, context) => {
    const unknown = unknownVariables(body);
    if (unknown.length > 0) {
      context.addIssue({
        code: "custom",
        message: `Unknown variables: ${unknown.map((name) => `{{${name}}}`).join(", ")}. Use ${variableList}.`,
      });
    }
  });

const title = text(100);

export const cannedResponseCreateRequestSchema = z.strictObject({
  brandId: z
    .uuid()
    .optional()
    .describe("Your brand; required only if you belong to more than one"),
  title,
  body: templateBody,
});

export const cannedResponseUpdateRequestSchema = z
  .strictObject({ title: title.optional(), body: templateBody.optional() })
  .refine((value) => value.title !== undefined || value.body !== undefined, {
    message: "Send at least one field to change",
  });

export const cannedResponseListQuerySchema = z.strictObject({
  q: text(100).optional().describe("Part of the title"),
  includeRetired: z
    .stringbool()
    .default(false)
    .describe("Also list retired templates"),
  ...pageFields,
});

export const cannedRenderQuerySchema = z.strictObject({
  ticketId: z.uuid().describe("The ticket the reply is for"),
});

const agentRefSchema = z.object({ id: z.uuid(), displayName: z.string() });
const timestamp = z.iso.datetime();

export const cannedResponseSchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  title: z.string(),
  body: z.string().describe("The template, with its variables"),
  variables: z
    .array(z.string())
    .describe("The variables the body uses, in order"),
  retiredAt: timestamp.nullable(),
  createdBy: agentRefSchema,
  updatedBy: agentRefSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const renderedCannedResponseSchema = z.object({
  body: z
    .string()
    .describe("The template filled in for the ticket: put it in the composer"),
});

export type CannedResponseCreateRequest = z.infer<
  typeof cannedResponseCreateRequestSchema
>;
export type CannedResponseUpdateRequest = z.infer<
  typeof cannedResponseUpdateRequestSchema
>;
export type CannedResponseListQuery = z.infer<
  typeof cannedResponseListQuerySchema
>;
export type CannedRenderQuery = z.infer<typeof cannedRenderQuerySchema>;
export type CannedResponse = z.infer<typeof cannedResponseSchema>;
export type RenderedCannedResponse = z.infer<
  typeof renderedCannedResponseSchema
>;
