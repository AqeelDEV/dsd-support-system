import {
  AGENT_ROLES,
  AGENT_STATUSES,
  KB_ARTICLE_STATUSES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "@dsd/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AGENT_STATUS_LABELS,
  ARTICLE_STATUS_LABELS,
  CUSTOMER_STATUS_LABELS,
  PRIORITY_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  StatusBadge,
} from "./badge";

describe("labels", () => {
  it.each([
    ["status", STATUS_LABELS, TICKET_STATUSES],
    ["customer status", CUSTOMER_STATUS_LABELS, TICKET_STATUSES],
    ["priority", PRIORITY_LABELS, TICKET_PRIORITIES],
    ["role", ROLE_LABELS, AGENT_ROLES],
    ["agent status", AGENT_STATUS_LABELS, AGENT_STATUSES],
    ["article status", ARTICLE_STATUS_LABELS, KB_ARTICLE_STATUSES],
  ] as const)("name every %s value exactly once", (_name, labels, values) => {
    expect(Object.keys(labels).sort()).toEqual([...values].sort());
  });

  it("words a status from the customer's side when asked", () => {
    expect(
      renderToStaticMarkup(
        <StatusBadge status="pending_customer" audience="customer" />,
      ),
    ).toContain("Awaiting your reply");
  });
});
