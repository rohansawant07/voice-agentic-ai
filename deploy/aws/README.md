# Roam on AWS — single-host pilot

Region: **us-east-1**. The kit is ready and was verified locally (see Verification). **No AWS resources exist until you run `deploy.sh up` in a signed-in account.** It creates billable resources and asks for confirmation first.

## What it creates

`roam.cloudformation.yaml` defines one stack:

- One Amazon Linux 2023 **t3.small** (2 GiB RAM + 2 GiB swap) with an encrypted 20 GiB gp3 root volume. The volume is **retained** when the stack is deleted so conversation data is never lost silently.
- An **Elastic IP**. The public URL is `https://<ip-with-dashes>.sslip.io`. Caddy obtains a Let's Encrypt certificate automatically; no domain purchase is needed. sslip.io is a free public wildcard DNS service that maps the name to the IP.
- A security group that allows inbound **443 and 80 only** (80 serves ACME challenges and redirects to HTTPS). There is no SSH; administration uses Systems Manager.
- An instance role that can read only `/roam/*` parameters and use Session Manager.
- A Data Lifecycle Manager policy: **daily snapshots, seven kept**. Snapshots are crash-consistent; PostgreSQL recovers from them like a power loss. A restore has not been tested yet.

On first boot the host clones this repository (`GitRef`, default `main`). It installs Docker plus **checksum-verified, pinned** Compose v5.5.1 and Buildx v0.37.2, then runs `bootstrap.sh`. That script reads secrets from SSM Parameter Store, writes `.env`, `.secrets/compose.env` and the htpasswd hash (mode 0600, except the hash file), and runs:

```
docker compose -f compose.yaml -f deploy/aws/compose.aws.yaml up -d --build --wait
```

`compose.aws.yaml` adds Caddy on ports 80/443 and unpublishes the gateway. The traffic path is: browser → Caddy (TLS) → nginx gateway (Basic auth, rate limits on the real client IP) → web / orchestrator → PostgreSQL. WebSockets pass through unchanged.

## Cost (on-demand, us-east-1, approximate)

| Item | Monthly |
|---|---|
| t3.small, 730 h | ~$15.20 |
| Public IPv4 (Elastic IP) | ~$3.65 |
| 20 GiB gp3 | ~$1.60 |
| Snapshots (incremental, a few GiB) | < $0.50 |
| **Total** | **~$21** |

New-account credits or Free Tier eligibility may cover part of this; check **Billing → Free Tier / Credits** in the console. Anthropic and Deepgram usage is billed separately by those providers. An AWS Budgets alert is optional (see below). Alerts notify you; they do not cap spending.

## Deploy

Prerequisites: AWS CLI v2, an identity allowed to create EC2/IAM/CloudFormation/SSM/DLM resources, and your local `.env` with `ANTHROPIC_API_KEY` (and optionally `DEEPGRAM_API_KEY` for voice).

```bash
brew install awscli            # or the official installer
aws configure sso              # preferred; or: aws login
```

```bash
ROAM_BUDGET_EMAIL=you@example.com ROAM_BUDGET_USD=25 deploy/aws/deploy.sh up
```

The script:
1. Shows the account, region and estimated cost, then asks for confirmation.
2. Copies your API keys from `.env` to SSM as SecureString values. It writes them through a private temp file, never to the command line. It generates a database password, gateway token and tester password once and keeps them on later runs.
3. Picks the default VPC's subnet in us-east-1a, b or c, then runs `aws cloudformation deploy`.
4. Optionally creates the `roam-monthly` budget alert.
5. Saves the URL and login to `.secrets/aws-tester-login.txt` (ignored by Git), then waits until `https://…/healthz` answers. The first boot builds the images and takes about 10–15 minutes.

Day-to-day:

```bash
deploy/aws/deploy.sh status    # URL and health
deploy/aws/deploy.sh update    # pull main on the host and rebuild (ROAM_GIT_REF to pin)
deploy/aws/deploy.sh logs      # bootstrap and cloud-init logs via SSM
deploy/aws/deploy.sh down      # delete the stack; lists retained volumes to clean up
```

`update` pulls from GitHub, so push your commits first. Rotating the tester password: put a new `/roam/tester-password` value, then run `update`. **Never rotate `/roam/postgres-password`** without also changing it inside PostgreSQL; the retained volume keeps the old one.

## Security notes

- Basic auth is served only over HTTPS. HTTP redirects with 308, and HSTS is set.
- API keys live in SSM SecureString (AWS-managed key) and in a 0600 `.env` on the encrypted volume. They are never baked into images.
- Instance metadata requires IMDSv2 with hop limit 1, so containers cannot read the instance role credentials.
- There is a single shared `tester` identity. Give each tester their own credential, or move to a real identity provider, before wider sharing.
- Agency mutations stay disabled. Travel inventory is demo data, and Airbnb results are search links only. Destination listings (Wikivoyage) and weather (Open-Meteo) are fetched over outbound HTTPS, which the security group allows.

## Verification so far (October 27, 2026)

- `cfn-lint` passes on the template; `shellcheck` passes on `deploy.sh` and `bootstrap.sh`.
- The exact Compose overlay ran locally under a separate project with `ROAM_HOST=localhost` (Caddy internal CA). Results:
  - All eight containers became healthy.
  - HTTP → HTTPS returned 308 and HSTS was present.
  - Anonymous and wrong-password requests got 401; authenticated UI got 200; an invalid chat body got 400; the health check (no auth) got 200.
  - A live planning turn over HTTPS returned 200 in 15.8s, with the authenticated WebSocket streaming delegation, tool and result events.
  - Gateway logs recorded the real client address rather than Caddy's.
- **Not yet verified:** the CloudFormation stack in a real account, Let's Encrypt issuance for the sslip.io name, first-boot timing on t3.small, and snapshot restore. These happen on the first `deploy.sh up`.

## Limits and next steps

One host and one PostgreSQL instance give one failure domain; this is a pilot, not high availability. Builds run on the host, so an update briefly uses most of the CPU. For production: build images in CI and push them to ECR, use a managed database with tested restores, add per-user identity and quotas, and add monitoring and alarms. If Let's Encrypt rate-limits sslip.io names, point a domain you own at the Elastic IP. Then change `/opt/roam/host` and `WEB_ORIGIN` on the host and run `update`.

## Web search in the AWS stack

All agents use Anthropic's native `web_search_20250305` through `search_web`, using the same server-side Anthropic key stored in SSM. Compose enables it by default with Haiku 4.5; it adds Anthropic usage, not Deepgram usage. Research returns source links and retrieval times and does not provide verified booking inventory. See the [root guide](../../README.md#shared-web-research-october-27-2026) for limits and the [eval results](../../docs/evals/README.md) for known itinerary-quality failures.

`WEB_SEARCH_ENABLED` and `WEB_SEARCH_MODEL` are configurable through Compose environment values, but the current AWS bootstrap does not copy these optional settings from your laptop or SSM. It regenerates the host `.env` with provider credentials, so defaults apply after bootstrap/update. To persist different search settings, extend the bootstrap configuration before deploying; editing the generated host `.env` alone does not survive updates. No additional search service or inbound port is required.

This documentation refresh did not deploy AWS or validate account credits. Cost figures above are planning estimates, not a newly checked quote; confirm account eligibility and current pricing before a billable launch.
