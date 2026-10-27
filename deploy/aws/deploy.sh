#!/usr/bin/env bash
# Roam on AWS: one EC2 host, Caddy HTTPS on <elastic-ip>.sslip.io, Basic auth.
# Run from anywhere inside the repository with a signed-in AWS CLI v2.
#
#   deploy/aws/deploy.sh up       create or update the stack, then wait for HTTPS
#   deploy/aws/deploy.sh update   rebuild the host from GitHub ($ROAM_GIT_REF, default main)
#   deploy/aws/deploy.sh status   show the URL and health
#   deploy/aws/deploy.sh logs     print the host's recent bootstrap log
#   deploy/aws/deploy.sh down     delete the stack (the data volume is retained)
#
# Optional: ROAM_BUDGET_EMAIL=you@example.com ROAM_BUDGET_USD=25 adds an AWS
# Budgets alert (alerts are not a spending cap).
set -euo pipefail

REGION=${AWS_REGION:-us-east-1}
STACK=${ROAM_STACK:-roam}
REF=${ROAM_GIT_REF:-main}
INSTANCE_TYPE=${ROAM_INSTANCE_TYPE:-t3.small}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

aws() { command aws --region "$REGION" "$@"; }
say() { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
confirm() {
  local answer
  read -r -p "$1 [y/N] " answer
  [ "$answer" = y ] || [ "$answer" = Y ] || fail "Cancelled."
}

signed_in() {
  command -v aws >/dev/null ||
    fail "AWS CLI v2 is not installed. See https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) ||
    fail "The AWS CLI is not signed in. Run 'aws configure sso' or 'aws login', then retry."
}

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null
}

# Values travel through a private temp file, never argv or the terminal.
put_secret() { # name value [overwrite]
  local tmp
  tmp=$(mktemp)
  chmod 600 "$tmp"
  printf '%s' "$2" > "$tmp"
  aws ssm put-parameter --name "/roam/$1" --type SecureString \
    --value "file://$tmp" ${3:+--overwrite} >/dev/null
  rm -f "$tmp"
}
has_param() { aws ssm get-parameter --name "/roam/$1" >/dev/null 2>&1; }
env_value() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -1 | tr -d '"'"'"; }

sync_secrets() {
  local anthropic deepgram
  anthropic=$(env_value ANTHROPIC_API_KEY)
  [ -n "$anthropic" ] || fail "ANTHROPIC_API_KEY is missing from .env."
  put_secret anthropic-api-key "$anthropic" overwrite
  deepgram=$(env_value DEEPGRAM_API_KEY)
  if [ -n "$deepgram" ]; then put_secret deepgram-api-key "$deepgram" overwrite; fi
  # Generated once and then kept: the database volume depends on its password.
  has_param postgres-password || put_secret postgres-password "$(openssl rand -hex 32)"
  has_param gateway-token || put_secret gateway-token "$(openssl rand -hex 32)"
  has_param tester-password || put_secret tester-password "$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')"
  say "Secrets are in SSM Parameter Store under /roam/ (SecureString)."
}

save_login() {
  local password
  password=$(aws ssm get-parameter --name /roam/tester-password --with-decryption \
    --query Parameter.Value --output text)
  mkdir -p .secrets && chmod 700 .secrets
  (umask 077 && printf 'URL: %s\nUsername: tester\nPassword: %s\n' "$1" "$password" \
    > .secrets/aws-tester-login.txt)
}

budget_alert() {
  [ -n "${ROAM_BUDGET_EMAIL:-}" ] || return 0
  if aws budgets describe-budget --account-id "$ACCOUNT" --budget-name roam-monthly >/dev/null 2>&1; then
    say "Budget alert roam-monthly already exists."
    return
  fi
  local amount=${ROAM_BUDGET_USD:-25}
  aws budgets create-budget --account-id "$ACCOUNT" \
    --budget "{\"BudgetName\":\"roam-monthly\",\"BudgetLimit\":{\"Amount\":\"$amount\",\"Unit\":\"USD\"},\"TimeUnit\":\"MONTHLY\",\"BudgetType\":\"COST\"}" \
    --notifications-with-subscribers \
    "[{\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":80},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$ROAM_BUDGET_EMAIL\"}]},{\"Notification\":{\"NotificationType\":\"FORECASTED\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":100},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$ROAM_BUDGET_EMAIL\"}]}]"
  say "Budget alert: email at 80% of \$$amount actual or 100% forecast."
}

wait_for_https() {
  local url=$1 code
  say "Waiting for $url (first boot builds the images, about 10-15 minutes)..."
  for _ in $(seq 1 90); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url/healthz" || true)
    if [ "$code" = 200 ]; then say "Roam is up: $url"; return; fi
    sleep 15
  done
  fail "No healthy HTTPS response after 22 minutes. Check: deploy/aws/deploy.sh logs"
}

run_on_host() { # command...
  local instance id status
  instance=$(output InstanceId)
  [ -n "$instance" ] && [ "$instance" != None ] || fail "Stack $STACK has no instance."
  id=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
    --parameters "{\"commands\":[\"$1\"]}" --timeout-seconds 1800 \
    --query Command.CommandId --output text)
  while :; do
    sleep 10
    status=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$instance" \
      --query Status --output text 2>/dev/null || echo Pending)
    case $status in Pending | InProgress | Delayed) continue ;; esac
    break
  done
  aws ssm get-command-invocation --command-id "$id" --instance-id "$instance" \
    --query StandardOutputContent --output text | tail -40
  [ "$status" = Success ] || fail "Host command finished with status $status."
}

case ${1:-} in
up)
  signed_in
  [ -f .env ] || fail "Run from the repository with your .env present."
  say "Account $ACCOUNT, region $REGION, stack $STACK, instance $INSTANCE_TYPE."
  say "Estimated on-demand cost: about \$21/month (t3.small, 20 GiB gp3, public IPv4, snapshots)."
  say "Model and speech usage is billed separately by Anthropic and Deepgram."
  confirm "Create or update these billable resources and upload your API keys to SSM?"
  sync_secrets
  vpc=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
  [ "$vpc" != None ] || fail "No default VPC in $REGION. Create one or pass VpcId/SubnetId yourself."
  # us-east-1e has no t3 capacity; prefer the a-c zones.
  subnet=$(aws ec2 describe-subnets \
    --filters Name=vpc-id,Values="$vpc" Name=default-for-az,Values=true \
    Name=availability-zone,Values="${REGION}a,${REGION}b,${REGION}c" \
    --query 'Subnets[0].SubnetId' --output text)
  [ "$subnet" != None ] || fail "No default subnet found in $vpc."
  aws cloudformation deploy --stack-name "$STACK" \
    --template-file deploy/aws/roam.cloudformation.yaml \
    --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
    --tags project=roam \
    --parameter-overrides VpcId="$vpc" SubnetId="$subnet" \
    InstanceType="$INSTANCE_TYPE" GitRef="$REF"
  budget_alert
  url=$(output Url)
  save_login "$url"
  say "Login saved to .secrets/aws-tester-login.txt (ignored by Git)."
  wait_for_https "$url"
  ;;
update)
  signed_in
  run_on_host "cd /opt/roam/app && git fetch --depth 1 origin $REF && git checkout -f FETCH_HEAD && bash deploy/aws/bootstrap.sh"
  wait_for_https "$(output Url)"
  ;;
status)
  signed_in
  url=$(output Url)
  [ -n "$url" ] && [ "$url" != None ] || fail "Stack $STACK is not deployed in $REGION."
  say "URL: $url"
  say "Health: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url/healthz" || echo unreachable)"
  ;;
logs)
  signed_in
  run_on_host "tail -60 /var/log/roam-bootstrap.log; tail -20 /var/log/cloud-init-output.log"
  ;;
down)
  signed_in
  confirm "Delete stack $STACK? The instance stops serving; its data volume is retained."
  aws cloudformation delete-stack --stack-name "$STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK"
  say "Deleted. Retained volumes still cost about \$1.60/month each until you remove them:"
  aws ec2 describe-volumes --filters Name=tag:Backup,Values=roam Name=status,Values=available \
    --query 'Volumes[].[VolumeId,Size,CreateTime]' --output text
  say "Back up anything you need, then: aws ec2 delete-volume --region $REGION --volume-id <id>"
  say "Snapshots and /roam/ SSM parameters are also kept; remove them when no longer needed."
  ;;
*)
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
