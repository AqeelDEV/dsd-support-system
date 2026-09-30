import createClient, { type ClientOptions } from "openapi-fetch";

import type { paths } from "./schema";

/**
 * A client whose paths, parameters and response bodies are all typed from
 * the API's OpenAPI document. Front ends call the API only through this
 * (FR-16), so a contract change shows up as a type error in the apps.
 */
export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>(options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
