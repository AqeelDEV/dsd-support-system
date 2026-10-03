/**
 * What a counter counts per: an IP address, an email, a ticket, an agent or
 * a customer (signed in or a guest).
 */
export type LimitSubject = "ip" | "email" | "ticket" | "agent" | "customer";

/** One counter: at most `max` requests per `windowSeconds` for each subject. */
export interface Limit {
  by: LimitSubject;
  max: number;
  windowSeconds: number;
}

export interface RateLimitPolicy {
  /** Part of the Redis key, so each policy counts on its own. */
  name: string;
  limits: readonly Limit[];
  /**
   * What happens when Redis can't be reached. Sign-in refuses (503), so an
   * outage can't be used to guess passwords without limits; ticket
   * submission allows, so customers can still reach support.
   */
  whenRedisIsDown: "refuse" | "allow";
}

const MINUTE = 60;
const MINUTES_10 = 10 * 60;
const MINUTES_15 = 15 * 60;
const HOUR = 60 * 60;

const login = (name: string): RateLimitPolicy => ({
  name,
  limits: [
    { by: "ip", max: 20, windowSeconds: MINUTES_15 },
    { by: "email", max: 5, windowSeconds: MINUTES_15 },
  ],
  whenRedisIsDown: "refuse",
});

const emailedLinkRequest = (name: string): RateLimitPolicy => ({
  name,
  limits: [
    { by: "ip", max: 10, windowSeconds: HOUR },
    { by: "email", max: 3, windowSeconds: HOUR },
  ],
  whenRedisIsDown: "refuse",
});

const tokenExchange = (name: string): RateLimitPolicy => ({
  name,
  limits: [{ by: "ip", max: 20, windowSeconds: MINUTES_15 }],
  whenRedisIsDown: "refuse",
});

/**
 * The limits from ADR-0003, section 10, plus the help centre and customer
 * replies (ADR-0003, amended in Phase 10). There is
 * no permanent lockout: that would let anyone lock a victim out. The
 * per-email window only slows guessing down.
 */
export const RATE_LIMITS = {
  customerLogin: login("customer-login"),
  staffLogin: login("staff-login"),
  signup: emailedLinkRequest("signup"),
  guestLinkRequest: emailedLinkRequest("guest-link-request"),
  passwordResetRequest: emailedLinkRequest("password-reset-request"),
  // A 256-bit token can't be guessed, but a cheap limit costs nothing.
  guestLinkExchange: tokenExchange("guest-link-exchange"),
  signupCompletion: tokenExchange("signup-completion"),
  inviteCompletion: tokenExchange("invite-completion"),
  passwordResetCompletion: tokenExchange("password-reset-completion"),
  /**
   * Guest and signed-in submissions (NFR-9). The guard counts the address;
   * the email sits in a multipart body the guard can't read, so the
   * submission service counts it once the fields are valid.
   */
  ticketSubmission: {
    name: "ticket-submission",
    limits: [
      { by: "ip", max: 10, windowSeconds: HOUR },
      { by: "email", max: 5, windowSeconds: HOUR },
    ],
    whenRedisIsDown: "allow",
  },
  /**
   * The help centre's article list and search (FR-4). A search ranks and
   * highlights with full-text functions, the most expensive public read, so
   * one address can't flood it. The bar is generous: someone browsing, or a
   * whole office behind one address, stays far below it. Reading a single
   * article is a keyed lookup and isn't limited. Allowed while Redis is
   * down: the help centre matters more than the limit.
   */
  kbArticles: {
    name: "kb-articles",
    limits: [{ by: "ip", max: 300, windowSeconds: MINUTE }],
    whenRedisIsDown: "allow",
  },
  /**
   * Customers' and guests' replies. Each one notifies staff and can carry
   * five files, so one account can't flood a ticket or the queue. Allowed
   * while Redis is down, so a customer can always answer (NFR-10).
   */
  customerReply: {
    name: "customer-reply",
    limits: [{ by: "customer", max: 20, windowSeconds: MINUTES_10 }],
    whenRedisIsDown: "allow",
  },
  /**
   * Agents asking for a fresh AI draft (ADR-0006, section 11). Each one can
   * cost money with a real provider, so it is limited per ticket and per
   * agent, and refused while Redis is down: nothing urgent depends on it.
   */
  aiSuggestionRequest: {
    name: "ai-suggestion-request",
    limits: [
      { by: "ticket", max: 5, windowSeconds: MINUTES_10 },
      { by: "agent", max: 30, windowSeconds: HOUR },
    ],
    whenRedisIsDown: "refuse",
  },
} as const satisfies Record<string, RateLimitPolicy>;
