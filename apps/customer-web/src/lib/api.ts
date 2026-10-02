import { createBrowserClient } from "@dsd/api-client";

/** The customer app's API client: same origin, through the `/api` proxy. */
export const api = createBrowserClient("customer");
