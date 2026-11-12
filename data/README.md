# Datasets

LibraCloud ships with **66 classic books** (`services/catalog/data/sample-books.csv`) that load automatically the first time the catalog service starts.

For the assignment's dataset requirement, import a real public dataset from Kaggle.

| Dataset | Kaggle | Rows | Notes |
|---|---|---|---|
| **goodbooks-10k** (recommended) | `zygmunt/goodbooks-10k` → `books.csv` | 10,000 | Includes cover image URLs, ratings and publication years |
| Goodreads books | `jealousleopard/goodreadsbooks` → `books.csv` | ~11,000 | Includes pages and publisher; covers are fetched from Open Library by ISBN |

The importer detects the format from the CSV header. Number of copies is derived from popularity (1–6 copies, more for books with more ratings). Rows whose ISBN already exists are skipped, so it is safe to run twice.

## Import locally

```bash
# put books.csv in this folder (data/), then:
docker compose exec catalog node scripts/import-books.js /data/books.csv
```

## Import on AWS

1. Upload the file to the S3 bucket created by CloudFormation (output `AssetsBucketName`) under `datasets/books.csv` (S3 console → Upload).
2. Connect to the EC2 instance (EC2 console → Connect → Session Manager) and run:

```bash
cd /opt/libracloud
sudo docker compose exec catalog node scripts/import-books.js s3://<AssetsBucketName>/datasets/books.csv
```

Options: `--limit 2000` imports only the first 2,000 rows; `--no-remote-covers` skips external cover URLs.

## Generated activity data

To populate loans, returns, fines and members for the dashboard and the monitoring analysis:

```bash
docker compose exec circulation node scripts/seed-history.js --members 40 --days 60          # local
sudo docker compose exec circulation node scripts/seed-history.js --members 40 --days 60     # EC2
```

It creates 40 demo members (password `Member@12345`) and 60 days of realistic history: about 70% of books returned on time, 18% returned late with fines (some paid), and the rest still on loan, some of them overdue. It uses a fixed random seed, so the dataset is reproducible.
