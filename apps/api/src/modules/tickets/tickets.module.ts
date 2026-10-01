import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { AttachmentsModule } from "../attachments/attachments.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { CustomersModule } from "../customers/customers.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { CustomerTicketsController } from "./customer-tickets.controller.js";
import { MessagesRepository } from "./messages.repository.js";
import { PublicTicketsController } from "./public-tickets.controller.js";
import { StaffCustomersController } from "./staff-customers.controller.js";
import { StaffTicketsController } from "./staff-tickets.controller.js";
import { TicketChanges } from "./ticket-changes.js";
import { TicketMessagesService } from "./ticket-messages.service.js";
import { TicketQueriesService } from "./ticket-queries.service.js";
import { TicketSubmissionService } from "./ticket-submission.service.js";
import { TicketUpdatesService } from "./ticket-updates.service.js";
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
  controllers: [
    PublicTicketsController,
    CustomerTicketsController,
    StaffTicketsController,
    StaffCustomersController,
  ],
  providers: [
    TicketsRepository,
    MessagesRepository,
    TicketChanges,
    TicketSubmissionService,
    TicketQueriesService,
    TicketMessagesService,
    TicketUpdatesService,
  ],
  // Agent management unassigns a deactivated agent's tickets through the
  // same writes, so each one gets its history (ADR-0007, section 5).
  exports: [TicketChanges, TicketsRepository],
})
export class TicketsModule {}
