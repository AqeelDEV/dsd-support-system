import { Module } from "@nestjs/common";

import { BrandsModule } from "../brands/brands.module.js";
import { CannedResponsesController } from "./canned-responses.controller.js";
import { CannedResponsesRepository } from "./canned-responses.repository.js";
import { CannedResponsesService } from "./canned-responses.service.js";

/** Reply templates (FR-12). */
@Module({
  imports: [BrandsModule],
  controllers: [CannedResponsesController],
  providers: [CannedResponsesRepository, CannedResponsesService],
})
export class CannedResponsesModule {}
