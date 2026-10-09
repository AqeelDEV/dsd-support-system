# ADR-0013: The web apps: visual direction, data flow and page security

- Status: Accepted
- Amended: 2026-10-02 and 2026-10-09 (see [Amendments](#amendments))
- Date: 2026-10-02
- Requirements: UI-1, UI-2, FR-1 to FR-4, FR-7 to FR-15, FR-16, NFR-7, NFR-12

## Context

The customer app and the agent app are the first thing anyone sees of this system. They must look like one deliberately designed product rather than a component library's defaults, and they must stay thin clients over the API ([ADR-0002](0002-monorepo-layout.md)): every rule comes from the API, the apps only display it.

The two apps serve very different people. A customer visits rarely, reads carefully and may be on a phone. An agent works the queue all day on a desktop and wants to see many tickets at once and move quickly with the keyboard. One visual language has to serve both.

Section 1, the visual direction, was settled before any screen was built, so every screen is built against it and reviewed against it at the end of each phase. Sections 2 to 7 record the technical decisions made while building the customer app; the agent app follows them.

## Decision

### 1. Visual direction

**Colour.** Neutral cool greys carry the interface. There is one accent, a deep indigo-blue, and it is used sparingly: primary actions, keyboard focus, the current selection, links. It is never used for large fills, headers or backgrounds. Status and priority colours appear only as small tinted badges with a coloured dot, never as a full-row background. Every colour is a token in `packages/ui/src/styles.css` with a light and a dark value, and text pairs meet WCAG AA (UI-2). Changing the accent is a one-token change; no component names a colour directly.

**Type.** Inter Variable, self-hosted, with the system stack as fallback. Tabular figures in tables, counts and report figures. One scale for both apps, with fixed line heights:

| Step | Size / line height | Used for                                           |
| ---- | ------------------ | -------------------------------------------------- |
| xs   | 12 / 16 px         | Labels, meta, badges (medium weight, muted colour) |
| sm   | 13 / 20 px         | Agent app body, table cells                        |
| base | 14 / 20 px         | Controls, secondary text                           |
| md   | 16 / 24 px         | Customer app body and reading text                 |
| lg   | 20 / 28 px         | Section headings                                   |
| xl   | 24 / 32 px         | Page titles                                        |
| 2xl  | 30 / 36 px         | The customer home page's one headline              |

Headings are semibold with slightly negative tracking. Nothing is bold for emphasis inside running text.

**Spacing.** A 4 px grid. Gaps step through 8, 12, 16, 24, 32 and 48 px; nothing uses an off-grid value. Content panels pad 24 px in the customer app and 12 to 16 px in the agent app.

**Density.** The apps share tokens and components but not density:

- The customer app is comfortable: 44 px controls (a comfortable touch target), a 720 px reading column for articles and threads, generous whitespace between sections.
- The agent app is compact: 32 px controls, 36 px queue rows, a sticky table header, and panels divided by hairlines rather than floating as separate cards, so a 1280 px screen shows a full queue page without scrolling.

**Signature details.** Three small things, used consistently, that make the product recognisable:

1. **Reference chips.** A ticket reference (`DSD-000123`) is always shown as a monospace chip with a subtle inset border, and can be copied. It is the recurring anchor between the email a customer received, the customer's thread and the agent's queue.
2. **The status rail.** A ticket thread hangs off a thin vertical rail. Status changes sit on the rail as small markers between messages, so the history reads as one continuous story rather than a list of cards. Internal notes in the agent app sit on a warm amber surface with a hairline border, so they can never be mistaken for a reply.
3. **Hairlines and layers.** One 1 px border colour everywhere, and almost no shadows: only overlays (menus, dialogs, toasts) cast one. Content panels are white on a slightly darker canvas. In the agent app, keyboard hints (`Kbd`) appear inline in buttons, tooltips and the shortcut sheet.

**Review gate.** At the end of each phase the key screens are captured at 390 px and 1280 px, in light and dark, and checked against this section: the accent is used sparingly, the type scale and spacing are respected, the density fits the app, the signature details are present, and no screen shows an unstyled or default-looking state (loading, empty, error included). Anything generic or inconsistent is fixed before the phase closes.

### 2. Data comes from the API in the browser, through the app's proxy

- Pages are client components that read and write through `createBrowserClient` (`@dsd/api-client`), which calls the app's own `/api` proxy (ADR-0003, section 4). Server components only lay out the page; they never call the API. That keeps one path for every call, so the client-address hook (ADR-0010), CSRF and rate limits behave the same for every request.
- TanStack Query holds the data: loading and error states come from it, a failed read retries once unless it was a 4xx, and an answer from a mutation (the updated ticket) replaces the cached copy instead of triggering a reload. Open threads refresh once a minute.
- The CSRF token is read from the realm's script-readable cookie at the moment of each state-changing request, rather than kept in memory, so a sign-in in another tab never leaves a tab with a stale token.
- Every failure becomes an `ApiProblem` (problem details plus status, request ID and `Retry-After`), and `describeProblem` in `packages/ui` words it the same way in both apps: a field error goes next to its field, a 429 says how long to wait, a 503 says the service is briefly unavailable, and anything else shows the request ID to quote.

### 3. No rules in the apps

- What a person may do comes from the API: staff `permissions` from `/me`, `allowedActions` and `allowedTransitions` on a staff ticket, and `canReply` on a customer ticket. `canReply` was added for this app: a customer ticket can't carry `allowedActions` (the customer-schema guard forbids staff-shaped fields), and without it the app would have had to know that closed tickets refuse replies.
- Forms check input with the same zod schemas the API validates with (`packages/shared`), through `validateForm`, which only chooses the words. The API checks again.
- Labels for statuses, priorities and roles live once in `packages/ui`, so the two apps can't name a state differently.

### 4. The page Content Security Policy uses a nonce

- Each app's `src/proxy.ts` (Next.js middleware) gives every page response a fresh nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'`, plus `default-src 'self'`, `connect-src 'self'`, `img-src 'self' data: blob:`, `font-src 'self'` and the framing, plugin, base and form rules. Next.js reads the nonce from the request's CSP header and puts it on its own scripts; an injected script has no nonce and never runs.
- The root layout calls `connection()`, so every page renders per request. A page prerendered at build time would carry no nonce and its scripts would be blocked.
- `style-src` allows `'unsafe-inline'`: React writes `style` attributes (chart bars, table alignment) and a nonce can't cover attributes. Injected styles can't run code; scripts are what the policy is for.
- The proxy's matcher skips `/api/`, so downloads keep the API's own `default-src 'none'; sandbox` (ADR-0011, section 9). Pages reached from emailed links (`/access`, `/signup/complete`, `/reset-password`, `/invite`) also send `Referrer-Policy: no-referrer`.
- Fonts are self-hosted (`@fontsource-variable/inter`), so no third-party origin is allowed anywhere. Knowledge-base images from other sites are shown as links rather than loaded.

### 5. Emailed links

- Tokens travel in the URL fragment (ADR-0003), which never reaches a server or a `Referer`. The page reads it once, removes it from the address bar and history, and posts it to the API. An exchange runs once even when React runs effects twice in development.
- An expired, used or malformed link gets a page that says so and offers the way to a new one.

### 6. Knowledge-base markdown

- `Markdown` in `packages/ui` builds React elements from the same mdast tree the sanitiser uses (`parseMarkdown` in `packages/shared`), so the renderer can't see a link the sanitiser didn't. It never sets HTML: raw HTML in the source is shown as text, every link and image URL is checked again with `isSafeUrl`, an unsafe link keeps its text and loses its destination, and an unsafe image is dropped. Markdown headings start at h2 under the article's h1.
- Search snippets arrive as segments; the app wraps the matched ones in its own `<mark>` and strips markdown punctuation from the preview.

### 7. Charts and browser tests

- Charts (Phase 8 reports) are small SVG and HTML components on the design tokens, with a visually hidden data table for screen readers, rather than a chart library: they follow the theme and dark mode for free and add no dependency.
- Browser tests live in the `e2e` workspace and drive the production builds on the Compose stack, with Mailpit for the emails. Each test makes its own customers with unique addresses; a global setup clears the rate-limit counters (only counters) so local reruns don't trip NFR-9's limits. `pnpm screenshots` captures the README screenshots, and `SCREENSHOT_REVIEW=1` captures every screen at both widths in both themes for the review gate.

## Consequences

- Both apps share one token file and one component package, so a change of accent or radius is one edit.
- Two densities from one set of components means components take a size rather than hard-coding one.
- Client-side data means a page shows a skeleton for a moment before its content. In exchange, every call takes the one audited path through the proxy, and nothing the API says about permissions is cached on a server.
- Every page is rendered per request because of the nonce. The pages are small and their data comes from the API anyway, so static rendering would have saved little.

## Alternatives considered

- **Stock shadcn/ui styling.** Fast and accessible, but instantly recognisable as a template. We keep its structure (Radix primitives, cva variants, semantic tokens) and replace its look.
- **A different accent per app.** It would separate the apps visually, but they are one product for one company; the separation is already structural (ADR-0001).
- **Server components calling the API directly.** Faster first paint, but a second path to the API that skips the proxy, so the client address and the CSRF rules would need handling twice.
- **A hash-based script policy, or `'unsafe-inline'`.** Hashes don't fit the scripts Next.js generates per page, and `'unsafe-inline'` would make the policy decorative.
- **A chart library.** Heavier than three simple charts need, and harder to theme to the tokens.

## Verification

- The review gate above, recorded in the phase's delivery notes, with screenshots kept in `docs/screenshots/`.
- Unit: `csp` (`packages/config`), each app's `proxy` (a new nonce per response, the matcher equals the shared one, no referrer on token pages), `browser` (CSRF from the cookie, problem parsing, multipart order), `markdown` (raw HTML as text, unsafe URLs), `links` (safe redirects, fragment tokens), `validate`, `problem`.
- Integration: `customer-ticket-view` checks `canReply` for every status; `http-conventions` checks every page cursor in the OpenAPI document.
- e2e: `guest-flow`, `account-flow`, `kb-search`, `xss`, `responsive` (390 and 1280 px: no overflow, no CSP violation or script error), `a11y` (axe in light and dark, keyboard-only submission).
- Smoke: a nonce-based policy on pages, a new nonce on every response, no referrer on `/access`.

## Amendments

### 2026-10-02, Phase 8 (the agent app)

1. **The agent app's shell.** A sidebar on desktop and a menu sheet on phones. Its sections come from the permissions `/me` reports (`visibleNav`, unit-tested against the API's role map); a section reached by address that the API refuses shows "You don't have access" from the API's 403, never a client-side guess.
2. **Working the queue all day.** Filters and saved views live in the address, the queue refreshes every 30 seconds, rows are 44 px with a sticky header (not the 36 px section 1 planned: each row carries the customer under the subject, which saves opening a ticket to see who asked), and the keyboard covers the common path: `j`/`k`, `Enter`, `r`, `n`, `Ctrl+Enter`, `?`. Low and normal priorities are quiet text; only high and urgent are tinted.
3. **Ticket controls from the ticket.** Every control appears only when `allowedActions` allows it, and the status list is `allowedTransitions`. A change answers with the updated ticket, which replaces the cached one; a 409 refreshes the ticket and says why. Names in the history come from the ticket, its audit actors and the assignable colleagues (ADR-0012 amendment), so the app never needs `user:read` to show who did what.
4. **The AI slot.** `AssistPanelSlot` at the top of the ticket's side rail is where the Phase 9 suggestion panel goes. It renders nothing until then, so nothing is presented as a feature that isn't built; the component's comment states the guardrail the panel must keep (it only fills the composer).
5. **Knowledge-base editing.** The preview uses the help centre's `Markdown`. After a save the editor shows what the API stored, and says so when the sanitiser removed something, including on a new article's first save (carried through the address as `?markup=removed`).
6. **Browser tests across both apps.** Staff tests start from sessions the global setup saves once per role. A context that must be signed out is created with an explicitly empty session: `browser.newContext()` inherits the file's session, and an invite accepted in such a context revoked the shared supervisor session.

### 2026-10-09, a theme menu

7. **Light, dark or the system's.** Both apps follow the system's light or dark setting unless the viewer picks one in the theme menu: in the customer app's header, beside the account menu in the agent app's sidebar (in the top bar on a phone), and on the agent sign-in page. The choice is kept in a cookie, `dsd_theme`, rather than local storage, because each root layout reads it and renders `<html data-theme>`: the first paint is already in the chosen theme, with no inline script to run before it under the nonce CSP (section 4). The dark token values and any `dark:` utility use one Tailwind variant, so they can't disagree, and "System" deletes the cookie. On localhost both apps share the cookie, because cookies ignore the port; in production they are on separate hosts.
