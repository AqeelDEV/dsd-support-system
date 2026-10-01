import { z } from "zod";

import { emailSchema } from "../auth/schemas.js";
import { ticketPrioritySchema, ticketStatusSchema } from "../domain/enums.js";

/*
 * Ticket requests (ADR-0007, ADR-0011). Every object is strict: an unknown
 * field is a 400, so a customer can't slip `status`, `priority` or
 * `visibility` into a request that doesn't take them (mass assignment).
 *
 * Routes that carry files take these fields as multipart/form-data parts,
 * sent before the files; the rest take JSON.
 */

/**
 * Free text as PostgreSQL can store it: trimmed, within the column's CHECK
 * limit, and without NUL characters, which a `text` column can't hold.
 * zod counts UTF-16 units and the CHECK counts characters, so anything
 * zod accepts the database accepts too.
 */
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\u0000"), {
      message: "must not contain NUL characters",
    });

const subject = text(200).describe("A short summary, up to 200 characters");
const description = text(20_000).describe(
  "What happened, up to 20,000 characters",
);
const body = text(20_000).describe("Up to 20,000 characters");

/** A guest's ticket: the email is the contact method (ADR-0007, section 8). */
export const guestTicketFieldsSchema = z.strictObject({
  email: emailSchema,
  subject,
  description,
});

/** A signed-in customer's ticket: the account's email is the contact method. */
export const customerTicketFieldsSchema = z.strictObject({
  subject,
  description,
});

export const customerReplyFieldsSchema = z.strictObject({ body });

export const staffReplyFieldsSchema = z.strictObject({
  body,
  status: ticketStatusSchema
    .optional()
    .describe(
      "Move the ticket to this status in the same request, for example `pending_customer` to send and wait, or `resolved` to send and resolve",
    ),
});

export const internalNoteFieldsSchema = z.strictObject({ body });

export const statusChangeRequestSchema = z.strictObject({
  status: ticketStatusSchema,
});

export const priorityChangeRequestSchema = z.strictObject({
  priority: ticketPrioritySchema,
});

export const ASSIGNMENT_ACTIONS = ["claim", "assign", "unassign"] as const;

/**
 * One endpoint, three intents (ADR-0007, section 5). A claim succeeds only
 * on an unassigned ticket; assigning and unassigning follow the holder
 * rules, and `ticket:reassign:any` lifts them.
 */
export const assignmentRequestSchema = z
  .strictObject({
    action: z
      .enum(ASSIGNMENT_ACTIONS)
      .describe(
        "`claim`: take an unassigned ticket (409 if someone has it). `assign`: give it to an active agent in its brand. `unassign`: return it to the pool",
      ),
    agentId: z
      .uuid()
      .optional()
      .describe("The agent to assign; required with `assign`, and only then"),
  })
  .superRefine((request, context) => {
    const assigning = request.action === "assign";
    if (assigning !== (request.agentId !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["agentId"],
        message: assigning
          ? "Required when assigning"
          : "Only sent when assigning",
      });
    }
  });

export const escalationRequestSchema = z.strictObject({
  reason: text(2_000).describe(
    "Why it needs a supervisor; kept as an internal note",
  ),
  supervisorId: z
    .uuid()
    .optional()
    .describe(
      "A supervisor or admin in the ticket's brand to hand the ticket to",
    ),
});

/** `?status=open&status=resolved` arrives as an array, a single value as a string. */
const repeatable = <Item extends z.ZodType>(item: Item) =>
  z
    .preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(item).min(1),
    )
    .optional();

const pageFields = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Items per page, 1 to 100"),
  cursor: z
    .string()
    .max(512)
    .optional()
    .describe("`nextCursor` from the previous page"),
};

export const pageQuerySchema = z.strictObject(pageFields);

export const QUEUE_SORTS = ["priority", "oldest", "newest"] as const;
export const queueSortSchema = z.enum(QUEUE_SORTS);
export type QueueSort = z.infer<typeof queueSortSchema>;

/** The staff queue (FR-7). Without a status filter it shows `open` tickets. */
export const queueQuerySchema = z.strictObject({
  status: repeatable(ticketStatusSchema).describe(
    "One or more statuses; defaults to `open`",
  ),
  priority: repeatable(ticketPrioritySchema).describe("One or more priorities"),
  assignee: z
    .union([z.enum(["me", "unassigned"]), z.uuid()])
    .optional()
    .describe("`me`, `unassigned`, or an agent ID"),
  escalated: z
    .stringbool()
    .optional()
    .describe("`true` for escalated tickets only, `false` for the rest"),
  sort: queueSortSchema
    .default("priority")
    .describe(
      "`priority`: most urgent first, then oldest. `oldest` or `newest`: by age",
    ),
  ...pageFields,
});

export type GuestTicketFields = z.infer<typeof guestTicketFieldsSchema>;
export type CustomerTicketFields = z.infer<typeof customerTicketFieldsSchema>;
export type CustomerReplyFields = z.infer<typeof customerReplyFieldsSchema>;
export type StaffReplyFields = z.infer<typeof staffReplyFieldsSchema>;
export type InternalNoteFields = z.infer<typeof internalNoteFieldsSchema>;
export type StatusChangeRequest = z.infer<typeof statusChangeRequestSchema>;
export type PriorityChangeRequest = z.infer<typeof priorityChangeRequestSchema>;
export type AssignmentRequest = z.infer<typeof assignmentRequestSchema>;
export type EscalationRequest = z.infer<typeof escalationRequestSchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;
export type QueueQuery = z.infer<typeof queueQuerySchema>;
