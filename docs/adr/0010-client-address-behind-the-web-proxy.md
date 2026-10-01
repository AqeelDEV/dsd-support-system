# ADR-0010: The client's address behind the web apps' proxy

- Status: Accepted
- Date: 2026-10-01
- Requirements: NFR-5, NFR-6, NFR-9

## Context

The API uses the client's IP address in two places: sign-in and sign-up rate limits are counted per address (ADR-0003, section 10), and each session records the address it was created from. Both are only worth having if a client can't choose its own address.

Browsers never talk to the API directly. They talk to a web app, whose route handler forwards `/api/*` to the API (ADR-0003, section 4). So the API sees the web app as its peer, and has to learn the browser's address from `X-Forwarded-For`. In Phase 1 this was left open, and it had two holes:

- **The header could be spoofed.** Next.js fills in `X-Forwarded-For` only when a request arrives without one, and a route handler can't see the TCP connection. The proxy passed the incoming header through. A client talking to the web app directly could send `X-Forwarded-For: <anything>` and get a fresh rate-limit allowance with every request.
- **The API trusted no proxy.** Compose left the API's `TRUST_PROXY` empty, so the API would have counted every browser as the web app's address: one shared allowance for all customers, which any single client could use up for everyone.

## Decision

### 1. The web app works out the address before Next.js sees the request

Node publishes a `http.server.request.start` diagnostics-channel message for every request it receives. In Node 24 that happens before the server's `request` event, so a subscriber can change the request before any handler, including Next.js, runs. Node's documentation doesn't promise that order, so a test checks it (see Verification). Each web app's `instrumentation.ts` installs one subscriber (`@dsd/api-client/client-address`). It replaces `X-Forwarded-For` with a single address:

- start from the connection's peer address;
- while the current address is a proxy listed in the app's own `TRUST_PROXY`, step back to the address it reported in `X-Forwarded-For`;
- stop at the first address that isn't trusted. Anything a client wrote further left is never reached.

This is the same rule the API applies to its own proxies (Fastify's `trustProxy`). `TRUST_PROXY` is empty in Compose, because browsers connect to the apps directly; in production it lists the load balancer in front of the apps. An invalid value stops the app.

### 2. A seal tells a computed address from a claimed one

Next.js starts listening before it runs instrumentation, so a request can arrive in the moment before the subscriber exists. Its `X-Forwarded-For` would be whatever the client sent. To tell the two apart, the subscriber also sets a header holding a random key generated when the process starts, and that key never leaves the process. The proxy forwards an address only when that header carries the key. Requests without a valid seal are forwarded with no `X-Forwarded-For` at all.

### 3. The proxy forwards only that address

The proxy always drops the incoming `X-Forwarded-For` and the seal header, and sets `X-Forwarded-For` from the verified address. Without one, the API sees the web app's own address: rate limits get coarser for those requests, but nobody can pick their address.

### 4. The API trusts exactly the two web apps

The Compose network has a fixed subnet (`10.250.73.0/24`, outside Docker's default address pools), the customer app is `10.250.73.10` and the agent app `10.250.73.11`, and the API's `TRUST_PROXY` lists those two addresses and nothing else. A request from the host through the published API port arrives from the network's gateway, which isn't trusted, so its `X-Forwarded-For` is ignored even though it comes from a private address.

## Consequences

- A client can't choose the address its sign-in attempts are counted against, whether it talks to a web app or to the API.
- The per-address limits count browsers, not the web apps.
- The design relies on a Node built-in diagnostics channel. Node's `diagnostics_channel` API is stable, but Node still marks its built-in channels experimental. A test runs the hook against Node's real HTTP server, so a Node upgrade that changes the ordering fails CI. And if the hook ever stopped running, the seal would be missing and the proxy would forward no address: limits would get coarser, but no one could spoof one.
- The fixed Compose subnet could clash with a network already on a developer's machine. The subnet is set in one place in `compose.yaml`.
- Behind a load balancer, operators must set each web app's `TRUST_PROXY` to the balancer's addresses, or every browser looks like the balancer. That is the usual trade-off of trusting forwarded headers, and the same setting the API already has.

## Alternatives considered

- **A reverse proxy (Caddy or nginx) in front of the web apps in Compose**, overwriting `X-Forwarded-For`. It is the usual way to self-host Next.js, but it adds a service, and the app code would still trust whatever header reached it whenever someone deployed it without the proxy.
- **A custom Next.js server** that rewrites the header before handing the request to Next.js. Next.js documents custom servers as incompatible with standalone output, which the container images use.
- **A shared secret between the proxy and the API.** It avoids network configuration, but it is a second secret to manage, and it isn't how forwarded headers are usually trusted.
- **Trusting the whole Compose subnet in the API.** Simpler, but host traffic through the published port comes from the subnet's gateway, so anyone on the host could have spoofed the header.
- **Trusting one hop by count.** That trusts the previous hop whoever it is, including a client connecting to the API directly.

## Verification

- Unit (api-client): `client-address` (the walk rule, address and CIDR parsing, IPv4-mapped addresses; against a real Node HTTP server, the header is rewritten before the handler runs, a client's seal is overwritten, and an address without the process's seal is ignored); `proxy` (the browser's `X-Forwarded-For` and seal are never forwarded, and no address is sent when none is known).
- Integration (API): `rate-limits` (an untrusted `X-Forwarded-For` is ignored; behind a trusted proxy each forwarded client is counted separately).
- Smoke (Compose): a sign-in through the customer app with `X-Forwarded-For: 203.0.113.99` stores a different, real address on the session.
- Manual: `next start` with a forged header sends the peer's address to the upstream, and with an invalid `TRUST_PROXY` exits with status 1.
