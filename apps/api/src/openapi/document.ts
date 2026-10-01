import type { INestApplication } from "@nestjs/common";
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from "@nestjs/swagger";
import { problemDetailsSchema } from "@dsd/shared";
import { cleanupOpenApiDoc, createZodDto } from "nestjs-zod";

import { cookieNames } from "../auth/cookies.js";
import { SECURITY_SCHEMES } from "./decorators.js";

class ProblemDetails extends createZodDto(problemDetailsSchema) {}

const DESCRIPTION = `The API behind the DSD customer app and the DSD agent app.

All routes except \`/health\` and \`/ready\` live under \`/api/v1\`. Errors use RFC 9457 problem details (\`application/problem+json\`); every response carries an \`X-Request-Id\` header that matches the \`requestId\` in an error body and the server logs.

## Signing in

Customers and staff are separate realms with separate routes, cookies and sessions: \`/api/v1/auth/customer/*\` and \`/api/v1/customer/*\` for customers, \`/api/v1/auth/staff/*\` and \`/api/v1/staff/*\` for staff. A session from one realm is refused (401) by every route of the other.

Signing in sets an HttpOnly session cookie and a readable CSRF cookie, and returns the CSRF token in the body too (it is also in \`me\`). Every POST, PUT, PATCH and DELETE must come from a trusted origin, and once signed in must send that token in the \`X-CSRF-Token\` header.

To try it here, sign in with "Try it out" on a \`login\` route: the browser keeps the cookies, and this page copies the CSRF token into the header for you.`;

/**
 * Builds the OpenAPI 3.1 document from the controllers and their zod
 * schemas. The same document is served by Swagger UI and committed as
 * openapi.json, and CI fails if the committed copy is out of date (API-1).
 * `secureCookies` names the cookies the way this instance sets them.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  secureCookies: boolean,
): OpenAPIObject {
  const cookie = (realm: "customer" | "staff") => ({
    type: "apiKey" as const,
    in: "cookie",
    name: cookieNames(realm, secureCookies).session,
    description: `Set by the ${realm} login route. HttpOnly, so scripts can't read it.`,
  });
  const config = new DocumentBuilder()
    .setTitle("DSD Unified Customer Support API")
    .setDescription(DESCRIPTION)
    .setVersion("1.0.0")
    .setOpenAPIVersion("3.1.0")
    .addSecurity(SECURITY_SCHEMES.customer, cookie("customer"))
    .addSecurity(SECURITY_SCHEMES.staff, cookie("staff"))
    .addSecurity(SECURITY_SCHEMES.csrf, {
      type: "apiKey",
      in: "header",
      name: "X-CSRF-Token",
      description:
        "The csrfToken from login or me. Required with the session cookie on every state-changing request.",
    })
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ProblemDetails],
  });
  return cleanupOpenApiDoc(document, { version: "3.1" });
}

export const API_DOCS_PATH = "api/docs";
export const OPENAPI_JSON_PATH = "api/docs/openapi.json";

interface SwaggerRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Runs in the browser, inside Swagger UI, before every "Try it out"
 * request. It copies the right realm's CSRF cookie into the header, as the
 * web apps do, so signed-in requests work from this page. Swagger UI
 * serialises it with toString(), so it must not use anything from outside
 * its own body.
 */
const copyCsrfCookieIntoHeader = (request: SwaggerRequest): SwaggerRequest => {
  const realm = /\/api\/v1\/(auth\/)?staff\//.test(request.url)
    ? "staff"
    : "customer";
  const browser = globalThis as unknown as { document: { cookie: string } };
  const cookie = browser.document.cookie
    .split("; ")
    .find(
      (entry) =>
        entry.startsWith(`__Host-dsd_${realm}_csrf=`) ||
        entry.startsWith(`dsd_${realm}_csrf=`),
    );
  if (cookie !== undefined) {
    request.headers["X-CSRF-Token"] = cookie.slice(cookie.indexOf("=") + 1);
  }
  return request;
};

export function serveApiDocs(
  app: INestApplication,
  document: OpenAPIObject,
): void {
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    // JSON only. An empty yamlDocumentUrl doesn't turn YAML off; it falls
    // back to serving it at /api/docs-yaml.
    raw: ["json"],
    customSiteTitle: "DSD Support API",
    swaggerOptions: { requestInterceptor: copyCsrfCookieIntoHeader },
  });
}
