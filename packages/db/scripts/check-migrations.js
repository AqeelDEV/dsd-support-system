// Fails when the Drizzle schema and the committed migrations disagree.
// drizzle-kit writes a new migration if the schema has changed since the
// last snapshot; any new or modified file under migrations/ means someone
// changed the schema without generating (and committing) its migration.
import { execSync } from "node:child_process";

// Fixed commands, run through the shell so `pnpm` resolves on every platform.
const run = (command) =>
  execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

run("pnpm exec drizzle-kit generate --name=unexpected_schema_drift");
const changes = run("git status --porcelain -- migrations").trim();

if (changes !== "") {
  process.stderr.write(
    `The schema has changes that no committed migration contains:\n${changes}\n` +
      "Run `pnpm --filter @dsd/db db:generate`, review the SQL, and commit it.\n",
  );
  process.exit(1);
}
process.stdout.write("Schema and migrations agree.\n");
