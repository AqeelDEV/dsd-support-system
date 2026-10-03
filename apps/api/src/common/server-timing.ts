import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestHookHandler,
  onSendHookHandler,
  RouteOptions,
} from "fastify";

/*
 * Server-side processing time for the operations NFR-1 sets a budget for
 * (loading the queue, opening a ticket, replying), as a standard
 * `Server-Timing: app;dur=<ms>` header. It covers everything the server
 * does for the request: parsing, the guards, the handler and its queries,
 * and serialisation, but not the network. The measurement script in
 * test/performance reads it, and so can anyone with the browser's network
 * panel open.
 *
 * Only handlers that opt in send it, all of them staff routes. Precise
 * timings on a public route such as sign-in would help someone measuring
 * how long a password check takes.
 */

const SERVER_TIMING_METADATA = "dsd:server-timing";

/** Reports this handler's processing time in a `Server-Timing` header. */
export const ServerTiming =
  (): MethodDecorator =>
  (_target, _property, descriptor): void => {
    Reflect.defineMetadata(
      SERVER_TIMING_METADATA,
      true,
      descriptor.value as object,
    );
  };

export function reportsServerTiming(handler: object): boolean {
  return Reflect.getMetadata(SERVER_TIMING_METADATA, handler) === true;
}

const started = new WeakMap<FastifyRequest, bigint>();

const startClock: onRequestHookHandler = (request, _reply, done) => {
  started.set(request, process.hrtime.bigint());
  done();
};

const sendTiming: onSendHookHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
  payload,
  done,
) => {
  const start = started.get(request);
  if (start !== undefined) {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    void reply.header("server-timing", `app;dur=${ms.toFixed(1)}`);
  }
  done(null, payload);
};

const asList = <T>(hooks: T | T[] | undefined): T[] =>
  hooks === undefined ? [] : Array.isArray(hooks) ? hooks : [hooks];

/**
 * Adds the timing hooks to every route whose handler opted in, as Fastify
 * registers it. Call it before anything registers routes.
 */
export function reportServerTiming(fastify: FastifyInstance): void {
  fastify.addHook("onRoute", (route: RouteOptions) => {
    if (!reportsServerTiming(route.handler)) return;
    route.onRequest = [startClock, ...asList(route.onRequest)];
    route.onSend = [...asList(route.onSend), sendTiming];
  });
}
