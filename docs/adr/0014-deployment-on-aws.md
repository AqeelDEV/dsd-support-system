# ADR-0014: Deployment on AWS

- Status: Accepted
- Date: 2026-10-09
- Requirements: NFR-0, NFR-5, NFR-10, NFR-13, FR-5

## Context

The system has to run for real: customers at `https://support.dsddocs.com` and staff at `https://agents.dsddocs.com`. It serves one company's support desk, the budget is about $30 a month, and one person operates it. The Compose stack is already proven: CI brings it up from scratch on every push and runs the smoke and browser tests against it.

Four things must hold in production that don't matter locally:

- **No demo data.** The demo seed's accounts share a password printed in the README.
- **No long-lived credentials** where a role will do, and no secret in the repository.
- **Mail that arrives:** sent from the company's domain, authenticated, and over an encrypted connection.
- **A way back** after a bad deploy, a broken server or a lost region.

## Decision

### 1. One Graviton server running the Compose stack

- **Server.** One EC2 t4g.medium (2 vCPUs, 4 GB) running Ubuntu 24.04 for arm64, in ap-south-1 (Mumbai), where the account is managed from and every service used here is offered. It sits in the default VPC with an Elastic IP.
- **Disk.** A 40 GB gp3 root volume, encrypted with the account's default EBS key.
- **What runs.** `deploy/compose.production.yaml` runs the same images as `compose.yaml`: Postgres with pgvector, Redis, SeaweedFS, the migrations, the API, the worker and both web apps. Caddy sits in front. The data stores' volumes live on the root volume.
- **No development defaults.** Every secret is written `${VAR:?}`, so Compose refuses to start without one. Only Caddy publishes ports, and there is no Mailpit.
- **Graviton.** It costs less per hour than the x86 equivalent, and every image the stack uses is published for arm64.
- **CPU credits stay unlimited**, so a deploy's build is never throttled. Sustained use above the instance's baseline is billed extra, and the account's budget alerts report it.

### 2. Caddy at the front, with Let's Encrypt

- **What Caddy does.** It is the only service with open ports (TCP 80 and 443). It gets and renews a certificate for each name, redirects HTTP to HTTPS, and hands each name to its web app.
- **No HTTP/3.** It offers HTTP/1.1 and HTTP/2 only, because UDP 443 isn't open.
- **No ACME email**, so the public repository holds no personal address.
- **Fixed addresses** (`10.250.73.5` for Caddy). Each web app's `TRUST_PROXY` names Caddy alone, and the API's names the two web apps. So the client address rule of [ADR-0010](0010-client-address-behind-the-web-proxy.md) holds unchanged: Caddy plays the load balancer's part there, and replaces any `X-Forwarded-For` a client sends.
- **Caddy starts only after DNS.** `deploy.sh` starts it only once both names resolve to the server's public address on 1.1.1.1 and 8.8.8.8, so a certificate is never requested while DNS still points elsewhere. Failed requests count against Let's Encrypt's rate limits.

### 3. No SSH: Systems Manager only

- **No port 22, no key pair.** The security group has no SSH rule and the instance has no key pair. Setup, deploys and checks run through `aws ssm send-command`, and CloudTrail records each one.
- **The instance role** has `AmazonSSMManagedInstanceCore`, plus read access to `/dsd-support/prod/*` in Parameter Store and nothing else.
- **IMDSv2 is required with a hop limit of 1.** A container's request crosses one more hop than that, so no container can reach the role's credentials.
- **Termination protection is on.**

### 4. Secrets in Parameter Store, rendered to a root-only file

- **Where the secrets live.** Every secret is an SSM SecureString under `/dsd-support/prod/`, encrypted with the AWS-managed key:
  - the database passwords: `POSTGRES_PASSWORD` and `DSD_MIGRATOR_PASSWORD`, `DSD_API_PASSWORD`, `DSD_WORKER_PASSWORD` for the three roles;
  - `AUTH_SECRET`;
  - `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`;
  - `SMTP_USER` and `SMTP_PASSWORD`;
  - `GEMINI_API_KEY`;
  - `BOOTSTRAP_ADMIN_PASSWORD`.
- **Not secret, kept out of the repository.** The admin's email and name are String parameters (`BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`).
- **Generated, never displayed.** Each value comes from a CSPRNG. The database passwords are hex, because they sit inside a `DATABASE_URL`.
- **Rendered at every deploy.**
  - `deploy.sh` writes `/srv/dsd-support/.env`: file mode 600, in a directory with mode 700.
  - Each value is single-quoted, so Compose doesn't interpolate it.
  - A value with any character outside `[A-Za-z0-9 @._+/=:,-]` stops the deploy, named but not shown.
  - The script never traces commands, so no value reaches its log or the SSM command output.
- **Rotating.** Change the parameter and redeploy. A database role's password also needs `ALTER ROLE`, because `docker/postgres/initdb` sets the passwords only when the database is first created.

### 5. The first run: bootstrap, never the seed

- **The migrate service** runs the migrations and then the first-run bootstrap (amendment to [ADR-0008](0008-data-integrity-and-db-roles.md)). Bootstrap creates the `dsd` brand, with `info@dsddocs.com` as the sender address, and one admin taken from Parameter Store.
- **Safe to run again.** Once the brand exists, bootstrap does nothing.
- **Demo data is refused.** Bootstrap refuses a database holding the demo staff accounts. So a deployment can't go live with the README's password, even if someone runs the seed by mistake.
- **The admin keeps that password.** Staff can't change or reset a password yet (README, Known limitations), so it stays the one in Parameter Store.

### 6. Email through Amazon SES

- **The domain.** `dsddocs.com` is an SES domain identity:
  - **Easy DKIM** with 2048-bit keys;
  - **a custom MAIL FROM domain**, `bounce.dsddocs.com`.
- **Why both.** SPF and DKIM then both align with the From domain, which DMARC checks.
- **The rest of the domain's mail is untouched.** The domain's own MX, SPF and DMARC records stay as they are, so the company mailbox keeps working, and customers' replies to `info@dsddocs.com` arrive there.
- **If MAIL FROM breaks.** When its records fail, SES falls back to its default MAIL FROM rather than refusing to send.
- **The worker sends over SMTP** on port 587, with `SMTP_REQUIRE_TLS=true`: no STARTTLS, no send, so the credentials never cross in clear.
- **The SMTP credentials.** They belong to an IAM user, `ses-smtp-support`, whose only permission is `ses:SendRawEmail` with `ses:FromAddress` equal to `info@dsddocs.com`.
  - The SMTP password is derived from the user's access key. The secret key itself is stored nowhere.
  - This is the stack's one long-lived credential, because the SMTP interface needs one. All it can do is send as that address.
- **The sandbox.** Until AWS grants production access, SES delivers only to:
  - addresses verified one by one;
  - the SES mailbox simulator;
  - addresses at a verified domain, which means any `@dsddocs.com` address.
- **What the sandbox blocks.** Customer emails and staff invites to other addresses don't arrive in that period. Each such job fails, retries, lands in the dead-letter queue with its delivery row marked `failed` ([ADR-0005](0005-outbox-queues-notifications.md)), and never blocks a ticket (NFR-10).

### 7. Each deploy is a commit of `main`, built on the server

- **What a deploy does.** `deploy.sh <sha>`:
  - refuses a commit that isn't on `main` and checks it out;
  - builds the images on the server;
  - starts everything but Caddy and waits for each service to be healthy; Caddy follows once DNS is right (section 2);
  - checks the API's `/ready` and each name's `/healthz` over HTTPS;
  - records the deployed commit.
- **No registry.** What runs is exactly what is in git, and the 4 GB swap file covers the build's memory.
- **Rolling back** means deploying an older commit. Migrations only move forward, so a migration must stay compatible with the code before it: add first, remove in a later release.
- **Server setup.** `deploy/setup-server.sh` installs Docker from Docker's repository and the AWS CLI. It also turns on daily security updates, with a reboot at 23:30 UTC when one needs it; `restart: unless-stopped` brings the services back.

### 8. Backups, alarms and recovery

- **Daily snapshots** (Data Lifecycle Manager):
  - the volume tagged `Backup=daily` is snapshotted every day at 22:00 UTC, and 7 snapshots are kept;
  - each one is copied to eu-central-1, encrypted, and kept there for 7 days.
- **One volume holds everything:** Postgres, the attachments, Redis's append-only file and the certificates. Each snapshot therefore captures all of them at the same instant, and Postgres recovers from it as after a power cut. The recovery point is at most 24 hours old.
- **Restoring in place.** A replace-root-volume task from a snapshot keeps the instance, its address and its role.
- **Losing the region.** Register an image from the Frankfurt copy, launch it there, and point the two A records at it.
- **Two alarms** notify the SNS topic `dsd-support-prod-alerts` when they fire and again when they clear:
  - a failed system status check for 2 minutes recovers the instance onto new hardware;
  - a failed instance status check for 3 minutes reboots it.

### 9. Cost

About $26 to $29 a month at on-demand prices:

| Item                                                 | Per month               |
| ---------------------------------------------------- | ----------------------- |
| Instance                                             | $16.35                  |
| gp3 volume                                           | $3.65                   |
| Public IPv4 address                                  | $3.65                   |
| Snapshots and their copies                           | about $2 to $5          |
| Alarms                                               | $0.20                   |
| SES, SNS, Parameter Store and Data Lifecycle Manager | about $0 at this volume |

## Consequences

- **One server is a single point of failure.** A hardware fault costs minutes while the alarm recovers the instance. Anything worse costs the time to restore a snapshot, and up to a day of data. That is accepted for one support desk at this budget. The README's "At 100x scale" section describes the move to managed, redundant services.
- **Deploys cost capacity.** Building on the server takes CPU and memory from the running services for the few minutes of a deploy, and uses CPU credits.
- **Schema changes must be backward compatible**, or rolling back to an older commit breaks.
- **Rotating a database password takes two steps:** the parameter, then `ALTER ROLE`.
- **One long-lived credential exists**, the SES SMTP key, limited to sending as `info@dsddocs.com`.
- **Most email waits for production access.** Until SES grants it, most customer email isn't delivered. The ticket flow is unaffected.
- **The instance is replaceable from git.** Nothing about it lives outside the repository except the secrets in Parameter Store and the data on the volume.

## Alternatives considered

- **ECS on Fargate with RDS, ElastiCache and a load balancer.** Managed and redundant, but several times the budget before any traffic arrives. It is the README's path at scale, not the starting point.
- **Lightsail.** A cheaper bundle, but its instances can't take an IAM role, so reading Parameter Store would need a stored access key.
- **SSH with a key pair.** One more credential to guard and one more open port. Systems Manager gives audited access with neither.
- **Secrets Manager.** It costs per secret per month and offers rotation hooks this stack doesn't use. Parameter Store's standard tier is free and is already encrypted with KMS.
- **Images built in CI and pulled from a registry.** Faster deploys that don't load the server. It needs an OIDC role for GitHub Actions and a registry, and it is the next step. Building on the server is simpler to start and keeps what runs tied to a commit.
- **Amazon S3 for attachments.** It would replace SeaweedFS, but it needs another role permission. Keeping SeaweedFS means production runs the same object store as development and CI (NFR-13), and since the API speaks the S3 API, switching later is mostly configuration.
- **An x86 instance.** It costs more per hour for the same size, and nothing in the stack needs x86.

## Verification

- **Before a deploy:**
  - `docker compose --env-file <file> -f deploy/compose.production.yaml config` refuses a missing secret;
  - shellcheck passes on both scripts, and Prettier on the folder;
  - `packages/db/test/bootstrap.int.spec.ts` covers bootstrap: it runs once, refuses demo staff, never prints the password, and the seed skips afterwards;
  - the worker's `email-channel` integration test shows that a send without STARTTLS is refused when TLS is required.
- **During a deploy:** `deploy.sh` stops unless the commit is on `main`, every service is healthy, the API's `/ready` reports `ok`, and both names answer `/healthz` over HTTPS with a valid certificate.
- **After the first deploy:**
  - From outside: both names return 200 over Let's Encrypt certificates, HTTP redirects to HTTPS, and ports 22, 4000, 5432, 6379 and 8333 are closed.
  - Through Systems Manager:
    - the migrate log shows the bootstrap;
    - the database holds one brand and one admin, and no demo account;
    - a container can't get an IMDSv2 token.
  - SES reports the domain verified, with DKIM and MAIL FROM `SUCCESS`, and a test email arrives over STARTTLS.
