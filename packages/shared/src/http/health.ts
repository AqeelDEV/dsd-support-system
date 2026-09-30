import { z } from "zod";

export const livenessSchema = z.object({
  status: z.literal("ok"),
});

export const dependencyStatusSchema = z.enum(["up", "down"]);

/**
 * `/ready` reports each dependency. Only PostgreSQL decides readiness: with
 * Redis down the API still serves core support work, so it reports
 * `degraded` rather than asking the load balancer to take it out of service.
 */
export const readinessSchema = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]),
  checks: z.object({
    database: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
});

export type Liveness = z.infer<typeof livenessSchema>;
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
