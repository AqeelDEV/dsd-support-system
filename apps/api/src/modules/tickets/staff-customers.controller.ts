import { Controller, Get, HttpStatus, Param, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { pageQuerySchema, staffCustomerSchema } from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import { Realm, RequirePermissions } from "../../auth/decorators.js";
import { staffOf } from "../../auth/request-context.js";
import { ApiProblem, ApiSession } from "../../openapi/decorators.js";
import { CustomerParams } from "./params.js";
import { TicketQueriesService } from "./ticket-queries.service.js";

class PageQuery extends createZodDto(pageQuerySchema) {}
class StaffCustomer extends createZodDto(staffCustomerSchema) {}

/** The customer behind a ticket, and their other tickets (FR-8). */
@ApiTags("Customers (staff)")
@Realm("staff")
@Controller("staff/customers")
export class StaffCustomersController {
  constructor(private readonly queries: TicketQueriesService) {}

  @Get(":customerId")
  @RequirePermissions("customer:read")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "A customer and their tickets",
    description:
      "Their profile and their tickets in your brands, newest first, a page at a time. A customer with no ticket in your brands is a 404.",
  })
  @ApiProblem(400, "The cursor is invalid")
  @ApiProblem(403, "Missing the `customer:read` permission")
  @ApiProblem(404, "No such customer in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: StaffCustomer })
  view(
    @Param() params: CustomerParams,
    @Query() query: PageQuery,
    @Req() request: FastifyRequest,
  ) {
    return this.queries.staffCustomer(
      staffOf(request),
      params.customerId,
      query,
    );
  }
}
