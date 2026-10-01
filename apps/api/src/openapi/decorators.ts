import { applyDecorators } from "@nestjs/common";
import { ApiResponse, ApiSecurity } from "@nestjs/swagger";
import { PROBLEM_JSON, type SessionRealm } from "@dsd/shared";

/** Names of the security schemes in the OpenAPI document. */
export const SECURITY_SCHEMES = {
  customer: "customerSession",
  staff: "staffSession",
  csrf: "csrfToken",
} as const;

const problem = (status: number, description: string) =>
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
    problem(401, "No valid session for this realm"),
    ...(options.changesState
      ? [
          problem(
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
    problem(
      400,
      "The body doesn't match its schema (`validation-error`), or an emailed link is unknown, expired or used (`invalid-token`)",
    ),
    problem(403, "Not sent from a trusted origin (`csrf-rejected`)"),
    problem(
      429,
      "Too many attempts; `Retry-After` says when to try again (`rate-limited`)",
    ),
    problem(
      503,
      "The rate-limit store is unreachable, so the request is refused rather than allowed unlimited",
    ),
  );
}

/** A wrong password, an unknown account or an unusable one: always the same 401. */
export const ApiWrongCredentials = () =>
  problem(401, "The email or password is incorrect");
