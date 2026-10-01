import { z } from "zod";
import { createZodDto } from "nestjs-zod";

/** Path parameters. A malformed ID is a 400; a well-formed unknown one is a 404. */
export class TicketParams extends createZodDto(
  z.strictObject({ ticketId: z.uuid() }),
) {}

export class AttachmentParams extends createZodDto(
  z.strictObject({ ticketId: z.uuid(), attachmentId: z.uuid() }),
) {}

export class CustomerParams extends createZodDto(
  z.strictObject({ customerId: z.uuid() }),
) {}
