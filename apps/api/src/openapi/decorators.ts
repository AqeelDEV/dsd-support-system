import { applyDecorators } from "@nestjs/common";
import {
  ApiBody,
  ApiConsumes,
  ApiResponse,
  ApiSecurity,
  type SchemaObject,
} from "@nestjs/swagger";
import {
  ATTACHMENT_LIMITS,
  ATTACHMENTS_FIELD,
  PROBLEM_JSON,
  type SessionRealm,
} from "@dsd/shared";
import { z } from "zod";

/** Names of the security schemes in the OpenAPI document. */
export const SECURITY_SCHEMES = {
  customer: "customerSession",
  staff: "staffSession",
  csrf: "csrfToken",
} as const;

/** Documents an error response with a problem-details body. */
export const ApiProblem = (status: number, description: string) =>
  ApiResponse({
    status,
    description,
    content: {
      [PROBLEM_JSON]: {
        schema: { $ref: "#/components/schemas/ProblemDetails" },
      },
    },
  });

/**
 * Documents a route that needs a session of `realm`. A state-changing one
 * also needs the CSRF header, and both together (one requirement object
 * means AND in OpenAPI).
 */
export function ApiSession(
  realm: SessionRealm,
  options: { changesState: boolean },
) {
  const scheme = SECURITY_SCHEMES[realm];
  return applyDecorators(
    ApiSecurity(
      options.changesState
        ? { [scheme]: [], [SECURITY_SCHEMES.csrf]: [] }
        : { [scheme]: [] },
    ),
    ApiProblem(401, "No valid session for this realm"),
    ...(options.changesState
      ? [
          ApiProblem(
            403,
            "The Origin or the CSRF token was missing or wrong (`csrf-rejected`)",
          ),
        ]
      : []),
  );
}

/** Documents a public form: origin-checked, validated and rate limited. */
export function ApiPublicForm() {
  return applyDecorators(
    ApiProblem(
      400,
      "The body doesn't match its schema (`validation-error`), or an emailed link is unknown, expired or used (`invalid-token`)",
    ),
    ApiProblem(403, "Not sent from a trusted origin (`csrf-rejected`)"),
    ApiProblem(
      429,
      "Too many attempts; `Retry-After` says when to try again (`rate-limited`)",
    ),
    ApiProblem(
      503,
      "The rate-limit store is unreachable, so the request is refused rather than allowed unlimited",
    ),
  );
}

/** A wrong password, an unknown account or an unusable one: always the same 401. */
export const ApiWrongCredentials = () =>
  ApiProblem(401, "The email or password is incorrect");

/**
 * Documents a multipart/form-data body (ADR-0011): the fields of `fields`
 * first, then up to five files in `attachments`.
 */
export function ApiMultipartBody(fields: z.ZodObject) {
  const json = z.toJSONSchema(fields, { io: "input" }) as SchemaObject;
  const maxMb = ATTACHMENT_LIMITS.maxBytes / (1024 * 1024);
  return applyDecorators(
    ApiConsumes("multipart/form-data"),
    ApiBody({
      description: `Send every field before the first file. Files are judged by their content, not their name: PNG, JPEG, GIF, WebP, PDF or plain UTF-8 text, at most ${maxMb} MB each.`,
      schema: {
        type: "object",
        required: json.required ?? [],
        properties: {
          ...json.properties,
          [ATTACHMENTS_FIELD]: {
            type: "array",
            maxItems: ATTACHMENT_LIMITS.maxFiles,
            items: { type: "string", format: "binary" },
            // Without a default, Swagger UI fills an unused file slot with
            // the sample text "string"; with it, it sends an empty value,
            // which the API reads as no file chosen.
            default: [],
            description: `Up to ${ATTACHMENT_LIMITS.maxFiles} files`,
          },
        },
      },
    }),
    ApiProblem(413, `A file is over ${maxMb} MB`),
    ApiProblem(
      415,
      "A file isn't an accepted type, or the body isn't multipart/form-data",
    ),
    ApiProblem(
      503,
      "File storage is unavailable; the same request without files still works",
    ),
  );
}
