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
