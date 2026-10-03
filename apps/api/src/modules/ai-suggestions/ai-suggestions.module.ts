import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { TicketsModule } from "../tickets/tickets.module.js";
import { AiSuggestionsController } from "./ai-suggestions.controller.js";
import { AiSuggestionsRepository } from "./ai-suggestions.repository.js";
import { AiSuggestionsService } from "./ai-suggestions.service.js";

/** Reading, requesting and rating AI reply suggestions (ADR-0006). The worker drafts them. */
@Module({
  imports: [AuthModule, OutboxModule, TicketsModule],
  controllers: [AiSuggestionsController],
  providers: [AiSuggestionsRepository, AiSuggestionsService],
})
export class AiSuggestionsModule {}
