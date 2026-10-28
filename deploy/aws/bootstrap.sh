#!/bin/bash
# Runs as root on the Roam EC2 host, on first boot and on every update.
# Idempotent: installs Docker tooling once, then rebuilds and restarts the stack.
# Secrets come from SSM Parameter Store (/roam/*); none are stored in Git.
set -euo pipefail
exec > >(tee -a /var/log/roam-bootstrap.log) 2>&1
echo "== roam bootstrap $(date -u +%FT%TZ)"

APP=/opt/roam/app
HOST=$(cat /opt/roam/host)
COMPOSE_VERSION=v5.5.1
BUILDX_VERSION=v0.37.2
# Published release checksums, per architecture (t4g is arm64; t3 is x86_64).
case $(uname -m) in
aarch64)
  COMPOSE_ASSET=docker-compose-linux-aarch64
  COMPOSE_SHA256=732e3a84c1a0f67256ce80bc2598a24546b10ca05f9faa97efceb1171ece2ef7
  BUILDX_ASSET=buildx-$BUILDX_VERSION.linux-arm64
  BUILDX_SHA256=efa38cb7aa7db2dbb9ad049b00b0a9737f66f033626177b5a4e845184ad7ab29
  ;;
x86_64)
  COMPOSE_ASSET=docker-compose-linux-x86_64
  COMPOSE_SHA256=db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576
  BUILDX_ASSET=buildx-$BUILDX_VERSION.linux-amd64
  BUILDX_SHA256=982ca20490b45ed1ec8d99795974d3d874a358f75938c9c237305010e6b7e548
  ;;
*) echo "Unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac
PLUGINS=/usr/local/lib/docker/cli-plugins

token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
REGION=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/placement/region)

install_plugin() { # name url sha256
  local target="$PLUGINS/$1"
  if [ -x "$target" ] && echo "$3  $target" | sha256sum -c --quiet; then return; fi
  curl -fsSL -o "$target.tmp" "$2"
  echo "$3  $target.tmp" | sha256sum -c --quiet
  chmod 755 "$target.tmp"
  mv "$target.tmp" "$target"
}

if ! command -v docker >/dev/null; then dnf install -y docker openssl; fi
mkdir -p "$PLUGINS"
install_plugin docker-compose \
  "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/$COMPOSE_ASSET" \
  "$COMPOSE_SHA256"
install_plugin docker-buildx \
  "https://github.com/docker/buildx/releases/download/$BUILDX_VERSION/$BUILDX_ASSET" \
  "$BUILDX_SHA256"
systemctl enable --now docker

# The Next.js build needs more than 2 GiB; swap keeps a 2 GiB instance viable.
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; }
  swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap defaults 0 0' >> /etc/fstab
fi

param() {
  aws ssm get-parameter --region "$REGION" --with-decryption --name "/roam/$1" \
    --query Parameter.Value --output text 2>/dev/null || true
}
required() {
  local value
  value=$(param "$1")
  if [ -z "$value" ] || [ "$value" = None ]; then
    echo "Missing SSM parameter /roam/$1. Run deploy/aws/deploy.sh up from your laptop." >&2
    exit 1
  fi
  printf '%s' "$value"
}

cd "$APP"
umask 077
mkdir -p .secrets
deepgram=$(param deepgram-api-key)
{
  echo "ANTHROPIC_API_KEY=$(required anthropic-api-key)"
  if [ -n "$deepgram" ] && [ "$deepgram" != None ]; then
    echo "DEEPGRAM_API_KEY=$deepgram"
    echo "VOICE_STT=deepgram"
  fi
} > .env
{
  echo "POSTGRES_PASSWORD=$(required postgres-password)"
  echo "GATEWAY_TOKEN=$(required gateway-token)"
  echo "WEB_ORIGIN=https://$HOST"
  echo "ROAM_HOST=$HOST"
} > .secrets/compose.env
# nginx reads the hash from inside its container; it holds no plaintext.
required tester-password | openssl passwd -apr1 -stdin | sed 's/^/tester:/' > .secrets/htpasswd
chmod 644 .secrets/htpasswd

compose() {
  docker compose -f compose.yaml -f deploy/aws/compose.aws.yaml \
    --env-file .env --env-file .secrets/compose.env "$@"
}
# Build one image at a time: parallel builds overload a 2-vCPU, 2 GiB host and
# the package downloads time out. The shared build stage is cached after the first.
for service in travel weather agency orchestrator web; do
  compose build "$service"
done
compose up -d --wait --remove-orphans
docker image prune -f >/dev/null
echo "== roam ready at https://$HOST"
