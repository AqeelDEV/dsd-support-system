/** One counter: at most `max` requests per `windowSeconds` for each IP or each email. */
export interface Limit {
  by: "ip" | "email";
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
   * submission (Phase 4) allows, so customers can still reach support.
   */
  whenRedisIsDown: "refuse" | "allow";
}

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
 * The limits from ADR-0003, section 10, to be tuned in Phase 10. There is
 * no permanent lockout: that would let anyone lock a victim out. The
 * per-email window only slows guessing down.
 */
export const RATE_LIMITS = {
  customerLogin: login("customer-login"),
  staffLogin: login("staff-login"),
  signup: emailedLinkRequest("signup"),
  guestLinkRequest: emailedLinkRequest("guest-link-request"),
  // A 256-bit token can't be guessed, but a cheap limit costs nothing.
  guestLinkExchange: tokenExchange("guest-link-exchange"),
  signupCompletion: tokenExchange("signup-completion"),
  inviteCompletion: tokenExchange("invite-completion"),
} as const satisfies Record<string, RateLimitPolicy>;
