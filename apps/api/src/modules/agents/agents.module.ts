import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { TicketsModule } from "../tickets/tickets.module.js";
import { AgentsController } from "./agents.controller.js";
import { AgentsRepository } from "./agents.repository.js";
import { AgentsService } from "./agents.service.js";

/** Agent accounts and roles (FR-14; ADR-0004, section 4). */
@Module({
  imports: [AuthModule, AuditModule, OutboxModule, TicketsModule],
  controllers: [AgentsController],
  providers: [AgentsRepository, AgentsService],
})
export class AgentsModule {}
