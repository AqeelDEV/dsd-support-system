/*
 * Canned-response variables (FR-12). A template names them as
 * `{{customer.name}}`; the API fills them in for one ticket and the agent
 * edits the result before sending. The output is plain text, like any
 * reply: the composer and React escape it, so a customer's name can't
 * inject anything.
 */

export const CANNED_VARIABLES = {
  "customer.name":
    "The customer's display name, or \"there\" if they haven't set one",
  "customer.email": "The customer's email address",
  "ticket.reference": "The ticket's reference, like DSD-000123",
  "ticket.subject": "The ticket's subject",
  "agent.name": "Your display name",
} as const;

export type CannedVariable = keyof typeof CANNED_VARIABLES;

/** Anything between double braces, so a misspelt variable is caught rather than sent. */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

const isVariable = (name: string): name is CannedVariable =>
  Object.hasOwn(CANNED_VARIABLES, name);

/** The placeholders in `body` that aren't variables, in order, without repeats. */
export function unknownVariables(body: string): string[] {
  const unknown = new Set<string>();
  for (const [, name = ""] of body.matchAll(PLACEHOLDER)) {
    if (!isVariable(name)) unknown.add(name);
  }
  return [...unknown];
}

/** The variables `body` uses, in order, without repeats. */
export function variablesIn(body: string): CannedVariable[] {
  const used = new Set<CannedVariable>();
  for (const [, name = ""] of body.matchAll(PLACEHOLDER)) {
    if (isVariable(name)) used.add(name);
  }
  return [...used];
}

/**
 * Fills every variable in `body` with its value. Values are inserted as
 * they are, never interpreted, so a value containing braces stays text.
 */
export function renderCanned(
  body: string,
  values: Readonly<Record<CannedVariable, string>>,
): string {
  return body.replace(PLACEHOLDER, (placeholder, name: string) =>
    isVariable(name) ? values[name] : placeholder,
  );
}
