import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

/** A request as the stub received it. */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

/** What the stub answers; `hang` leaves the request open until the client gives up. */
export type StubReply =
  | { status?: number; body: unknown; headers?: Record<string, string> }
  | { hang: true };

/**
 * A local HTTP server standing in for an AI provider, for contract tests
 * of the real adapters: it records exactly what each SDK sends and answers
 * with whatever the test scripts, including errors and silence. Nothing
 * leaves the machine and no key is needed.
 */
export class StubServer {
  readonly requests: RecordedRequest[] = [];
  private respond: (request: RecordedRequest) => StubReply = () => ({
    status: 500,
    body: { error: "no reply scripted" },
  });

  private constructor(
    private readonly server: http.Server,
    readonly url: string,
  ) {}

  static async start(): Promise<StubServer> {
    const server = http.createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    const stub = new StubServer(server, `http://127.0.0.1:${String(port)}`);
    server.on("request", (incoming, outgoing) => {
      stub.handle(incoming, outgoing);
    });
    return stub;
  }

  private handle(
    incoming: http.IncomingMessage,
    outgoing: http.ServerResponse,
  ): void {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const request: RecordedRequest = {
        method: incoming.method ?? "",
        path: incoming.url ?? "",
        headers: incoming.headers,
        body: text === "" ? undefined : (JSON.parse(text) as unknown),
      };
      this.requests.push(request);
      const reply = this.respond(request);
      if ("hang" in reply) return;
      outgoing.writeHead(reply.status ?? 200, {
        "content-type": "application/json",
        ...reply.headers,
      });
      outgoing.end(JSON.stringify(reply.body));
    });
  }

  /** Scripts the answer to every request from now on. */
  reply(respond: (request: RecordedRequest) => StubReply): void {
    this.respond = respond;
  }

  /** Forgets earlier requests. */
  reset(): void {
    this.requests.length = 0;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

/** A vector of the index's length, distinct per seed. */
export const vectorOf = (seed: number, length = 1_024): number[] =>
  Array.from({ length }, (_, index) => ((index + seed) % 7) / 7);
