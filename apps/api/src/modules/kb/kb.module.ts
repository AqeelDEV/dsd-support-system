import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { BrandsModule } from "../brands/brands.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { KbPublicController } from "./kb-public.controller.js";
import { KbPublicService } from "./kb-public.service.js";
import { KbStaffController } from "./kb-staff.controller.js";
import { KbStaffService } from "./kb-staff.service.js";
import { KbRepository } from "./kb.repository.js";

/** The knowledge base: authoring for staff (FR-15), the help centre for everyone (FR-4). */
@Module({
  imports: [AuditModule, BrandsModule, OutboxModule],
  controllers: [KbPublicController, KbStaffController],
  providers: [KbRepository, KbStaffService, KbPublicService],
})
export class KbModule {}
