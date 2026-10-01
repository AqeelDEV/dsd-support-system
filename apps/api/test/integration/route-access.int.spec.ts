import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { describe, expect, it } from "vitest";

import {
  Public,
  Realm,
  RequirePermissions,
} from "../../src/auth/decorators.js";
import { enforceRouteAccess } from "../../src/auth/route-access.js";

@Realm("staff")
@RequirePermissions("report:view")
@Controller("api/v1/staff/reports")
class DeclaredController {
  @Get("volume")
  volume() {
    return [];
  }
}

@Controller("api/v1/staff/agents")
class ForgottenController {
  @Get()
  list() {
    return [];
  }
}

@Realm("staff")
@Controller("api/v1/staff/exports")
class UnguardedController {
  @Get()
  list() {
    return [];
  }
}

@Public()
@Controller("api/v1/staff/exports")
class MisplacedController {
  @Get()
  list() {
    return [];
  }
}

async function boot(
  controller: new () => unknown,
): Promise<NestFastifyApplication> {
  @Module({ controllers: [controller] })
  class FixtureModule {}

  const adapter = new FastifyAdapter();
  enforceRouteAccess(adapter.getInstance());
  const app = await NestFactory.create<NestFastifyApplication>(
    FixtureModule,
    adapter,
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/**
 * The boot check against real Nest routing (ADR-0004, section 2): the
 * API must refuse to start when a route has no access rule, or one that
 * contradicts its path.
 */
describe("route access check at startup", () => {
  it("starts when every route declares where it belongs", async () => {
    const app = await boot(DeclaredController);
    await app.close();
  });

  it("refuses to start when a route declares no access", async () => {
    await expect(boot(ForgottenController)).rejects.toThrow(
      "GET /api/v1/staff/agents declares neither @Public() nor @Realm()",
    );
  });

  it("refuses to start when staff work requires no permission", async () => {
    await expect(boot(UnguardedController)).rejects.toThrow(
      "GET /api/v1/staff/exports is staff work but requires no permission",
    );
  });

  it("refuses to start when a public route sits under the staff prefix", async () => {
    await expect(boot(MisplacedController)).rejects.toThrow(
      "GET /api/v1/staff/exports is @Public() but lives outside",
    );
  });
});
