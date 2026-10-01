import { Module } from "@nestjs/common";

import { AttachmentIntake } from "./attachment-intake.js";
import { AttachmentsRepository } from "./attachments.repository.js";

/** Uploaded files: checking them, storing them and serving them (ADR-0009). */
@Module({
  providers: [AttachmentIntake, AttachmentsRepository],
  exports: [AttachmentIntake, AttachmentsRepository],
})
export class AttachmentsModule {}
