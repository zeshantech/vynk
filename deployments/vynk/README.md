# Deploying Vynk

Flow: push to `main` -> GitHub Actions builds 6 images -> pushes to `ghcr.io/<owner>/vynk-*` ->
(if enabled) fetches secrets from Infisical -> copies `docker-compose.yml` + `.env` to the server over SSH -> `docker compose up -d`.

Everything runs on one domain, routed by the server's existing Caddy (see Caddyfile.snippet): the app at `/`, admin at `/god-mode/`, public boards at `/spaces/`, live editing at `/live/`. Redis is the server's existing one (DB 5).

## 1. Server (once)

- This is the server that already runs Caddy and Redis on the Docker network `shared_net` (it also hosts OpenProject). Check: `docker network ls | grep shared_net` and `docker ps | grep -E "caddy|redis"`.
- Add the contents of `Caddyfile.snippet` to that Caddy's Caddyfile and reload it.
- **Do not run `bootstrap-server.sh` on this server**: it enables `ufw` with only 22/80/443 open and changes SSH login, which can break what is already running. Use an existing SSH user in the `docker` group (`root` works) and add the deploy SSH public key to its `authorized_keys`.
- If Redis has a password, set `REDIS_URL` in Infisical, e.g. `redis://:PASSWORD@redis:6379/5`.
- DNS: `A vynk.robustcraft.dpdns.org -> <server IP>`.

## 2. Neon (database)

- Vynk uses the existing Neon `neondb` database, in its own `plane` schema (OpenProject stays in `public`). Create it once if needed: `CREATE SCHEMA IF NOT EXISTS plane;`
- Use Neon's **direct** connection string (host **without** `-pooler`) and append the schema option, then put it in Infisical as `DATABASE_URL`:

```
postgresql://<user>:<password>@<ep-xxxx>.<region>.aws.neon.tech/neondb?sslmode=require&options=-c%20search_path%3Dplane
```

- Neon's pooled endpoint rejects the `search_path` option, so it cannot be used here.

## 3. AWS S3

- Create a private bucket. Create an IAM user limited to that bucket (`s3:GetObject`, `PutObject`, `DeleteObject`, `ListBucket`).
- **Bucket CORS is required** (the browser uploads directly with a presigned POST):

```json
[
  {
    "AllowedOrigins": ["https://vynk.robustcraft.dpdns.org"],
    "AllowedMethods": ["GET", "POST", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## 4. Infisical

- Create a project, environment `prod`, and add every key from `secrets.example`.
- Create a **Machine Identity** with Universal Auth and read access to that project/env.

## 5. GitHub (repo Settings -> Secrets and variables -> Actions)

Secrets: `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `DEPLOY_HOST` (the server IP), `DEPLOY_USER` (e.g. `root`), `DEPLOY_SSH_KEY` (private key). A server password also works via `DEPLOY_SSH_PASSWORD`, but a key is safer.
Variables: `INFISICAL_PROJECT_ID`, optional `INFISICAL_ENV` (default `prod`), optional `INFISICAL_DOMAIN` (default `https://app.infisical.com`; set `https://eu.infisical.com` for EU), and finally `DEPLOY_ENABLED=true`.
Also create an environment named `production` (Settings -> Environments); add a required reviewer if you want manual approval.

Until `DEPLOY_ENABLED=true`, the workflow only builds and pushes images.

## 6. First login

Open `https://vynk.robustcraft.dpdns.org/god-mode/`, create the admin, then enable Magic link under Authentication and send a test email.

## Staying current with Plane

```
git fetch upstream
git merge upstream/preview   # on vynk-rebrand
```

Then rebuild by pushing.
