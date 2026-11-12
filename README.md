# LibraCloud: A Cloud-Native Library Management System on AWS

LibraCloud is a library management system built as microservices and deployed on Amazon Web Services. Members browse the catalogue, borrow and renew books, pay fines and get email reminders. Librarians issue and return books, manage the catalogue (including covers and e-books in S3) and watch the system's health.

## Architecture

```
                         Users (browser, HTTPS)
                                  │
                       ┌──────────▼──────────┐
                       │  Amazon CloudFront  │  HTTPS, edge caching, adds secret origin header
                       └───┬─────────────┬───┘
                 /*, /api/*│             │/covers/*
                           │             ▼
                           │     ┌───────────────┐
                           │     │   Amazon S3   │  covers (public via CloudFront), e-books (pre-signed URLs), datasets
                           │     └───────────────┘
              ┌────────────▼─────────────────────────────────────────────┐
              │ Amazon EC2 (t3.small, Elastic IP, LabInstanceProfile)    │
              │  Docker Compose                                          │
              │   gateway (nginx + React site) ─┬─ auth-service          │
              │                                 ├─ catalog-service ──────┼──► S3
              │                                 ├─ circulation-service   │
              │                                 └─ notification-service ─┼──► Amazon SNS ──► email
              │   auto-deploy agent (cron, every 2 min)                  │
              └────────────┬─────────────────────────────────────────────┘
                           │ TLS, port 5432 (only from EC2's security group)
                  ┌────────▼────────┐
                  │  Amazon RDS     │  PostgreSQL, encrypted, private, daily backups
                  └─────────────────┘

  Amazon EventBridge (00:00 IST nightly) ──► AWS Lambda ──► /api/circulation/internal/overdue-run
  AWS Secrets Manager: DB password, JWT key, internal API key (read at boot, never in code)
  Amazon CloudWatch: container logs, custom metrics (EMF), alarms ──► SNS, dashboard
  AWS CloudFormation: one template creates all of the above
```

### The 10 AWS services

| # | Service | Role in LibraCloud |
|---|---|---|
| 1 | **EC2** | Runs the five Docker containers |
| 2 | **RDS (PostgreSQL)** | Books, members, loans, fines, notifications |
| 3 | **S3** | Cover images, e-book PDFs, dataset files |
| 4 | **CloudFront** | Public HTTPS URL, CDN, protects the origin |
| 5 | **CloudWatch** | Logs, metrics, alarms, dashboard |
| 6 | **SNS** | Member emails and alarm alerts |
| 7 | **Lambda** | Nightly overdue and fine calculation |
| 8 | **EventBridge** | Schedules the Lambda every night |
| 9 | **Secrets Manager** | Database password, JWT key, internal API key |
| 10 | **CloudFormation** | Infrastructure as code: creates everything in one stack |

Also used, outside AWS: GitHub Actions (CI/CD), GitHub Container Registry (Docker images), Docker.

### Microservices

| Service | Responsibilities | Owns tables |
|---|---|---|
| `auth-service` | Sign-up, login (bcrypt + JWT), member and librarian accounts, rate limiting | `users` |
| `catalog-service` | Books, search, genres, copies, covers and e-books (S3), dataset import | `books` |
| `circulation-service` | Issue, return, renew, due dates, fines, payments, statistics, nightly job | `loans`, `fines` |
| `notification-service` | In-app notifications, email through SNS, announcements | `notifications` |
| `gateway` | nginx: serves the React site, routes `/api/<service>/`, security headers, JSON access logs | none |

Each service has `/health` (version, uptime, database status), writes structured JSON logs, publishes CloudWatch metrics through Embedded Metric Format, and shuts down gracefully on redeploy.

## Assignment requirements → where they are

| Requirement | In this project |
|---|---|
| Cloud generation | `infra/libracloud.yaml`: CloudFormation creates all 35 resources in one stack (IaaS: EC2, VPC security groups; PaaS: RDS, Lambda, managed services) |
| Cloud service usage | 10 AWS services, table above |
| Hosted online, attached to the cloud | CloudFront HTTPS URL → EC2 → RDS / S3 / SNS |
| Backend / cloud ecosystem | 4 microservices + gateway, Lambda, EventBridge, SNS, Secrets Manager |
| CI/CD pipeline design | `.github/workflows/ci-cd.yml` + `scripts/auto-deploy.sh` |
| Monitor the service | CloudWatch dashboard (12 widgets), 8 alarms, `/health` endpoints, System status page |
| Dataset | Kaggle goodbooks-10k / Goodreads importer + generated circulation history (`data/README.md`) |
| Monitoring analysis | `scripts/loadgen.mjs` (CSV results) + CloudWatch metrics: latency p95, requests, errors, CPU, memory, RDS, business metrics |
| What changes when services change | `docs/CHANGE-DEMO.md`: one-service rolling deploy, visible in logs, metrics and the status page |
| Cloud security | Secrets Manager, private encrypted RDS (TLS verified), security groups, CloudFront-only origin, IMDSv2, bcrypt + JWT, rate limiting, roles, S3 block public access + pre-signed URLs, security headers, non-root containers, npm audit in CI |
| Costing | Resource sizes in the template; tags `Project=LibraCloud` for Cost Explorer |
| SLA | Backed by alarms (latency p95 < 1 s, 5xx), RDS daily backups (RPO 24 h, or 5 min with point-in-time restore) |

## Run it locally

You need Docker Desktop.

```bash
docker compose up --build
```

Open http://localhost:8080 and log in as the librarian with `admin@libracloud.local` / `Admin@12345`, or create a member account.

Optional demo data:

```bash
docker compose exec circulation node scripts/seed-history.js --members 40 --days 60
node scripts/smoke-test.mjs                    # 20 end-to-end checks
node scripts/loadgen.mjs --users 10 --duration 60
```

## Deploy to AWS

Follow **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. In short: push to a public GitHub repo, which builds the images, then create the CloudFormation stack from `infra/libracloud.yaml` in Learner Lab. About 20 minutes.

## CI/CD

`.github/workflows/ci-cd.yml` runs on every push:

1. **detect-changes:** finds which services changed
2. **unit-tests**, **frontend-build**, **security-scan** (npm audit), all in parallel
3. **integration:** starts the whole system with Docker Compose and runs the 20-step smoke test
4. **build-and-push** (main branch only): builds and pushes images **only for the changed services**, tagged `latest` and `sha-<commit>`

The EC2 auto-deploy agent pulls new images every 2 minutes and recreates only the changed containers. See **[docs/CHANGE-DEMO.md](docs/CHANGE-DEMO.md)** for how to demonstrate this.

## Project structure

```
.github/workflows/ci-cd.yml   CI/CD pipeline
infra/libracloud.yaml         CloudFormation template (all AWS resources)
services/
  shared/                     common code: HTTP setup, JWT, logging + metrics, DB pool
  auth/ catalog/ circulation/ notification/
  Dockerfile                  one Dockerfile for all four services
gateway/                      nginx config + Dockerfile (also builds the React site)
frontend/                     React website (Vite)
scripts/
  ec2-setup.sh                EC2 bootstrap (run by CloudFormation)
  auto-deploy.sh              deploy agent on EC2
  smoke-test.mjs              end-to-end test (CI and after deploy)
  loadgen.mjs                 load generator for monitoring analysis
data/README.md                datasets (Kaggle import)
docker-compose.yml            local development
docker-compose.prod.yml       production on EC2
```

## Library rules (configurable by environment variable)

| Rule | Default | Variable |
|---|---|---|
| Loan period | 14 days | `LOAN_DAYS` |
| Late fee | ₹5 per day (capped at ₹500 per loan) | `FINE_PER_DAY`, `MAX_FINE_PER_LOAN` |
| Books at a time | 3 | `MAX_ACTIVE_LOANS` |
| Borrowing blocked above | ₹100 unpaid fines | `MAX_UNPAID_FINES` |
| Renewals | 1 per loan | `MAX_RENEWALS` |
