/** Download URL for an attachment, through this app's proxy (ADR-0009). */
export const attachmentHref = (ticketId: string, attachmentId: string) =>
  `/api/v1/customer/tickets/${ticketId}/attachments/${attachmentId}`;
