import { Module } from "@nestjs/common";

import { BrandsRepository } from "./brands.repository.js";

@Module({
  providers: [BrandsRepository],
  exports: [BrandsRepository],
})
export class BrandsModule {}
