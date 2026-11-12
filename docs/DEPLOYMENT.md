# Deploying LibraCloud on AWS Academy Learner Lab

Total time: about 40 minutes, of which roughly 20 minutes is waiting for AWS.

> **Budget rule:** EC2 stops automatically when a lab session ends, but **RDS does not**. When you finish working, stop the RDS database (RDS console → Databases → select → Actions → Stop temporarily). If you exceed the lab budget, the account and everything in it is deleted.

---

## Part A: GitHub (builds the Docker images)

1. **Create a public repository** on GitHub named `libracloud`. It must be public because the EC2 server downloads its setup script from it.
2. **Push the code:**
   ```bash
   cd libracloud
   git init && git add . && git commit -m "LibraCloud initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/libracloud.git
   git push -u origin main
   ```
3. Open the **Actions** tab and wait for the **CI/CD** run to finish (about 5–8 minutes). On the first push every service counts as changed, so five images are built.
4. **Make the images public.** On your GitHub profile, open **Packages**. For each of `libracloud-auth`, `-catalog`, `-circulation`, `-notification` and `-gateway`: Package settings → Danger zone → **Change visibility → Public**.
   Check: `docker pull ghcr.io/<your-username>/libracloud-gateway:latest` works without logging in.

## Part B: AWS (creates the cloud environment)

5. **Start the lab** (Start Lab, wait for the green dot) and open the AWS console. Check that the region is **N. Virginia (us-east-1)**.
6. **Find two subnets.** VPC console → **Subnets**. Note the Subnet IDs in **us-east-1a** and **us-east-1b**. Avoid us-east-1e, which does not offer t3 instances.
7. **Create the stack:** CloudFormation → Create stack → *With new resources* → **Upload a template file** → `infra/libracloud.yaml`.

   | Parameter | Value |
   |---|---|
   | Stack name | `libracloud` (lower case) |
   | GitHubRepo | `<your-username>/libracloud` |
   | ImagePrefix | `ghcr.io/<your-username>` (lower case) |
   | AdminEmail | `admin@libracloud.local`, or your own |
   | AdminPassword | a strong password (letters and numbers, no spaces, quotes or `$`) |
   | AlertEmail | your real email address |
   | VpcId | the default VPC |
   | SubnetIds | the **two** subnets from step 6 (us-east-1a and us-east-1b) |
   | Others | keep the defaults (t3.small, db.t3.micro, PostgreSQL 17.6) |

   On the last page, tick the acknowledgement if asked, then **Submit**.
8. **Wait about 15–20 minutes** for `CREATE_COMPLETE`. RDS is the slow part (about 10 minutes). Meanwhile you'll receive **two emails from AWS SNS**; click **Confirm subscription** in both. One is for alarms, the other for library notifications.
9. Open the stack's **Outputs** tab and click **WebsiteURL** (`https://xxxx.execute-api.us-east-1.amazonaws.com`). Log in with AdminEmail and AdminPassword.

> If the site shows an error right after the stack completes, wait 2–3 minutes. The EC2 server is still pulling images on first boot. To watch progress: EC2 → instance `libracloud-web` → Connect → **Session Manager** → `sudo tail -f /var/log/libracloud-setup.log`.

## Part C: Data, testing, monitoring

10. **Import the Kaggle dataset.** See `data/README.md`. Upload `books.csv` to the S3 bucket (`AssetsBucketName` output) as `datasets/books.csv`, then in Session Manager:
    ```bash
    cd /opt/libracloud
    sudo docker compose exec catalog node scripts/import-books.js s3://<AssetsBucketName>/datasets/books.csv
    ```
11. **Generate library history** (members, loans, fines):
    ```bash
    sudo docker compose exec circulation node scripts/seed-history.js --members 40 --days 60
    ```
    Copy the `--members …` line it prints; you'll need it in step 14.
12. **Run the smoke test** from your laptop. It needs Node.js 18 or newer.
    ```bash
    BASE_URL=https://xxxx.execute-api.us-east-1.amazonaws.com ADMIN_EMAIL=<AdminEmail> ADMIN_PASSWORD=<AdminPassword> node scripts/smoke-test.mjs
    ```
13. **Test the nightly Lambda.** Lambda console → `libracloud-overdue-job` → **Test**, using any test event. The result shows overdue loans and fines updated. Check your inbox for the SNS emails.
14. **Load test** while watching the dashboard (`DashboardURL` output):
    ```bash
    node scripts/loadgen.mjs --url https://xxxx.execute-api.us-east-1.amazonaws.com --users 25 --duration 600 --members <emails from step 11>
    ```
    The results CSVs are saved in `loadtest-results/` for your monitoring analysis.
15. **Demonstrate a service change.** See [CHANGE-DEMO.md](CHANGE-DEMO.md).

## Every lab session

| When | Do this |
|---|---|
| Start of session | Start Lab, then **start the RDS database** (RDS → Actions → Start; about 5 minutes). EC2 starts automatically and its containers restart by themselves. |
| End of session | **Stop RDS.** EC2 is stopped by the lab, but you can stop it yourself to save budget. |
| Finished with the project | CloudFormation → delete the stack. First empty the S3 bucket. A final RDS snapshot is kept; delete it under RDS → Snapshots. |

## Troubleshooting

| Problem | Fix |
|---|---|
| Stack fails at `Database` with an engine version error | Recreate the stack and set `DBEngineVersion` to a version listed in RDS → Create database → Engine version |
| Site shows 403 | You are opening the EC2 IP directly. Use the WebsiteURL (API Gateway). |
| Site shows 502, 503 or 504 / "Service Unavailable" | Containers are still starting, or RDS is stopped. Start RDS and wait 5 minutes. |
| `image pull failed` in the setup log | The GHCR packages are still private (step 4), or the pipeline has not finished |
| No emails | Confirm both SNS subscriptions (check spam) |
| Login says "Too many attempts" | The rate limit is 10 attempts per 15 minutes per IP. Wait, or try from another network. |

Useful commands in Session Manager:
```bash
cd /opt/libracloud
sudo docker compose ps                     # container status
sudo docker compose logs -f catalog        # one service's logs (also in CloudWatch)
sudo tail -f /var/log/libracloud-deploy.log
sudo /usr/local/bin/libracloud-setup       # re-run setup (for example after rotating a secret)
```
