#!/usr/bin/env bash
# Deploys one commit of main to this server (ADR-0014). Run it as root, for
# example through AWS Systems Manager:
#
#   /srv/dsd-support/app/deploy/deploy.sh <full commit SHA>
#
# 1. Checks the commit out from GitHub, refusing one that isn't on main.
# 2. Writes /srv/dsd-support/.env from SSM Parameter Store, readable by
#    root only.
# 3. Builds the images on this server and starts everything but Caddy.
# 4. Starts Caddy only once both names resolve to this server: a failed
#    certificate request counts against Let's Encrypt's rate limits.
# 5. Checks the deployment from the inside and through HTTPS.
#
# To roll back, deploy an older commit. Migrations only move forward, so an
# older commit runs against the newer schema.
#
# It never prints a secret: there is no `set -x`, and the values read from
# SSM go straight into the env file.
set -euo pipefail

REPO_URL=https://github.com/AqeelDEV/dsd-support-system.git
REGION=ap-south-1
PARAMETER_PATH=/dsd-support/prod/
DOMAINS=(support.dsddocs.com agents.dsddocs.com)
ROOT=/srv/dsd-support
APP=$ROOT/app
ENV_FILE=$ROOT/.env

sha=${1:-}
if ! [[ $sha =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <full 40-character commit SHA on main>" >&2
  exit 64
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

install -d -m 700 "$ROOT"
log=/var/log/dsd-deploy-$(date -u +%Y%m%dT%H%M%SZ).log
exec > >(tee -a "$log") 2>&1
step() { printf '\n==> %s (%s)\n' "$*" "$(date -u +%H:%M:%S)"; }
echo "Deploying $sha; this log is $log"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$APP/deploy/compose.production.yaml" "$@"
}

step "Checking out $sha"
if [ ! -d "$APP/.git" ]; then
  git init -q "$APP"
  git -C "$APP" remote add origin "$REPO_URL"
fi
git -C "$APP" fetch -q origin +refs/heads/main:refs/remotes/origin/main
if ! git -C "$APP" merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then
  echo "$sha is not a commit on main; only main is deployed." >&2
  exit 65
fi
git -C "$APP" checkout -q -f --detach "$sha"

step "Writing $ENV_FILE from SSM Parameter Store"
# Each parameter under the path becomes NAME='value'. Single quotes keep
# Compose from interpolating anything inside a value, so a value must not
# contain a quote, a dollar sign or a line break; one that does stops the
# deploy, named but not shown.
read -r -d '' to_env <<'JQ' || true
.Parameters[]
| (.Name | split("/") | last) as $name
| if ($name | test("^[A-Z][A-Z0-9_]*$")) and (.Value | test("^[A-Za-z0-9 @._+/=:,-]+$"))
  then "\($name)='\(.Value)'"
  else error("parameter \($name) holds a character the env file can't keep safely")
  end
JQ
umask 077
rendered=$(mktemp "$ROOT/.env.XXXXXX")
trap 'rm -f "$rendered"' EXIT
aws ssm get-parameters-by-path --region "$REGION" --path "$PARAMETER_PATH" \
  --recursive --with-decryption --output json | jq -r "$to_env" >"$rendered"
chmod 600 "$rendered"
mv "$rendered" "$ENV_FILE"
echo "$(wc -l <"$ENV_FILE") settings written."

step "Building the images (slow on a small server)"
compose build --pull

step "Starting everything but Caddy"
compose up -d --wait --remove-orphans \
  postgres redis seaweedfs migrate api worker customer-web agent-web
compose logs --no-color migrate | tail -n 3

step "Checking that both names point at this server"
imds=http://169.254.169.254/latest
token=$(curl -fsS -X PUT "$imds/api/token" -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
public_ip=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" "$imds/meta-data/public-ipv4")
dns_ready=true
for name in "${DOMAINS[@]}"; do
  for resolver in 1.1.1.1 8.8.8.8; do
    answer=$(dig +short A "$name" @"$resolver" | tail -n 1)
    if [ "$answer" = "$public_ip" ]; then
      echo "$name -> $answer on $resolver"
    else
      echo "$name -> ${answer:-nothing} on $resolver, not $public_ip"
      dns_ready=false
    fi
  done
done
if [ "$dns_ready" != true ]; then
  echo "Caddy was not started, so no certificate was requested. Run this again once DNS has caught up." >&2
  exit 75
fi

step "Starting Caddy"
compose up -d --wait caddy
# A deploy may have changed the Caddyfile; reloading an unchanged one is a no-op.
compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

step "Checking the deployment"
compose exec -T api node -e "
  fetch('http://127.0.0.1:4000/ready').then(async (response) => {
    const body = await response.json();
    console.log('API /ready:', JSON.stringify(body));
    process.exit(response.ok && body.status === 'ok' ? 0 : 1);
  }, () => process.exit(1));
"
for name in "${DOMAINS[@]}"; do
  # The first certificate can take a minute; --resolve still checks it
  # against the real name, without leaving the server.
  for attempt in $(seq 1 24); do
    if status=$(curl -fsS --resolve "$name:443:127.0.0.1" -o /dev/null \
      -w '%{http_code}' "https://$name/healthz" 2>/dev/null); then
      echo "https://$name/healthz -> $status"
      break
    fi
    if [ "$attempt" -eq 24 ]; then
      echo "https://$name/healthz did not answer over HTTPS." >&2
      compose logs --no-color --tail 30 caddy >&2
      exit 1
    fi
    sleep 5
  done
done
compose ps --format 'table {{.Service}}\t{{.Status}}'

echo "$sha $(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$ROOT/DEPLOYED_COMMIT"
docker image prune -f >/dev/null
step "Deployed $sha"
