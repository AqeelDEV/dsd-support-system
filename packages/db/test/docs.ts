import { readFileSync } from "node:fs";

/**
 * Reads the names docs/DATA_MODEL.md commits to, so tests can check the
 * database against the document and neither can drift from the other.
 */
const doc = readFileSync(
  new URL("../../../docs/DATA_MODEL.md", import.meta.url),
  "utf8",
);

function section(heading: string): string {
  const start = doc.indexOf(heading);
  if (start === -1)
    throw new Error(`DATA_MODEL.md has no "${heading}" section`);
  const rest = doc.slice(start + heading.length);
  const end = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The table rows of a markdown section, as arrays of trimmed cells. */
function rows(markdown: string): string[][] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .slice(1)
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

const backticked = (cell: string) =>
  [...cell.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? "");

/** Every table, from the privilege matrix (which lists all of them). */
export const documentedTables = (): string[] =>
  rows(section("## Database roles and privileges")).flatMap((row) =>
    backticked(row[0] ?? ""),
  );

/** Every named CHECK constraint. */
export const documentedChecks = (): string[] =>
  rows(section("### CHECK constraints")).flatMap((row) =>
    backticked(row[1] ?? ""),
  );

/** Every trigger. */
export const documentedTriggers = (): string[] =>
  rows(section("### Triggers")).flatMap((row) => backticked(row[0] ?? ""));

/**
 * The privilege matrix: for each table, what `dsd_api` and `dsd_worker` may
 * do, as the letters S, I, U, D. Column-level grants are described in
 * words in the document and returned as written.
 */
export const documentedPrivileges = (): Map<
  string,
  { api: string; worker: string }
> =>
  new Map(
    rows(section("## Database roles and privileges")).map((row) => [
      backticked(row[0] ?? "")[0] ?? "",
      { api: row[1] ?? "", worker: row[2] ?? "" },
    ]),
  );

/** Every view, with what each role may do with it (the same letters as the matrix). */
export const documentedViews = (): Map<
  string,
  { api: string; worker: string }
> =>
  new Map(
    rows(section("## Views")).map((row) => [
      backticked(row[0] ?? "")[0] ?? "",
      { api: row[2] ?? "", worker: row[3] ?? "" },
    ]),
  );
