# ADR-0003: Authentication, sessions and the customer and staff realms

- Status: Accepted
- Date: 2026-09-30
- Amended: 2026-10-01 and 2026-10-02 (see [Amendments](#amendments))
- Requirements: FR-2, FR-17, NFR-2, NFR-5, NFR-6, NFR-9

## Context

Two very different populations use the system. Customers are the general public: some have accounts, many never will (FR-2). Staff are agents, supervisors and admins who can see every customer's tickets in their brand. FR-17 requires the system to tell these sessions apart and enforce the difference on the server.

The SRS adds constraints that shape the design:

- A guest submits a ticket with only an email address, but must still be able to follow it. If they later register with the same email, their earlier tickets should appear in their account (FR-2).
- Session state must live outside the API process, so any instance can serve any request (NFR-2).
- Passwords must be hashed and never logged (NFR-5).
- Login and ticket submission need rate limiting (NFR-9).

The front ends are two Next.js apps talking to one API. Reviewers will try to cross the customer and staff boundary deliberately, so it has to hold at more than one level.

## Decision

### 1. Two realms, separated three times

| Level      | Customer realm                                  | Staff realm                                      |
| ---------- | ----------------------------------------------- | ------------------------------------------------ |
| Identities | `customers` table                               | `agents` table (roles: agent, supervisor, admin) |
| Routes     | `/api/v1/auth/customer/*`, `/api/v1/customer/*` | `/api/v1/auth/staff/*`, `/api/v1/staff/*`        |
| Cookie     | `dsd_customer_session`                          | `dsd_staff_session`                              |

Anonymous routes (knowledge base, guest ticket submission) live under `/api/v1/public/*`.

The same email address can exist in both tables as two separate identities. A support agent who is also a customer has two accounts.

Every controller declares its realm. The global guard reads only that realm's cookie, looks the session up by token hash, and then checks that the realm stored on the session row matches the route. A customer's token pasted into the staff cookie is found in the database but rejected, because the session row says `customer`. The response is 401.

### 2. Sessions

- A session token is 32 random bytes (256 bits) from the operating system's secure random generator, encoded as base64url. It only ever travels in the cookie.
- The database stores the SHA-256 hash of the token (`sessions.token_hash`, unique index), never the token itself. A database leak therefore doesn't hand out live sessions.
- SHA-256 rather than argon2 is deliberate. A slow hash protects low-entropy secrets such as passwords. A 256-bit random token can't be brute-forced from its hash anyway, and a fast hash allows a direct indexed lookup on every request.
- Lifetimes, all configurable:

  | Session  | Absolute lifetime | Idle timeout |
  | -------- | ----------------- | ------------ |
  | Staff    | 12 hours          | 2 hours      |
  | Customer | 30 days           | 7 days       |
  | Guest    | 24 hours          | 24 hours     |

- `last_seen_at` is updated at most once a minute, so an active user doesn't cause a database write on every request.
- Every login creates a new session, so a session ID can't be planted before login (session fixation). Logout revokes the session. A password change, role change or deactivation revokes all of that identity's sessions.
- Cookies are `HttpOnly`, `Secure` and `SameSite=Lax`, with `Path=/` and no `Domain`, and use the `__Host-` prefix in production so they can't be set or overridden by a sibling subdomain.

Opaque database sessions rather than JWTs, because revocation has to be immediate. When a supervisor deactivates an agent or changes their role, the next request from that agent must see the change. With JWTs that needs a denylist or very short tokens plus refresh tokens, which puts state back into Redis anyway. The cost of our approach is one indexed lookup per request, which a short-lived Redis cache can absorb at larger scale.

### 3. Passwords

- Passwords are hashed with argon2id (via `@node-rs/argon2`) using at least the OWASP baseline of 19 MiB of memory, 2 iterations and parallelism 1. The parameters are stored in the hash string, so they can be raised later and old hashes upgraded at the next login.
- Passwords must be 12 to 128 characters. There are no composition rules (length does more than forced symbols, and NIST SP 800-63B advises against composition rules). The upper bound stops a multi-megabyte "password" from being used to burn CPU.
- A login for an unknown email is verified against a fixed dummy hash, so the response time doesn't reveal whether the account exists. Both cases return the same 401 message.
- Request logging redacts `password`, `token`, `cookie` and `authorization` fields everywhere, and never logs request bodies on auth routes.

### 4. The browser only talks to its own app

Each Next.js app serves the browser on its own origin and forwards `/api/*` to the API. The browser never calls the API origin directly.

- Cookies are set on the app's own host. In production the customer app and the agent app are different hosts, so a customer browser never even receives a staff cookie.
- Server-rendered pages can forward the user's cookie to the API, so authenticated pages can render on the server.
- The web apps need no CORS. The API keeps a strict CORS allowlist for anything else (for example Swagger UI on its own origin).
- On `localhost`, cookies ignore ports, so during development both apps' cookies coexist in one browser. That is harmless: the server-side realm check is the real boundary, and host separation is an extra layer.
- The proxy forwards `X-Forwarded-For`. The API trusts that header only from configured proxy addresses, and uses the resulting client IP for rate limiting and audit.

### 5. CSRF protection

`SameSite=Lax` already stops most cross-site form posts, but it isn't a complete defence on its own (same-site subdomains, older browsers), so state-changing requests also need proof that they came from our own pages.

- Every unsafe request (POST, PUT, PATCH, DELETE) authenticated by a session cookie must carry an `X-CSRF-Token` header.
- The token is an HMAC-SHA256 of the session ID with a server secret. It is delivered in a readable cookie (`dsd_customer_csrf` or `dsd_staff_csrf`) and in the `/me` response. The server recomputes it and compares in constant time.
- A page on another site can make the browser send our cookies, but it can't read them, so it can't set the header.
- Unsafe requests must also carry an `Origin` header (or `Sec-Fetch-Site: same-origin`) on the allowlist. This covers login and registration too, which happen before any session exists (login CSRF).
- Swagger UI gets a request interceptor that copies the CSRF cookie into the header, so "Try it out" works for reviewers.

### 6. Guest tickets (FR-2)

1. `POST /api/v1/public/tickets` accepts an email, subject, description and optional attachments. **It does not create a session.**
2. The API finds or creates a `customers` row for the normalised email (with no password), creates the ticket and writes a `ticket.created` outbox event, all in one transaction.
3. When the worker sends the confirmation email, it creates a guest access token for that ticket (`auth_tokens`, purpose `guest_ticket_access`, valid for 7 days) and puts it in the link. The raw token exists only inside that email; the database keeps its hash.
4. The link has the form `https://<customer-app>/access#token=<token>`. The token sits in the URL fragment, which browsers never send to servers, so it can't leak into server logs, proxy logs or `Referer` headers.
5. The access page posts the token to `POST /api/v1/auth/customer/guest-access/exchange`. The API checks the hash and the expiry, creates a guest session scoped to that single ticket, sets the cookie, and records `tickets.contact_verified_at`.
6. Every later notification email for the ticket carries a freshly created token, so the newest email always works. `POST /api/v1/auth/customer/guest-access/request` takes an email and a ticket reference and sends a new link if they match. It always answers 202, so it can't be used to discover which emails have tickets.

A guest session carries `guest_ticket_id`. Customer-realm queries filter on it, so a guest can list, read and reply to that one ticket and nothing else.

**Why submitting doesn't log you in.** The person filling in the form hasn't proven that they own the email address. If submitting created a session, anyone could file a ticket as `victim@example.com` and read the replies an agent writes to that customer. Requiring the emailed link means only the owner of the inbox can read the thread. Until the link has been used, the agent app marks the contact as unverified, so agents know not to discuss account details yet.

### 7. Customer registration: email first

1. `POST /api/v1/auth/customer/signup` takes an email and always returns 202. If the email has no account, the worker emails a verification link (purpose `customer_signup`, valid for 24 hours, single use). If the email already has an account, the email says so and links to the sign-in page instead.
2. `POST /api/v1/auth/customer/signup/complete` takes the token, a display name and a password. The API sets `password_hash` and `email_verified_at` on the same `customers` row and starts a session.
3. Guest tickets already point at that row, so they appear under "My tickets" straight away. Nothing is copied or merged.

**Why the password comes after the email.** In the usual "register with a password, then verify" flow, an attacker can register `victim@example.com` with a password they know before the victim ever signs up. If the victim later clicks the verification email, or the system links guest tickets at registration, the attacker's password now opens the victim's tickets. This is known as account pre-hijacking. Choosing the password only after proving control of the inbox closes it. A CHECK constraint backs this up: a customer can't have a password without a verified email.

Password reset is not in the SRS. The token table supports it (purpose `password_reset`), and it is built in Phase 3 if time allows. Otherwise it is recorded as a known gap.

### 8. Staff accounts

- Staff can't register themselves. A supervisor or admin creates the agent within the rank rules in [ADR-0004](0004-authorization-rbac.md), and the worker emails an invite link (purpose `agent_invite`, valid for 72 hours, single use) to set a password.
- A deactivated agent can't log in, and all their sessions are revoked immediately.
- Multi-factor authentication for staff is out of scope for v1. It is the first item on the hardening list for a production rollout.

### 9. One-off tokens

Guest links, signup links, invites and resets all live in one `auth_tokens` table: the SHA-256 hash, the purpose, the customer, agent or ticket it belongs to, an expiry and, for single-use purposes, `consumed_at`. They are generated and hashed exactly like session tokens.

Tokens are created by the worker at the moment it sends the email. The API never puts a raw token in an outbox event or a queue job, so no plain-text secret is ever stored in Postgres or Redis.

### 10. Rate limiting (NFR-9)

Counters live in Redis, so every API instance shares the same limits. Initial values, to be tuned in Phase 10:

| Endpoint                              | Keyed by         | Limit             |
| ------------------------------------- | ---------------- | ----------------- |
| Customer login, staff login           | client IP        | 20 per 15 minutes |
|                                       | normalised email | 5 per 15 minutes  |
| Customer signup, guest link request   | client IP        | 10 per hour       |
|                                       | normalised email | 3 per hour        |
| Guest token exchange                  | client IP        | 20 per 15 minutes |
| Ticket submission (guest and account) | client IP        | 10 per hour       |
|                                       | normalised email | 5 per hour        |

- Going over a limit returns 429 with `Retry-After` and a problem-details body.
- There is no permanent account lockout, because that would let anyone lock a victim out. The per-email window just slows guessing down.
- **If Redis is down**, auth endpoints fail closed and return 503, so an outage can't be used to brute-force passwords. Ticket submission fails open (and logs it), so customers can still reach support. Sessions live in Postgres, so agents who are already signed in keep working.

## Consequences

- The realm boundary holds at three levels: route prefix, cookie name and the realm on the session row. Breaking it requires getting all three wrong.
- Revocation takes effect on the very next request.
- Nobody can set a password for an email address they don't control.
- Every authenticated request costs one indexed database lookup.
- Guests have to open the email before they can see their ticket. That extra step is deliberate.
- Every client that uses cookie auth must send the CSRF header, including Swagger UI, which is handled by an interceptor.

## Alternatives considered

- **JWT access tokens.** Stateless verification, but revocation needs a denylist or short expiry with refresh tokens, which reintroduces shared state. No benefit at this scale.
- **One login endpoint with a role flag.** Less code, but it mixes both realms in one code path, which is exactly where cross-realm bugs come from.
- **Logging guests in on submission.** Smoother, but it lets anyone read replies meant for someone else's inbox.
- **Password-first registration.** The common pattern, but it opens the pre-hijacking attack described above.
- **Magic links instead of customer passwords.** Attractive for customers who rarely return, and possible later on the same token table. Not chosen because the SRS describes customers with optional account credentials (§5).
- **Sessions in Redis.** Faster lookups, but every request would then depend on Redis, and a Redis flush would log everyone out. Postgres is already the system of record.

## Verification

- Unit: token generation and hashing, CSRF token derivation, password length rules, dummy-hash path for unknown emails.
- Integration, per realm: login and logout; an expired, idle or revoked session gives 401; a deactivated agent's existing session gives 401 on the next request.
- Integration, realm boundary: a customer session on every staff route gives 401, and the reverse. A customer token placed in the staff cookie gives 401.
- Integration, CSRF: a missing or wrong `X-CSRF-Token` gives 403; an unknown `Origin` gives 403.
- Integration, guest flow: submission creates no session; the email link exchanges for a session that sees exactly one ticket; the request-link endpoint answers 202 whether or not the email exists.
- Integration, registration: signup completion shows earlier guest tickets. Starting a signup for someone else's email exposes nothing, because no password is set until the emailed link is used.
- Integration, rate limits: exceeding each limit gives 429. With Redis stopped, login returns 503 and ticket submission still returns 201.
- Integration, logging: captured logs for auth requests contain no password, token or cookie values.
- Statelessness: two API instances share Postgres and Redis; a session created through one works on the other.

## Amendments

### 2026-10-01, Phase 3

1. **Cookies on a local stack (section 2).** Cookies are `Secure` with the `__Host-` prefix by default, everywhere, not only in production. Plain `http://localhost` is the exception browsers disagree on: Safari refuses every `Secure` cookie there (WebKit bugs 218980, 231035 and 232088), and Chrome, at the time of writing, accepts `Secure` cookies there but refuses `__Host-` ones ([httpwg/http-extensions#2605](https://github.com/httpwg/http-extensions/issues/2605)). Only Firefox accepts both. So `COOKIE_SECURE=false` switches to plain names (`dsd_customer_session`, `dsd_customer_csrf` and the staff equivalents) without the `Secure` flag, keeping `HttpOnly`, `SameSite=Lax`, `Path=/` and no `Domain`. The API refuses to start with `COOKIE_SECURE=false` unless every trusted origin (`TRUSTED_ORIGINS` and `CORS_ORIGINS`) is plain HTTP on `localhost`, `127.0.0.1` or `[::1]`, so a deployment with real origins can't turn it on. Docker Compose serves everything on `http://localhost` and sets it, so sign-in works in every browser for local review. Production keeps the default: `__Host-` and `Secure`.
2. **Trusted origins (section 5).** The origin allowlist is `TRUSTED_ORIGINS` (both web apps, and the API's own origin for Swagger UI) plus `CORS_ORIGINS`, since an origin allowed to make credentialed cross-origin calls must also be able to make unsafe ones.
3. **The client's address (section 4).** How the web apps work out the browser's address, and which proxies the API trusts, is decided in [ADR-0010](0010-client-address-behind-the-web-proxy.md).
4. **Rate limits (section 10).** Sign-up completion and invite acceptance are limited like the guest token exchange: 20 per 15 minutes per IP. Counters are keyed by an HMAC of the email or address, so Redis holds no personal data. The global guards run in this order: session, then CSRF and origin, then rate limit, then permissions. The origin check comes before the rate limit so a forged cross-site request never uses up anyone's allowance.
5. **Invalid emailed links** answer 400 with the problem type `invalid-token`, whether the token is unknown, expired, already used, meant for something else, or its account no longer fits (for example, a sign-up link for an account that already has a password).
6. **Password reset (section 7)** moves to Phase 6, when the worker sends emails, so it can be built and tested end to end. It is scheduled work, not a known gap.

### 2026-10-02, Phase 6

1. **Password reset (section 7) is built**, for customers. `POST /api/v1/auth/customer/password-reset/request` takes an email and always answers 202; for a known address it writes `customer.password_reset_requested { customerId }`, rate limited like sign-up (10 an hour per address, 3 per email). The worker emails a link to `/reset-password#token=…` that works once and lasts **one hour**, or, for an address without a password, points to sign-up instead: a reset never creates an account. `POST .../password-reset/complete` spends the token, sets the new password only on an account that has one, deletes the customer's other reset tokens, revokes every session they had (guest sessions included), and signs this browser in; it is limited like the other token exchanges. Staff password reset isn't built: `auth_tokens_subject_ck` allows reset tokens for customers only, and an admin can deactivate and re-invite a colleague instead.
2. **The emails behind links are sent (sections 6 to 8).** The worker creates each token as it sends its email: guest links last 7 days, sign-up links 24 hours, invites 72 hours. A notification about a ticket carries a fresh guest link when the customer has no account, and links to the signed-in ticket page when they do. A job that is retried creates a new token each attempt; tokens whose email was never sent reach nobody and expire like any other.

### 2026-10-03, Phase 10

1. **Two more limits (section 10), found in the security review.** The help centre's article list and search allow 300 requests a minute per address: a search ranks and highlights with full-text functions, the most expensive read that needs no session, and the bar is far above what a person browsing (or an office behind one address) sends. Reading one article is a keyed lookup and isn't limited. Customers' and guests' replies allow 20 per customer in 10 minutes, counted by account, because each reply notifies staff and can carry five files. Both let requests through while Redis is down, like ticket submission: the help centre and a customer's answer matter more than the limit.
2. **Per-address limits count the browser.** `request.ip` already resolves `X-Forwarded-For` through the trusted proxies only ([ADR-0010](0010-client-address-behind-the-web-proxy.md)), so behind the web apps every limit counts the browser's address, never the web app's, and a forged header from anyone else is ignored. The `public-rate-limits` integration test proves it for the new limits as `rate-limits` does for sign-in.
