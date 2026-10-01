import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { AttachmentsModule } from "../attachments/attachments.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { CustomersModule } from "../customers/customers.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { CustomerTicketsController } from "./customer-tickets.controller.js";
import { PublicTicketsController } from "./public-tickets.controller.js";
import { TicketSubmissionService } from "./ticket-submission.service.js";
import { TicketsRepository } from "./tickets.repository.js";

/** Tickets and their conversations (ADR-0007, ADR-0011). */
@Module({
  imports: [
    AuthModule,
    AttachmentsModule,
    AuditModule,
    CustomersModule,
    OutboxModule,
  ],
  controllers: [PublicTicketsController, CustomerTicketsController],
  providers: [TicketsRepository, TicketSubmissionService],
})
export class TicketsModule {}
