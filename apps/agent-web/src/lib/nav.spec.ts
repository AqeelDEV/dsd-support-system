import { permissionsFor } from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { NAV, visibleNav } from "./nav";

const labels = (role: "agent" | "supervisor" | "admin") =>
  visibleNav(permissionsFor(role)).map((item) => item.label);

describe("visibleNav", () => {
  it("shows agents the queue, knowledge base and canned responses only", () => {
    expect(labels("agent")).toEqual([
      "Queue",
      "Knowledge base",
      "Canned responses",
    ]);
  });

  it("shows supervisors and admins every section", () => {
    const all = NAV.map((item) => item.label);
    expect(labels("supervisor")).toEqual(all);
    expect(labels("admin")).toEqual(all);
  });

  it("shows nothing without permissions", () => {
    expect(visibleNav([])).toEqual([]);
  });
});
