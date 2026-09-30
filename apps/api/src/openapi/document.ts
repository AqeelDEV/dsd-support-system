import type { INestApplication } from "@nestjs/common";
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from "@nestjs/swagger";
import { problemDetailsSchema } from "@dsd/shared";
import { cleanupOpenApiDoc, createZodDto } from "nestjs-zod";

class ProblemDetails extends createZodDto(problemDetailsSchema) {}

const DESCRIPTION = `The API behind the DSD customer app and the DSD agent app.

All routes except \`/health\` and \`/ready\` live under \`/api/v1\`. Errors use RFC 9457 problem details (\`application/problem+json\`); every response carries an \`X-Request-Id\` header that matches the \`requestId\` in an error body and the server logs.`;

/**
 * Builds the OpenAPI 3.1 document from the controllers and their zod
 * schemas. The same document is served by Swagger UI and committed as
 * openapi.json, and CI fails if the committed copy is out of date (API-1).
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("DSD Unified Customer Support API")
    .setDescription(DESCRIPTION)
    .setVersion("1.0.0")
    .setOpenAPIVersion("3.1.0")
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ProblemDetails],
  });
  return cleanupOpenApiDoc(document, { version: "3.1" });
}

export const API_DOCS_PATH = "api/docs";
export const OPENAPI_JSON_PATH = "api/docs/openapi.json";

export function serveApiDocs(
  app: INestApplication,
  document: OpenAPIObject,
): void {
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    yamlDocumentUrl: "",
    customSiteTitle: "DSD Support API",
  });
}
