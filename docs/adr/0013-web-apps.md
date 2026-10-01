# ADR-0013: The web apps: visual direction, data flow and page security

- Status: Proposed
- Date: 2026-10-02
- Requirements: UI-1, UI-2, FR-1 to FR-4, FR-7 to FR-15, FR-16, NFR-7, NFR-12

## Context

The customer app and the agent app are the first thing anyone sees of this system. They must look like one deliberately designed product rather than a component library's defaults, and they must stay thin clients over the API ([ADR-0002](0002-monorepo-layout.md)): every rule comes from the API, the apps only display it.

The two apps serve very different people. A customer visits rarely, reads carefully and may be on a phone. An agent works the queue all day on a desktop and wants to see many tickets at once and move quickly with the keyboard. One visual language has to serve both.

This record is written in two steps. Section 1, the visual direction, is settled before any screen is built, so every screen is built against it and reviewed against it at the end of each phase. The technical decisions follow as they are made.

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

## Consequences

- Both apps share one token file and one component package, so a change of accent or radius is one edit.
- Two densities from one set of components means components take a size rather than hard-coding one.

## Alternatives considered

- **Stock shadcn/ui styling.** Fast and accessible, but instantly recognisable as a template. We keep its structure (Radix primitives, cva variants, semantic tokens) and replace its look.
- **A different accent per app.** It would separate the apps visually, but they are one product for one company; the separation is already structural (ADR-0001).

## Verification

- The review gate above, recorded in the phase's delivery notes, with screenshots kept in `docs/screenshots/`.
