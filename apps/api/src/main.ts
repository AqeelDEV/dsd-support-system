import "reflect-metadata";

import { createApp } from "./app.factory.js";
import { ConfigError, parseEnv } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const app = await createApp(env);
  await app.listen({ host: env.HOST, port: env.PORT });
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet, so startup failures go straight to stderr.
  const message =
    error instanceof ConfigError
      ? error.message
      : `API failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
