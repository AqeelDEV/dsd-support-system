/** Liveness for the container healthcheck. Doesn't depend on the API. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok" });
}
