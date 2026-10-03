// Tries to reach AI suggestions with a customer's session, as a reviewer
// would (README, "How an AI draft can never reach a customer"). It runs
// inside the API container, so it needs nothing installed on the host:
//
//   cat scripts/try-the-guardrail.mjs | docker compose exec -T api node --input-type=module -
//
// It signs in as the demo customer once, calls every staff suggestion route
// with that session, and reads the customer's own tickets looking for any
// trace of a suggestion. Each check prints PASS or FAIL; the exit code is 1
// if any failed.

const API = "http://127.0.0.1:4000";
const ORIGIN = "http://localhost:4000";
const SOME_ID = "0199a1b2-0000-7000-8000-000000000001";
let failed = 0;

function report(ok, what, detail) {
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` (${detail})` : ""}`,
  );
}

const login = await fetch(`${API}/api/v1/auth/customer/login`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN },
  body: JSON.stringify({
    email: "customer@example.com",
    password: "dsd-demo-password",
  }),
});
if (login.status !== 200) {
  console.log(`Couldn't sign in as the demo customer: HTTP ${login.status}`);
  process.exit(1);
}
const cookies = login.headers
  .getSetCookie()
  .map((cookie) => cookie.split(";")[0]);
const cookie = cookies.join("; ");
const csrf =
  cookies
    .find((c) => /csrf=/.test(c))
    ?.split("=")
    .slice(1)
    .join("=") ?? "";
report(cookies.length > 0, "signed in as customer@example.com");

const attempts = [
  ["GET", `/api/v1/staff/tickets/${SOME_ID}/ai-suggestions`],
  ["POST", `/api/v1/staff/tickets/${SOME_ID}/ai-suggestions`],
  ["PUT", `/api/v1/staff/ai-suggestions/${SOME_ID}/feedback`],
];
for (const [method, path] of attempts) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      cookie,
      origin: ORIGIN,
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
    body: method === "GET" ? undefined : JSON.stringify({ rating: "up" }),
  });
  report(
    response.status === 401,
    `a customer session is refused on ${method} ${path.replace(SOME_ID, "{id}")}`,
    `HTTP ${response.status}`,
  );
}

/** Every property name anywhere in a JSON value. */
function keysOf(value, into = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      keysOf(item, into);
    }
  }
  return into;
}

const list = await fetch(`${API}/api/v1/customer/tickets?limit=100`, {
  headers: { cookie },
});
const page = await list.json();
const keys = keysOf(page);
let opened = 0;
for (const item of page.items ?? []) {
  const view = await fetch(`${API}/api/v1/customer/tickets/${item.id}`, {
    headers: { cookie },
  });
  keysOf(await view.json(), keys);
  opened += 1;
}
const leaked = [...keys].filter((key) => /suggestion|approved/i.test(key));
report(
  list.status === 200 && opened > 0 && leaked.length === 0,
  `the customer's ${opened} tickets carry no suggestion or approval fields`,
  leaked.length === 0 ? undefined : leaked.join(", "),
);

console.log(failed === 0 ? "All checks passed" : `${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
