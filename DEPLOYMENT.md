# ProjectClad Deployment Guide

This guide walks you through deploying ProjectClad to production.

## Prerequisites

- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) installed
- A hosting provider (Fly.io, Render, Google Cloud Run, or similar)
- A production database (PostgreSQL recommended; SQLite works only for single-instance)

---

## Step 1: Production Database

Your app uses Prisma with SQLite for development. For production, use **PostgreSQL** (recommended for multi-instance or managed hosting).

### Option A: Keep SQLite (single instance only)

If you deploy to a single server with persistent storage, SQLite can work. Set:

```
DATABASE_URL="file:./prisma/production.sqlite"
```

Ensure the `prisma/` directory is writable and persisted.

### Option B: PostgreSQL (recommended)

1. Create a PostgreSQL database (e.g. [Neon](https://neon.tech), [Supabase](https://supabase.com), [Railway](https://railway.app), or your host's managed DB).
2. Set `DATABASE_URL` to your connection string, e.g.:
   ```
   DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
   ```

3. Update `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"  // was "sqlite"
     url      = env("DATABASE_URL")
   }
   ```

4. Run migrations:
   ```bash
   npx prisma migrate deploy
   ```

---

## Step 2: Environment Variables

Set these in your hosting provider's dashboard or via their CLI.

### Required (from Shopify)

| Variable | Description |
|----------|-------------|
| `SHOPIFY_API_KEY` | Your app's API key (from Partners Dashboard) |
| `SHOPIFY_API_SECRET` | Your app's API secret |
| `SCOPES` | Comma-separated scopes, e.g. `read_customers,read_files,read_products,read_themes,write_products` |
| `SHOPIFY_APP_URL` | Your production app URL, e.g. `https://your-app.fly.dev` |

### Required (database)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Prisma connection string (SQLite or PostgreSQL) |

### Optional (email)

| Variable | Description |
|----------|-------------|
| `SMTP_FROM` | From address for emails |
| `SMTP_USER` | SMTP username |
| `SMTP_PASSWORD` | SMTP app password |
| `SMTP_HOST` | e.g. `smtp.gmail.com`, `smtp.office365.com` |
| `SMTP_PORT` | e.g. `587` |
| `SMTP_SECURE` | `false` for 587, `true` for 465 |

### Always set

```
NODE_ENV=production
```

---

## Step 3: Deploy with Shopify CLI

1. Build the app:
   ```bash
   npm run build
   ```

2. Deploy configuration to Shopify (updates URLs, webhooks, etc.):
   ```bash
   shopify app deploy
   ```

3. Follow the prompts to link your app and update URLs. The CLI will:
   - Set your production URL in the Partners Dashboard
   - Update app proxy, auth redirect, and webhook URLs

---

## Step 4: Hosting Options

### Fly.io

1. Install [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/).
2. From your project root:
   ```bash
   fly launch
   ```
3. When prompted, choose a region and do **not** deploy yet.
4. Create a volume for SQLite (if using SQLite):
   ```bash
   fly volumes create prisma_data --size 1
   ```
5. Set secrets:
   ```bash
   fly secrets set SHOPIFY_API_KEY=xxx SHOPIFY_API_SECRET=xxx SCOPES="read_customers,read_files,read_products,read_themes,write_products" SHOPIFY_APP_URL="https://your-app.fly.dev" DATABASE_URL="file:./prisma/production.sqlite"
   ```
6. Update `fly.toml` to mount the volume if using SQLite, then:
   ```bash
   fly deploy
   ```

### Render

1. Connect your GitHub repo at [render.com](https://render.com).
2. Create a **Web Service**, Docker type, using your `Dockerfile`.
3. Add environment variables in the Render dashboard.
4. Set the start command: `npm run docker-start` (or use the Dockerfile default).
5. Deploy. Render will provide a URL like `https://project-clad.onrender.com`.

### Google Cloud Run

Follow the [Shopify deployment guide for Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run).

---

## Step 5: Post-Deploy

1. **Update `shopify.app.toml`**  
   Replace `https://example.com` with your real production URL in:
   - `application_url`
   - `[auth] redirect_urls`
   - `[app_proxy] url`

2. **Re-run deploy** so Shopify gets the correct URLs:
   ```bash
   shopify app deploy
   ```

3. **Install on a test store**  
   Use the install link from your Partners Dashboard to verify auth, app proxy, and core flows.

4. **App proxy**  
   Verify storefront URLs like `https://your-store.myshopify.com/apps/project-clad/projects` load correctly.

---

## Checklist

- [ ] Database created and `DATABASE_URL` set
- [ ] Migrations run: `npx prisma migrate deploy`
- [ ] All required env vars set on the host
- [ ] `NODE_ENV=production` set
- [ ] App built and deployed to your host
- [ ] `shopify app deploy` run to update Shopify config
- [ ] Install and test on a development store
- [ ] SMTP vars set if you use email (CSV, notifications)

---

## Troubleshooting

**"Project not found" / 404s**  
- Confirm the app proxy URL in `shopify.app.toml` matches your production host.
- Ensure requests go through the proxy at `/apps/project-clad/...`.

**Database errors**  
- Check `DATABASE_URL` format and that the DB is reachable.
- Run `npx prisma migrate deploy` and confirm schema is up to date.

**Email not sending**  
- Verify SMTP vars and that you use an app password, not your main email password.
- Check host firewall/outbound rules for port 587/465.
