#!/usr/bin/env bash
# Checks a running stack from the outside, the way a reviewer would use it.
# Run after `docker compose up --build --wait`.
set -euo pipefail

API=${API_URL:-http://localhost:4000}
CUSTOMER=${CUSTOMER_WEB_URL:-http://localhost:3000}
AGENT=${AGENT_WEB_URL:-http://localhost:3001}
MAILPIT=${MAILPIT_URL:-http://localhost:8025}

failures=0

pass() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n' "$1"
  failures=$((failures + 1))
}

# expect_status <description> <expected status> <url> [curl args...]
expect_status() {
  local description=$1 expected=$2 url=$3
  shift 3
  local status
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "$@" "$url" || true)
  if [[ $status == "$expected" ]]; then pass "$description"; else fail "$description (got $status, expected $expected)"; fi
}

# expect_body <description> <pattern> <url> [curl args...]
expect_body() {
  local description=$1 pattern=$2 url=$3 body
  shift 3
  body=$(curl --silent --max-time 10 "$@" "$url" || true)
  if grep --quiet --extended-regexp -- "$pattern" <<<"$body"; then pass "$description"; else fail "$description (body: ${body:0:200})"; fi
}

echo "API"
expect_status "liveness" 200 "$API/health"
expect_body "readiness reports PostgreSQL and Redis up" '"status":"ok".*"database":"up".*"redis":"up"' "$API/ready"
expect_status "Swagger UI" 200 "$API/api/docs"
expect_body "OpenAPI document" '"openapi":"3\.1\.0"' "$API/api/docs/openapi.json"
expect_body "unknown routes answer with problem details" '"status":404.*"requestId"' "$API/api/v1/no-such-route"

echo "Customer app"
expect_status "home page" 200 "$CUSTOMER/"
expect_body "pages send the app's security headers" "^[Cc]ontent-[Ss]ecurity-[Pp]olicy: frame-ancestors 'none'" "$CUSTOMER/" --dump-header - --output /dev/null
expect_status "healthcheck" 200 "$CUSTOMER/healthz"
expect_body "proxy reaches the API (problem details from the API)" '"detail":"Cannot GET /api/v1/customer/no-such-route"' "$CUSTOMER/api/v1/customer/no-such-route"
expect_body "proxy refuses staff routes itself" '"detail":"No such API route in this app\."' "$CUSTOMER/api/v1/staff/tickets"

echo "Agent app"
expect_status "home page" 200 "$AGENT/"
expect_status "healthcheck" 200 "$AGENT/healthz"
expect_body "proxy reaches the API (problem details from the API)" '"detail":"Cannot GET /api/v1/staff/no-such-route"' "$AGENT/api/v1/staff/no-such-route"
expect_body "proxy refuses customer routes itself" '"detail":"No such API route in this app\."' "$AGENT/api/v1/customer/tickets"

echo "Sign-in"
# One sign-in per account per run, so the per-email limit (5 in 15 minutes)
# allows several runs in a row.
jar=$(mktemp)
trap 'rm -f "$jar"' EXIT
sign_in() {
  local app=$1 realm=$2 email=$3
  shift 3
  curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \
    --cookie-jar "$jar" --cookie "$jar" "$@" \
    -X POST "$app/api/v1/auth/$realm/login" \
    -H "Origin: $app" -H 'Content-Type: application/json' \
    --data "{\"email\":\"$email\",\"password\":\"dsd-demo-password\"}" || true
}
expect_status "a sign-in from another site is refused (CSRF)" 403 "$CUSTOMER/api/v1/auth/customer/login" \
  -X POST -H 'Origin: https://attacker.example' -H 'Content-Type: application/json' \
  --data '{"email":"customer@example.com","password":"dsd-demo-password"}'
# The forged X-Forwarded-For must not become the session's address.
status=$(sign_in "$CUSTOMER" customer customer@example.com -H 'X-Forwarded-For: 203.0.113.99')
if [[ $status == 200 ]]; then pass "demo customer signs in through the customer app"; else fail "demo customer signs in through the customer app (got $status)"; fi
expect_body "the customer session works" '"email":"customer@example.com"' "$CUSTOMER/api/v1/auth/customer/me" --cookie "$jar"
ip=$(docker compose exec -T postgres psql -U postgres -d dsd -tAc \
  "SELECT host(ip) FROM sessions WHERE realm = 'customer' ORDER BY created_at DESC LIMIT 1" 2>/dev/null | tr -d '[:space:]' || true)
if [[ -n $ip && $ip != 203.0.113.99 ]]; then pass "a forged X-Forwarded-For is ignored (session address $ip)"; else fail "a forged X-Forwarded-For is ignored (session address '$ip')"; fi
status=$(sign_in "$AGENT" staff agent@dsd.example)
if [[ $status == 200 ]]; then pass "demo agent signs in through the agent app"; else fail "demo agent signs in through the agent app (got $status)"; fi
expect_body "the staff session works" '"role":"agent"' "$AGENT/api/v1/auth/staff/me" --cookie "$jar"

echo "Tickets"
# A guest submits a ticket with a file through the customer app, as its
# form will (multipart, fields first). Each run uses a fresh address, so the
# per-email limit never trips. The file comes from stdin.
guest_email="smoke-$(date +%s)-$RANDOM@example.com"
receipt=$(printf 'hub-01 lost Wi-Fi at 20:04\n' | curl --silent --max-time 15 \
  -X POST "$CUSTOMER/api/v1/public/tickets" \
  -H "Origin: $CUSTOMER" \
  -F "email=$guest_email" \
  -F "subject=Smoke test ticket" \
  -F "description=Raised by scripts/smoke.sh" \
  -F "attachments=@-;filename=smoke-log.txt;type=application/octet-stream" || true)
reference=$(grep -oE '"reference":"[A-Z]+-[0-9]+"' <<<"$receipt" | cut -d'"' -f4 || true)
if [[ -n $reference ]]; then pass "a guest submits a ticket with a file ($reference)"; else fail "a guest submits a ticket with a file (got ${receipt:0:200})"; fi

queue=$(curl --silent --max-time 10 --cookie "$jar" "$AGENT/api/v1/staff/tickets?sort=newest&limit=20" || true)
ticket_id=$(grep -oE "\"id\":\"[0-9a-f-]{36}\",\"reference\":\"$reference\"" <<<"$queue" | cut -d'"' -f4 || true)
if [[ -n $reference && -n $ticket_id ]]; then pass "the agent finds it in the queue"; else fail "the agent finds it in the queue"; fi

view=$(curl --silent --max-time 10 --cookie "$jar" "$AGENT/api/v1/staff/tickets/$ticket_id" || true)
attachment_id=$(grep -oE '"id":"[0-9a-f-]{36}","filename":"smoke-log.txt","contentType":"text/plain; charset=utf-8"' <<<"$view" | cut -d'"' -f4 || true)
if [[ -n $attachment_id ]]; then pass "the file was stored as plain text, typed by its content"; else fail "the file was stored as plain text, typed by its content (view: ${view:0:200})"; fi

headers=$(curl --silent --max-time 10 --cookie "$jar" --dump-header - --output /dev/null \
  "$AGENT/api/v1/staff/tickets/$ticket_id/attachments/$attachment_id" | tr -d '\r' || true)
if grep -qi "^content-disposition: attachment; filename\*=UTF-8''smoke-log.txt" <<<"$headers" &&
  grep -qi '^x-content-type-options: nosniff' <<<"$headers" &&
  grep -qi "^content-security-policy: default-src 'none'; sandbox" <<<"$headers"; then
  pass "the agent downloads it as an attachment, sandboxed"
else
  fail "the agent downloads it as an attachment, sandboxed (headers: ${headers:0:300})"
fi
expect_status "the customer app won't serve a staff download" 404 \
  "$CUSTOMER/api/v1/staff/tickets/$ticket_id/attachments/$attachment_id"

echo "Emails"
# Mail arrives in Mailpit; its API is read with node, which the stack needs
# anyway, rather than assuming jq is installed.

# wait_for_email <address> <subject pattern> [seconds]: prints the text body of
# the newest matching email, or nothing once the time is up.
wait_for_email() {
  local address=$1 pattern=$2 seconds=${3:-30} found
  for ((i = 0; i < seconds * 2; i++)); do
    found=$(curl --silent --max-time 5 "$MAILPIT/api/v1/search?query=$(node -e 'process.stdout.write(encodeURIComponent(`to:"${process.argv[1]}"`))' "$address")" |
      node -e '
        let s = "";
        process.stdin.on("data", (d) => (s += d)).on("end", () => {
          const hit = (JSON.parse(s).messages ?? []).find((m) => new RegExp(process.argv[1]).test(m.Subject));
          if (hit) process.stdout.write(hit.ID);
        });' "$pattern" 2>/dev/null || true)
    if [[ -n $found ]]; then
      curl --silent --max-time 5 "$MAILPIT/api/v1/message/$found" |
        node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>process.stdout.write(JSON.parse(s).Text))'
      return
    fi
    sleep 0.5
  done
}
token_in() { grep -oE '#token=[A-Za-z0-9_-]{43}' <<<"$1" | head -n 1 | cut -d= -f2; }
staff_csrf() { awk '$6 == "dsd_staff_csrf" { print $7 }' "$jar" | tail -n 1; }

ack=$(wait_for_email "$guest_email" "We've received your request")
guest_token=$(token_in "$ack")
if [[ -n $guest_token ]]; then pass "the guest's acknowledgement arrives with an access link"; else fail "the guest's acknowledgement arrives with an access link (got: ${ack:0:200})"; fi

guest_jar=$(mktemp)
trap 'rm -f "$jar" "$guest_jar"' EXIT
status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \
  --cookie-jar "$guest_jar" -X POST "$CUSTOMER/api/v1/auth/customer/guest-access/exchange" \
  -H "Origin: $CUSTOMER" -H 'Content-Type: application/json' --data "{\"token\":\"$guest_token\"}" || true)
if [[ $status == 200 ]]; then pass "the emailed link opens a guest session through the customer app"; else fail "the emailed link opens a guest session through the customer app (got $status)"; fi
expect_body "the guest session shows the ticket" "\"reference\":\"$reference\"" \
  "$CUSTOMER/api/v1/customer/tickets/$ticket_id" --cookie "$guest_jar"

reply_text="Smoke reply $RANDOM: please restart the hub."
status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 \
  --cookie "$jar" -X POST "$AGENT/api/v1/staff/tickets/$ticket_id/replies" \
  -H "Origin: $AGENT" -H "X-CSRF-Token: $(staff_csrf)" \
  -F "body=$reply_text" -F "status=pending_customer" || true)
if [[ $status == 201 ]]; then pass "the agent replies and waits for the customer"; else fail "the agent replies and waits for the customer (got $status)"; fi
reply=$(wait_for_email "$guest_email" "New reply")
if grep -qF "$reply_text" <<<"$reply" && grep -qF "waiting for your reply" <<<"$reply"; then
  pass "one email carries the reply and the new status"
else
  fail "one email carries the reply and the new status (got: ${reply:0:300})"
fi

# Sign-up and password reset, end to end, on a fresh address.
member_email="smoke-member-$(date +%s)-$RANDOM@example.com"
curl --silent --output /dev/null --max-time 10 -X POST "$CUSTOMER/api/v1/auth/customer/signup" \
  -H "Origin: $CUSTOMER" -H 'Content-Type: application/json' --data "{\"email\":\"$member_email\"}" || true
signup_token=$(token_in "$(wait_for_email "$member_email" "Finish creating")")
status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \
  -X POST "$CUSTOMER/api/v1/auth/customer/signup/complete" -H "Origin: $CUSTOMER" -H 'Content-Type: application/json' \
  --data "{\"token\":\"$signup_token\",\"displayName\":\"Smoke Member\",\"password\":\"first smoke password\"}" || true)
if [[ $status == 200 ]]; then pass "sign-up completes from the emailed link"; else fail "sign-up completes from the emailed link (got $status)"; fi
curl --silent --output /dev/null --max-time 10 -X POST "$CUSTOMER/api/v1/auth/customer/password-reset/request" \
  -H "Origin: $CUSTOMER" -H 'Content-Type: application/json' --data "{\"email\":\"$member_email\"}" || true
reset_token=$(token_in "$(wait_for_email "$member_email" "Reset your")")
status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \
  -X POST "$CUSTOMER/api/v1/auth/customer/password-reset/complete" -H "Origin: $CUSTOMER" -H 'Content-Type: application/json' \
  --data "{\"token\":\"$reset_token\",\"password\":\"second smoke password\"}" || true)
status_login=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \
  -X POST "$CUSTOMER/api/v1/auth/customer/login" -H "Origin: $CUSTOMER" -H 'Content-Type: application/json' \
  --data "{\"email\":\"$member_email\",\"password\":\"second smoke password\"}" || true)
if [[ $status == 200 && $status_login == 200 ]]; then pass "a password reset from the emailed link works"; else fail "a password reset from the emailed link works (reset $status, sign-in $status_login)"; fi

# With the mail server down, a customer can still submit and an agent can
# still reply; the email goes out once it is back (NFR-10).
docker compose stop mailpit >/dev/null 2>&1 || true
outage_email="smoke-outage-$(date +%s)-$RANDOM@example.com"
status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 \
  -X POST "$CUSTOMER/api/v1/public/tickets" -H "Origin: $CUSTOMER" \
  -F "email=$outage_email" -F "subject=Raised while mail is down" -F "description=Raised by scripts/smoke.sh" || true)
reply_status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 \
  --cookie "$jar" -X POST "$AGENT/api/v1/staff/tickets/$ticket_id/replies" \
  -H "Origin: $AGENT" -H "X-CSRF-Token: $(staff_csrf)" -F "body=Sent while mail is down" || true)
docker compose start mailpit >/dev/null 2>&1 || true
docker compose up --detach --wait mailpit >/dev/null 2>&1 || true
if [[ $status == 201 && $reply_status == 201 ]]; then pass "with the mail server down, submitting and replying still work"; else fail "with the mail server down, submitting and replying still work (submit $status, reply $reply_status)"; fi
late=$(wait_for_email "$outage_email" "We've received your request" 120)
if [[ -n $late ]]; then pass "the delayed email arrives once the mail server is back"; else fail "the delayed email arrives once the mail server is back"; fi

echo "Knowledge base"
expect_body "the help centre lists the seeded articles" '"slug":"reset-your-password"' \
  "$CUSTOMER/api/v1/public/kb/articles?limit=100"
expect_body "search ranks the article and marks the match" \
  '"slug":"refund-timescales".*"text":"[Rr]efund[a-z]*","highlighted":true' \
  "$CUSTOMER/api/v1/public/kb/articles?q=refund"
expect_status "a draft isn't public" 404 "$CUSTOMER/api/v1/public/kb/articles/tempo-thermostat-firmware"
expect_body "the agent reads drafts too" '"status":"draft"' \
  "$AGENT/api/v1/staff/kb/articles?status=draft" --cookie "$jar"

echo "Database"
tickets=$(docker compose exec -T postgres psql -U postgres -d dsd -tAc "SELECT count(*) FROM tickets" 2>/dev/null | tr -d '[:space:]' || true)
if [[ $tickets -gt 0 ]] 2>/dev/null; then pass "migrated and seeded ($tickets tickets)"; else fail "migrated and seeded (got '$tickets' tickets)"; fi

echo "Supporting services"
expect_status "Mailpit web UI" 200 "$MAILPIT/"
# Ask from inside the store's container, as the API would, over its own network.
s3_status() {
  docker compose exec -T seaweedfs sh -c "curl --silent --output /dev/null --write-out '%{http_code}' $1 http://127.0.0.1:8333/dsd-attachments" || true
}
signed=$(s3_status '--aws-sigv4 aws:amz:us-east-1:s3 --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"')
anonymous=$(s3_status '')
if [[ $signed == 200 ]]; then pass "attachments bucket exists (signed request)"; else fail "attachments bucket exists (got $signed)"; fi
if [[ $anonymous == 403 ]]; then pass "attachments bucket refuses anonymous access"; else fail "attachments bucket refuses anonymous access (got $anonymous)"; fi

if ((failures > 0)); then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed"
