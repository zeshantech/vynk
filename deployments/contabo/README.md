# Deploying Vynk to Contabo

Flow: push to `main` -> **Vynk Build & Deploy** builds the images and pushes them to `ghcr.io/<owner>/vynk-*`
-> **Deploy to Contabo** (`.github/workflows/contabo-deploy.yml`) pulls secrets from Infisical, validates them,
copies `docker-compose.yml` + `.env` to the VPS over SSH and runs `docker compose up -d`, then waits for
`https://<APP_DOMAIN>/api/instances/` to return 200.

The stack is self-contained on one VPS: Caddy (automatic HTTPS), web/admin/space/live/api/workers, Postgres,
Valkey, RabbitMQ. File uploads go to **AWS S3** (no MinIO). Only ports 80/443 are published.

## 1. Server (once)

DNS first: create `A <APP_DOMAIN> -> <Contabo IPv4>`. Caddy cannot get a certificate until this resolves.

Create an SSH key pair for GitHub Actions (on your machine, **no passphrase**):

```bash
ssh-keygen -t ed25519 -f vynk-contabo-deploy -C "github-actions@vynk" -N ""
```

Log in once as root and run the bootstrap script (installs Docker, creates a key-only `deploy` user, opens 22/80/443, adds swap):

```bash
scp deployments/vynk/bootstrap-server.sh root@<SERVER_IP>:/root/
ssh root@<SERVER_IP> "DEPLOY_PUBKEY='$(cat vynk-contabo-deploy.pub)' bash /root/bootstrap-server.sh"
```

Test `ssh -i vynk-contabo-deploy deploy@<SERVER_IP>` in a second terminal **before** answering `y` to the
"disable password + root login" prompt. After that the root password is no longer used by anything.

Get the host key to pin in GitHub (step 4):

```bash
ssh-keyscan -t ed25519 <SERVER_IP>
```

## 2. AWS S3

- Create a **private** bucket (keep "Block public access" on). Create an IAM user limited to that bucket
  (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`) and an access key for it.
- Bucket CORS is required (the browser uploads directly with a presigned POST):

```json
[
  {
    "AllowedOrigins": ["https://<APP_DOMAIN>"],
    "AllowedMethods": ["GET", "POST", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Do **not** set `AWS_S3_ENDPOINT_URL` (MinIO only). The workflow refuses to deploy if it is set.

## 3. Infisical

- Project, environment `prod`, and add every key from [`secrets.example`](./secrets.example).
  Use `openssl rand -hex 32` for all passwords/secrets (they are embedded in URLs, so hex only).
- Already have another deployment's secrets in the same project/env (e.g. the Supabase one)? Put the Contabo
  ones in a folder such as `/contabo` and set the variable `INFISICAL_SECRET_PATH=/contabo` below.
- Create a **Machine Identity** with Universal Auth and read access to that project/env/path.

## 4. GitHub

Create an environment named **`contabo`** (Settings -> Environments). Add a required reviewer if you want
manual approval before each deploy. Put these on that environment:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `DEPLOY_HOST` | server IP or hostname |
| Secret | `DEPLOY_USER` | `deploy` (default if omitted) |
| Secret | `DEPLOY_SSH_KEY` | contents of `vynk-contabo-deploy` (the **private** key) |
| Secret | `DEPLOY_KNOWN_HOSTS` | output of the `ssh-keyscan` above (pins the server; strongly recommended) |
| Secret | `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` | Machine Identity credentials |
| Variable | `INFISICAL_PROJECT_ID` | Infisical project ID |
| Variable | `INFISICAL_ENV` | optional, default `prod` |
| Variable | `INFISICAL_SECRET_PATH` | optional, default `/` |
| Variable | `INFISICAL_DOMAIN` | optional, default `https://app.infisical.com` (`https://eu.infisical.com` for EU) |

Finally set the **repository** variable `CONTABO_DEPLOY_ENABLED=true`. Until then the workflow is skipped.

> If the old deployment (`vynk-deploy.yml`'s own `deploy` job) is still enabled via `DEPLOY_ENABLED=true`,
> every push also deploys there. Unset `DEPLOY_ENABLED` once you have moved over.

## 5. First deploy and login

Run **Actions -> Deploy to Contabo -> Run workflow** (blank tag = `latest`), or push to `main`.
The first run takes a few minutes (image pulls, DB migrations, certificate issuance).
Then open `https://<APP_DOMAIN>/god-mode/`, create the admin, enable Magic link under Authentication and send a test email.

## Operations

- **Roll back:** Actions -> Deploy to Contabo -> Run workflow -> `image_tag` = an older 12-char commit SHA
  (the tags are visible under the repo's Packages). Note this does not undo database migrations.
- **Logs:** `ssh deploy@<ip> "cd ~/vynk && docker compose logs -f --tail 100 api"`
- **Status:** `ssh deploy@<ip> "cd ~/vynk && docker compose ps"`
- **Secrets rotation:** change it in Infisical and re-run the workflow (the `.env` on the server is rewritten each deploy).
  Rotating `POSTGRES_PASSWORD` needs a manual `ALTER USER` first, because the DB keeps the password it was first created with.

## Not included (do these before relying on it)

- **Database backups.** Postgres data lives in the `pgdata` Docker volume on this one server. Schedule `pg_dump`
  to S3 (or enable Contabo snapshots) so a dead disk is not a lost workspace.
- Off-box monitoring/uptime alerts.
