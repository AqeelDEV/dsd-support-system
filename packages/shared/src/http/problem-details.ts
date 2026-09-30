import { z } from "zod";

/** Media type of every error response from the API (RFC 9457). */
export const PROBLEM_JSON = "application/problem+json";

/**
 * Problem type URIs. `about:blank` means "nothing beyond the HTTP status"
 * (RFC 9457, section 4.2.1). Types with their own meaning use `tag:` URIs,
 * which RFC 9457 suggests for identifiers that aren't meant to be fetched.
 * Clients branch on `type`, never on `title` or `detail`.
 */
export const PROBLEM_TYPES = {
  blank: "about:blank",
  validation: "tag:dsd.example,2026:problems/validation-error",
} as const;

export const validationIssueSchema = z.object({
  path: z
    .string()
    .describe(
      "Dot-separated path to the invalid field; empty for the whole body",
    ),
  message: z.string(),
});

export const problemDetailsSchema = z.object({
  type: z
    .string()
    .describe(
      "Problem type URI; `about:blank` when the HTTP status says it all",
    ),
  title: z.string().describe("Short summary of the problem type"),
  status: z.number().int().min(400).max(599),
  detail: z
    .string()
    .optional()
    .describe("Explanation specific to this occurrence"),
  instance: z
    .string()
    .optional()
    .describe("The request path that produced the problem"),
  requestId: z
    .string()
    .describe("Matches the X-Request-Id response header and the server logs"),
  errors: z
    .array(validationIssueSchema)
    .optional()
    .describe("Present on validation problems: one entry per invalid field"),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
