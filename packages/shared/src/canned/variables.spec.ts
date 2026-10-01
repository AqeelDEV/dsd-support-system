import { describe, expect, it } from "vitest";

import {
  type CannedVariable,
  renderCanned,
  unknownVariables,
  variablesIn,
} from "./variables.js";

const VALUES: Record<CannedVariable, string> = {
  "customer.name": "Ada",
  "customer.email": "ada@example.com",
  "ticket.reference": "DSD-000042",
  "ticket.subject": "Router keeps dropping",
  "agent.name": "Sam",
};

describe("canned-response variables", () => {
  it("fills every variable, with or without spaces inside the braces", () => {
    expect(
      renderCanned(
        "Hi {{customer.name}}, about {{ ticket.reference }} ({{ticket.subject}}).\n\n{{agent.name}}",
        VALUES,
      ),
    ).toBe("Hi Ada, about DSD-000042 (Router keeps dropping).\n\nSam");
  });

  it("inserts values as text, never as more template", () => {
    expect(
      renderCanned("Hi {{customer.name}}", {
        ...VALUES,
        "customer.name": "{{agent.name}} <script>",
      }),
    ).toBe("Hi {{agent.name}} <script>");
  });

  it("finds unknown and misspelt placeholders", () => {
    expect(
      unknownVariables(
        "Hi {{customer.name}} {{customer.nmae}} {{ order.id }} {{}} {{customer.nmae}}",
      ),
    ).toEqual(["customer.nmae", "order.id", ""]);
    expect(unknownVariables("No placeholders, just { braces }.")).toEqual([]);
  });

  it("lists the variables a template uses", () => {
    expect(
      variablesIn("{{agent.name}} {{customer.name}} {{agent.name}} {{x.y}}"),
    ).toEqual(["agent.name", "customer.name"]);
  });
});
