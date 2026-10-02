import { describe, expect, it } from "vitest";

import {
  parseFilters,
  toQuery,
  toSearch,
  VIEWS,
  viewOf,
  withView,
} from "./queue";

const parse = (search: string) => parseFilters(new URLSearchParams(search));

describe("queue filters in the URL", () => {
  it("defaults to open tickets by priority", () => {
    expect(parse("")).toEqual({
      status: ["open"],
      priority: [],
      assignee: undefined,
      escalated: undefined,
      sort: "priority",
    });
  });

  it("round-trips through the address bar", () => {
    const filters = parse(
      "status=open&status=pending_customer&priority=urgent&assignee=me&escalated=true&sort=oldest",
    );
    expect(parse(toSearch(filters))).toEqual(filters);
    expect(toSearch(filters)).toContain("sort=oldest");
  });

  it("ignores values the API wouldn't accept", () => {
    expect(
      parse("status=bogus&priority=whenever&sort=random&escalated=maybe"),
    ).toEqual(parse(""));
  });

  it("leaves the default sort out of the URL", () => {
    expect(toSearch(parse(""))).toBe("status=open");
  });
});

describe("saved views", () => {
  it("recognises every saved view from its own filters", () => {
    for (const view of VIEWS) {
      expect(viewOf(withView(view, parse("sort=newest")))?.id).toBe(view.id);
    }
  });

  it("keeps the sort and priority when switching view", () => {
    const current = parse("priority=high&sort=oldest");
    const unassigned = VIEWS.find((view) => view.id === "unassigned");
    if (unassigned === undefined) throw new Error("no unassigned view");
    const next = withView(unassigned, current);
    expect(next).toMatchObject({
      sort: "oldest",
      priority: ["high"],
      assignee: "unassigned",
    });
  });
});

describe("toQuery", () => {
  it("sends only the filters that are set, as the query string carries them", () => {
    expect(toQuery(parse("escalated=true")).escalated).toBe("true");
    expect(toQuery(parse("status=open"), "abc")).toEqual({
      status: ["open"],
      sort: "priority",
      limit: 50,
      cursor: "abc",
    });
  });
});
