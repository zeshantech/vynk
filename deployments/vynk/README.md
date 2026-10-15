# Deploying Vynk

Flow: push to `vynk-rebrand` -> GitHub Actions builds 6 images -> pushes to `ghcr.io/<owner>/vynk-*` ->
(if enabled) fetches secrets from Infisical -> copies `docker-compose.yml` + `.env` to the server over SSH -> `docker compose up -d`.

Everything runs on one domain: the app at `/`, admin at `/god-mode/`, public boards at `/spaces/`, live editing at `/live/`.

## 1. Server (once)

- Ubuntu 22.04/24.04 VPS, 4 GB RAM / 2 CPU or more. Open ports 22, 80, 443.
- Install Docker + Compose plugin; create a deploy user in the `docker` group; add the deploy SSH public key to its `authorized_keys`.
- DNS: `A vynk.robustcraft.com -> <server IP>`.

## 2. Supabase (database)

- Create a project. Use the **direct** or **session pooler** string (port 5432) with `?sslmode=require`. Not port 6543.
- Put it in Infisical as `DATABASE_URL`.

## 3. AWS S3

- Create a private bucket. Create an IAM user limited to that bucket (`s3:GetObject`, `PutObject`, `DeleteObject`, `ListBucket`).
- **Bucket CORS is required** (the browser uploads directly with a presigned POST):

```json
[
  {
    "AllowedOrigins": ["https://vynk.robustcraft.com"],
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

Secrets: `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (private key).
Variables: `INFISICAL_PROJECT_ID`, optional `INFISICAL_ENV` (default `prod`), optional `INFISICAL_DOMAIN` (default `https://app.infisical.com`; set `https://eu.infisical.com` for EU), and finally `DEPLOY_ENABLED=true`.
Also create an environment named `production` (Settings -> Environments); add a required reviewer if you want manual approval.

Until `DEPLOY_ENABLED=true`, the workflow only builds and pushes images.

## 6. First login

Open `https://vynk.robustcraft.com/god-mode/`, create the admin, then enable Magic link under Authentication and send a test email.

## Staying current with Plane

```
git fetch upstream
git merge upstream/preview   # on vynk-rebrand
```

Then rebuild by pushing.
