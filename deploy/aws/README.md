# AWS preparation — not deployed

Region requested: **us-east-1**. Budget requested: **close to zero**. The user explicitly requested preparation **without paid resources** while account credit eligibility is unknown. No AWS API credentials are configured and no AWS resource was created.

The email supplied in chat is not an IAM credential and is intentionally not embedded in infrastructure or the repository.

## What is ready locally

The root Dockerfile builds four production backend images and a standalone Next.js image. `compose.yaml` runs those behind an authenticated gateway with PostgreSQL and a persistent volume. The application supports database-backed history, cross-process turn locks, and a shared event log. This is a small private pilot foundation, not a high-availability production service.

## Before creating anything

1. Sign into the intended AWS account yourself. Prefer an IAM Identity Center/SSO profile with limited deployment permissions; do not paste root/access keys into chat.
2. Check Free Tier plan, remaining credits, expiration and current billed usage. AWS free eligibility depends on the account. Do not assume EC2, IPv4, storage or managed databases are free.
3. Choose a real monthly limit and configure billing alerts. Alerts are not a hard spending cap. Model/STT costs are billed separately by their providers.
4. Confirm a deployment budget and review a CloudFormation change set before executing it. Nothing in this repository auto-deploys to AWS.

AWS's [Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/) and [plan documentation](https://docs.aws.amazon.com/us_en/awsaccountbilling/latest/aboutv2/free-tier-plans.html) explain current eligibility. Recheck the account console at deployment time.

## Reviewed starting point

`host.cloudformation.yaml` is a **host-only template**, deliberately not executed. It creates one encrypted Amazon Linux EC2 host with IMDSv2, an SSM management role, no inbound ports, and outbound connectivity. It requires an existing VPC/subnet. The public IPv4 address enables outbound access without a NAT gateway, but can itself incur charges. The 30 GiB root volume is retained on termination to avoid silently losing the local database; retained storage continues to incur charges until explicitly removed after backup.

The template installs Docker, not the application, provider credentials, Compose plugin, a public gateway, or TLS. It is a scaffold for a reviewed private pilot. Do not treat successful template creation as a deployed Roam app. Template validation is local syntax validation only unless an AWS change set has been created.

When access and budget are approved: build Linux **amd64** images (the template uses x86 instances), transfer versioned images from a registry, install a pinned Compose plugin from Docker's official source, provision secrets outside Git, run the schema migration/startup, and verify all service probes. Use SSM port forwarding for the first private test; no inbound SSH or app ports are needed. Configure snapshots/backups and perform a restore test before storing anything important.

## Public browser testing without buying a domain

CloudFront supplies an HTTPS `*.cloudfront.net` address and supports WebSockets. That can become the public entry point once an origin design and budget are approved. See [default HTTPS certificate](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html) and [WebSocket guidance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-working-with.websockets.html).

A public deployment must disable caching of authenticated HTML, API calls and WebSocket routes; forward the required Authorization, Origin and WebSocket headers; set `WEB_ORIGIN` to the exact public origin; restrict origin access; and establish the origin connection's security deliberately. The current template does **not** create a CloudFront distribution or solve public TLS/origin routing. Do not expose Basic authentication over plain public HTTP.

## Scaling path and limits

The database-backed turn guard and event log allow separate orchestrator instances to coordinate. Four model turns are admitted globally per database. Each WebSocket polls the shared event table every 500 ms; this adds database traffic and is intended for a small pilot. It is not a proven high-volume pub/sub system.

A single-host Compose deployment still has one failure domain and one PostgreSQL instance. For paid production, move PostgreSQL to a backed-up managed service, use a proper identity provider, move event delivery to an appropriate shared streaming/pub/sub system if measurements require it, and run app replicas through ECS/load balancing with graceful draining and load tests. Redis, EKS and an always-on ALB are not provisioned merely to claim scalability.

Agency operations remain seeded demo data; mutation endpoints are disabled in the container setup. No real booking/financial system has been added. Application API keys are server-side only.
