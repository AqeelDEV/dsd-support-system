import { Module } from "@nestjs/common";

import { CustomersRepository } from "./customers.repository.js";

@Module({
  providers: [CustomersRepository],
  exports: [CustomersRepository],
})
export class CustomersModule {}
