#!/usr/bin/env bash
# Prepares a fresh Ubuntu 24.04 server to run the production stack
# (ADR-0014). Safe to run again. Run it as root, for example through AWS
# Systems Manager (there is no SSH):
#
#   bash deploy/setup-server.sh
#
# It installs Docker Engine and the Compose plugin from Docker's own apt
# repository, the AWS CLI, a swap file (building the images needs more than
# the server's 4 GB of memory), and daily security updates.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
step() { printf '\n==> %s\n' "$*"; }

step "Updating the system"
apt-get update -q
apt-get -q -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
apt-get -q -y install ca-certificates curl git jq dnsutils unattended-upgrades

step "Installing Docker Engine and the Compose plugin"
install -m 0755 -d /etc/apt/keyrings
if [ ! -s /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
# shellcheck source=/dev/null
. /etc/os-release
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update -q
apt-get -q -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

step "Installing the AWS CLI"
# deploy.sh reads the secrets from SSM Parameter Store with it, using the
# instance's role. The snap is published by AWS and updates itself.
if ! command -v aws >/dev/null 2>&1; then
  snap install aws-cli --classic
fi

step "Adding 4 GB of swap"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  if [ ! -f /swapfile ]; then
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
# Use it for builds and emergencies, not for the running services.
echo 'vm.swappiness=10' >/etc/sysctl.d/90-dsd-swap.conf
sysctl -q -p /etc/sysctl.d/90-dsd-swap.conf

step "Turning on daily security updates"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat >/etc/apt/apt.conf.d/52dsd-unattended-upgrades <<'EOF'
// Ubuntu's security updates install every day. When one needs a reboot, it
// happens at 23:30 UTC (03:30 in Dubai), and the containers start again on
// their own (restart: unless-stopped).
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "23:30";
EOF
systemctl enable --now unattended-upgrades

step "Creating /srv/dsd-support"
# The checkout and the rendered .env live here, readable by root only.
install -d -m 700 /srv/dsd-support

step "Done"
docker --version
docker compose version
aws --version
