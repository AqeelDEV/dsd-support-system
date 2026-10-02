import { createBrowserClient } from "@dsd/api-client";

/** The agent app's API client: same origin, through the `/api` proxy (staff routes only). */
export const api = createBrowserClient("staff");

/** Download URL for an attachment, through this app's proxy (ADR-0009). */
export const attachmentHref = (ticketId: string, attachmentId: string) =>
  `/api/v1/staff/tickets/${ticketId}/attachments/${attachmentId}`;
