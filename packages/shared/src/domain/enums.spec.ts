import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as enums from "./enums.js";

/** The "Enums" table in docs/DATA_MODEL.md, as enum name to values. */
function documentedEnums(): Map<string, string[]> {
  const doc = readFileSync(
    new URL("../../../../docs/DATA_MODEL.md", import.meta.url),
    "utf8",
  );
  const section = doc.split("## Enums")[1]?.split("\n## ")[0] ?? "";
  const documented = new Map<string, string[]>();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    const name = /^`([a-z_]+)`$/.exec(cells[1] ?? "")?.[1];
    if (name === undefined || cells[2] === undefined) continue;
    documented.set(
      name,
      [...cells[2].matchAll(/`([a-z_]+)`/g)].map((match) => match[1] ?? ""),
    );
  }
  return documented;
}

const inCode: Record<string, readonly string[]> = {
  ticket_status: enums.TICKET_STATUSES,
  ticket_priority: enums.TICKET_PRIORITIES,
  ticket_channel: enums.TICKET_CHANNELS,
  agent_role: enums.AGENT_ROLES,
  session_realm: enums.SESSION_REALMS,
  auth_token_purpose: enums.AUTH_TOKEN_PURPOSES,
  participant_type: enums.PARTICIPANT_TYPES,
  actor_type: enums.ACTOR_TYPES,
  message_visibility: enums.MESSAGE_VISIBILITIES,
  kb_article_status: enums.KB_ARTICLE_STATUSES,
  ai_suggestion_kind: enums.AI_SUGGESTION_KINDS,
  ai_suggestion_status: enums.AI_SUGGESTION_STATUSES,
  feedback_rating: enums.FEEDBACK_RATINGS,
  notification_channel: enums.NOTIFICATION_CHANNELS,
  notification_status: enums.NOTIFICATION_STATUSES,
};

describe("domain enums", () => {
  it("match the data model document, value for value and in order", () => {
    expect(Object.fromEntries(documentedEnums())).toEqual(
      Object.fromEntries(
        Object.entries(inCode).map(([name, values]) => [name, [...values]]),
      ),
    );
  });

  it("order priorities from least to most urgent", () => {
    expect(enums.TICKET_PRIORITIES).toEqual([
      "low",
      "normal",
      "high",
      "urgent",
    ]);
  });
});
