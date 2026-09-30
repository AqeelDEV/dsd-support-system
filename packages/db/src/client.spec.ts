import net from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPool, pingDatabase, type Pool } from "./client.js";

/** A port on localhost that nothing listens on. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  return port;
}

/** A server that accepts connections and never answers. */
async function silentServer(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => sockets.add(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

describe("pingDatabase", () => {
  let pool: Pool | undefined;

  afterEach(async () => {
    await pool?.end();
    pool = undefined;
  });

  it("reports false when nothing is listening", async () => {
    const port = await closedPort();
    pool = createPool({
      connectionString: `postgres://nobody:secret@127.0.0.1:${port}/none`,
      applicationName: "test",
      onError: vi.fn(),
    });
    await expect(pingDatabase(pool, 2_000)).resolves.toBe(false);
  });

  it("gives up after the timeout when the server never answers", async () => {
    const server = await silentServer();
    try {
      pool = createPool({
        connectionString: `postgres://nobody:secret@127.0.0.1:${server.port}/none`,
        applicationName: "test",
        onError: vi.fn(),
        connectionTimeoutMillis: 10_000,
      });
      const started = Date.now();
      await expect(pingDatabase(pool, 200)).resolves.toBe(false);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await server.close();
    }
  });
});
