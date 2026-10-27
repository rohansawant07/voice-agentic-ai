# Roam on AWS — single-host pilot

Region: **us-east-1**. **Deployed October 27, 2026** at https://98-95-105-10.sslip.io (stack `roam`, instance `i-0217dc4871acb1db9`). Running `deploy.sh up` again updates that stack. It creates billable resources and asks for confirmation first.

## What it creates

`roam.cloudformation.yaml` defines one stack:

- One Amazon Linux 2023 **t4g.small** (Graviton/arm64, 2 GiB RAM + 2 GiB swap) with an encrypted 20 GiB gp3 root volume. CPU credits are set to **standard**: under sustained load (such as an image build) the CPU slows to its baseline instead of billing surplus credits. The volume is **retained** when the stack is deleted so conversation data is never lost silently.
- An **Elastic IP**. The public URL is `https://<ip-with-dashes>.sslip.io`. Caddy obtains a Let's Encrypt certificate automatically; no domain purchase is needed. sslip.io is a free public wildcard DNS service that maps the name to the IP.
- A security group that allows inbound **443 and 80 only** (80 serves ACME challenges and redirects to HTTPS). There is no SSH; administration uses Systems Manager.
- An instance role that can read only `/roam/*` parameters and use Session Manager.
- A Data Lifecycle Manager policy: **daily snapshots, seven kept**. Snapshots are crash-consistent; PostgreSQL recovers from them like a power loss. A restore has not been tested yet.

On first boot the host clones this repository (`GitRef`, default `main`). It installs Docker plus **checksum-verified, pinned** Compose v5.5.1 and Buildx v0.37.2 for the host's architecture (arm64 on t4g; x86_64 checksums are kept for t3), then runs `bootstrap.sh`. That script reads secrets from SSM Parameter Store, writes `.env`, `.secrets/compose.env` and the htpasswd hash (mode 0600, except the hash file), and runs:

```
docker compose -f compose.yaml -f deploy/aws/compose.aws.yaml up -d --build --wait
```

`compose.aws.yaml` adds Caddy on ports 80/443 and unpublishes the gateway. The traffic path is: browser → Caddy (TLS) → nginx gateway (Basic auth, rate limits on the real client IP) → web / orchestrator → PostgreSQL. WebSockets pass through unchanged.

## Cost (us-east-1, approximate)

| Item | Monthly until Dec 31, 2026 | Monthly from Jan 1, 2027 |
|---|---|---|
| t4g.small, 730 h | **$0** (T4g free trial) | ~$12.30 On-Demand |
| Public IPv4 (Elastic IP) | ~$3.65 | ~$3.65 |
| 20 GiB gp3 | ~$1.60 | ~$1.60 |
| Snapshots (incremental, a few GiB) | < $0.50 | < $0.50 |
| **Total** | **~$6** | **~$18** |

The [T4g free trial](https://aws.amazon.com/ec2/instance-types/t4/) gives **every** AWS account, new or existing, 750 t4g.small hours a month until December 31, 2026. That is one instance running all month. The hours are pooled across Regions, so a second t4g instance would exceed them. Standard CPU credits avoid the surplus-credit charges the trial does not cover.

Accounts opened on or after July 15, 2025 are on the credit-based Free Plan: $100 at signup plus up to $100 for onboarding tasks. Those credits can absorb the remaining ~$6/month for the plan's six months; after that the account must be upgraded to a paid plan to keep running. Accounts opened earlier get no credits, but the T4g trial still applies. Check **Billing → Free Tier / Credits** in the console. An earlier version of this kit used t3.small at about $21/month; `ROAM_INSTANCE_TYPE=t4g.medium` is the only other allowed size. Anthropic and Deepgram usage is billed separately by those providers. An AWS Budgets alert is optional (see below). Alerts notify you; they do not cap spending.

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
- The arm64 Compose and Buildx downloads match their published SHA-256 checksums and are aarch64 executables. Amazon Linux 2023 on arm64 reports `aarch64`, the value `bootstrap.sh` selects them by.
- On an arm64 Mac, the AWS overlay built all images natively as arm64 at the current code (including web search). All eight containers were healthy, with 401 anonymous, 200 authenticated, 400 invalid body and a 308 HTTP→HTTPS redirect.
- The exact Compose overlay ran locally under a separate project with `ROAM_HOST=localhost` (Caddy internal CA). Results:
  - All eight containers became healthy.
  - HTTP → HTTPS returned 308 and HSTS was present.
  - Anonymous and wrong-password requests got 401; authenticated UI got 200; an invalid chat body got 400; the health check (no auth) got 200.
  - A live planning turn over HTTPS returned 200 in 15.8s, with the authenticated WebSocket streaming delegation, tool and result events.
  - Gateway logs recorded the real client address rather than Caddy's.
- **Verified in the real account (October 27, 2026):**
  - The first `up` failed: DLM rejected the comma in the snapshot policy description, and cfn-lint does not check that. AWS rolled back with no leftover instance, volume or IP. Fixed and redeployed.
  - The arm64 AMI resolved and the t4g.small launched with standard credits, IMDSv2 and a 20 GiB encrypted gp3 volume (DeleteOnTermination false). The DLM policy is enabled, and the security group allows only 80 and 443.
  - First boot took about 19 minutes from launch to healthy HTTPS.
  - Let's Encrypt issued a certificate for the sslip.io name (expires January 25, 2027).
  - The live site returned 200 health, 401 anonymous and wrong-password, 200 authenticated, 400 invalid body, and a 308 HTTP→HTTPS redirect. A live Harpers Ferry planning turn returned 200 in 22.5s with WebSocket events.
  - The `roam-monthly` $10 budget alert exists.
- The host cloned `main` at `1b38139` (about 15:45 EDT), before the itinerary-guard commits `ec9388a` and `5b03c5b`. Run `deploy.sh update` to rebuild it at the current `main`.
- **Still unverified:** snapshot restore, and an `update` run.

## Limits and next steps

One host and one PostgreSQL instance give one failure domain; this is a pilot, not high availability. Builds run on the host, so an update briefly uses most of the CPU. For production: build images in CI and push them to ECR, use a managed database with tested restores, add per-user identity and quotas, and add monitoring and alarms. If Let's Encrypt rate-limits sslip.io names, point a domain you own at the Elastic IP. Then change `/opt/roam/host` and `WEB_ORIGIN` on the host and run `update`.

## Web search in the AWS stack

All agents use Anthropic's native `web_search_20250305` through `search_web`, using the same server-side Anthropic key stored in SSM. Compose enables it by default with Haiku 4.5 (specialists themselves default to Haiku 5.5); it adds Anthropic usage, not Deepgram usage. Research returns source links and retrieval times and does not provide verified booking inventory. See the [root guide](../../README.md#shared-web-research-october-27-2026) for limits and the [eval results](../../docs/evals/README.md) for known itinerary-quality failures.

`WEB_SEARCH_ENABLED` and `WEB_SEARCH_MODEL` are configurable through Compose environment values, but the current AWS bootstrap does not copy these optional settings from your laptop or SSM. It regenerates the host `.env` with provider credentials, so defaults apply after bootstrap/update. To persist different search settings, extend the bootstrap configuration before deploying; editing the generated host `.env` alone does not survive updates. No additional search service or inbound port is required.

This documentation refresh did not deploy AWS or validate account credits. Cost figures above are planning estimates, not a newly checked quote; confirm account eligibility and current pricing before a billable launch.
