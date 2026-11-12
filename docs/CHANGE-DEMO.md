# Demonstrating "what changes in the cloud when a service changes"

This walkthrough shows that changing one microservice redeploys only that service, and how each step can be seen in GitHub and AWS. It takes about 10 minutes. Take a screenshot at each step marked 📸.

## Before you start

- The stack is running and the website works.
- Open these tabs side by side:
  - LibraCloud → **System status** (librarian menu)
  - CloudWatch **dashboard** (stack output `DashboardURL`)
  - GitHub → **Actions**

📸 **System status, before.** Note the version (`sha-xxxxxxx`) and uptime of each of the 4 services.

## 1. Make a change to one service only

Change a library rule in the circulation service, for example the late fee from ₹5 to ₹10. In `services/circulation/src/rules.js`:

```js
finePerDay: Number(process.env.FINE_PER_DAY || 10), // was 5
```

Commit and push:

```bash
git commit -am "circulation: increase late fee to ₹10/day"
git push
```

## 2. CI/CD builds only the changed service

In GitHub Actions, open the new run.

- 📸 **detect-changes** summary: `Services changed in this commit → ["circulation"]`
- Tests and the integration test run for the whole system, so a change can't break other services.
- 📸 **build-and-push** runs **one** job, `circulation`, and pushes `ghcr.io/<you>/libracloud-circulation:sha-<new>`. No other image is rebuilt.

## 3. EC2 deploys only that container

Within about 2 minutes of the pipeline finishing, the auto-deploy agent on EC2 pulls the images. Only the circulation image has a new digest, so Docker Compose recreates only that container.

- 📸 CloudWatch Logs → log group `/libracloud/deploy`, or Session Manager → `sudo tail /var/log/libracloud-deploy.log`:
  ```
  2026-11-20T10:42:03+00:00 DEPLOYED circulation: sha-1a2b3c4 -> sha-5d6e7f8
  2026-11-20T10:42:03+00:00 SUMMARY 1 service(s) updated, 4 unchanged and not restarted
  ```
- 📸 **System status, after:** the circulation card shows the **new version** and its **uptime reset to seconds**. auth, catalog and notification keep their old version and long uptime, so they were never restarted.
- 📸 CloudWatch dashboard → **Deployment history** table: one new `service_started` row for `circulation-service` with the new version. The **Deployments** bar chart shows one container start.
- The website keeps working throughout. At most, circulation requests (borrow and return) pause for a few seconds while the new container starts. Browsing the catalogue is not affected at all.
- Book details now show "late fee ₹10/day" (read from the new service's `/rules`).

## 4. Rolling back

Every image is also tagged with its commit (`sha-…`), so rolling back is a single revert:

```bash
git revert HEAD && git push
```

The pipeline rebuilds circulation from the previous code and the agent deploys it the same way. Alternatively, pin a version on EC2 by setting `TAG=sha-1a2b3c4` in `/opt/libracloud/.env` and running `sudo docker compose up -d`.

## What type of change happened? (for the report)

| Layer | Changed? | Evidence |
|---|---|---|
| Source code | `services/circulation/` only | Git commit diff |
| Build artifact | 1 new container image in GHCR; the other 4 unchanged | GitHub Actions summary, GHCR versions |
| Running compute | 1 container replaced on EC2; instance not restarted; other containers untouched | deploy log, System status uptime |
| Infrastructure (EC2, RDS, S3, CloudFront, IAM) | **No change** | CloudFormation stack has no update; CloudFront and RDS untouched |
| Database schema / data | No change; existing loans and fines preserved | `CREATE TABLE IF NOT EXISTS` migrations are additive |
| Configuration / secrets | No change | Secrets Manager versions unchanged |
| Monitoring | New version visible in logs and metrics; `ServiceStarts` +1 | CloudWatch dashboard |

This is an **application-level, immutable, rolling deployment of a single microservice**. The old container is not modified; it is replaced by a new one built from a versioned image.

### Compare: an infrastructure change

For contrast, change something in `infra/libracloud.yaml`, such as `InstanceType` from t3.small to t3.medium, and update the stack (CloudFormation → Update → replace template). First open the **change set**. CloudFormation lists exactly which resources will be modified, and whether each change is an in-place update or a **replacement**. For an instance-type change, EC2 is stopped and started (a few minutes of downtime) but keeps its Elastic IP, so CloudFront keeps working. 📸 the change set.

| Change type | Example | Tool | Downtime | Scope |
|---|---|---|---|---|
| Application (one service) | Late fee rule | CI/CD + auto-deploy | Seconds, one service | 1 container |
| Configuration | Edit `.env`, for example `FINE_PER_DAY=10` | `docker compose up -d` | Seconds | Services that use it |
| Infrastructure, in place | Add an alarm, change log retention | CloudFormation update | None | 1 resource |
| Infrastructure, with interruption | EC2 instance type | CloudFormation update | Minutes | EC2 |
| Infrastructure, replacement | Change the RDS engine or DB name | CloudFormation (new resource) | Long, data migration | RDS |
