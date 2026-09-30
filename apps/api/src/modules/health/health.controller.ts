import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import {
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { livenessSchema, readinessSchema } from "@dsd/shared";
import type { FastifyReply } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";

import { HealthService } from "./health.service.js";

class Liveness extends createZodDto(livenessSchema) {}
class Readiness extends createZodDto(readinessSchema) {}

/**
 * Infrastructure endpoints. They sit outside `/api/v1` because load
 * balancers and orchestrators call them, not API clients.
 */
@ApiTags("Operations")
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("health")
  @ApiOperation({
    summary: "Liveness",
    description:
      "The process is running and can answer. Checks no dependencies.",
  })
  @ZodResponse({
    status: HttpStatus.OK,
    type: Liveness,
    description: "Alive",
  })
  liveness() {
    return { status: "ok" as const };
  }

  @Get("ready")
  @ApiOperation({
    summary: "Readiness",
    description:
      "Checks PostgreSQL and Redis. Returns 503 only when PostgreSQL is unreachable. With only Redis down it returns 200 and `degraded`, so a Redis outage doesn't take every instance out of service.",
  })
  @ZodResponse({
    status: HttpStatus.OK,
    type: Readiness,
    description: "Ready, or degraded without Redis",
  })
  @ApiServiceUnavailableResponse({
    type: Readiness.Output,
    description: "PostgreSQL is unreachable",
  })
  async readiness(@Res({ passthrough: true }) reply: FastifyReply) {
    const readiness = await this.health.readiness();
    if (readiness.status === "unavailable") {
      reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }
}
