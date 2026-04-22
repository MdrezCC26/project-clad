# Project Clad

Project Clad is a **Shopify embedded app** plus **storefront integrations** for shops that sell **custom sheet-metal style parts** (L, Z, U shapes with dimensions and gauge). It ties the cart and catalog to **per-shop projects and orders (“jobs”)**, supports an **approval workflow**, **work-order tracking**, **delivery vs pickup**, **fulfillment photos**, and **transactional email** over SMTP.

---

## What the app does

### Merchant experience (Shopify Admin, embedded)

Signed-in staff use the embedded app (`/app/*`) to:

- **Home** — Entry point with quick link to the Z-Bars addon page.
- **Z-Bars addon** — Simple featured page (demo / marketing surface).
- **Work orders** — List all jobs across projects with Shopify variant context; update **work order status** (`unread` → `in_progress` → `complete`), with guards after payment. Can sync **live variant prices** from Shopify for display.
- **Gauge catalog** — Configure **per-gauge master pricing** and material thickness (`GaugeConfig`). **Record baselines** and **push proportional price updates** to Shopify variants tagged with the app’s gauge metafield (`GaugeConfig` drives `value × girth × length` style pricing in the storefront APIs).
- **Settings** — Shop-level configuration, including:
  - **App admins** (customer IDs) and **global staff emails** for elevated storefront access.
  - **Storefront branding** (logo, background logo) from theme media.
  - **Custom nav** for app-proxy pages (labels/URLs or JSON nav config).
  - **Pricing password** (hashed) used to unlock price display on storefront project views.
  - **Email notification preferences** (per-kind toggles; defaults enable all).
  - **SMTP test send** and visibility into whether email is configured.
  - **Session reset**, **project/member** management helpers, **CSV export** of project data.
- **Additional page** — Template-style extra admin page from the app shell.
- **Export** — `GET /app/export-projects?projectId=…` downloads a **CSV** for a single project (`exportProjectsCsv`).

### Customer & staff experience (App proxy, storefront)

The app is exposed on the storefront under **`/apps/project-clad/*`** (see `shopify.app.toml` `[app_proxy]`). Logged-in customers interact with **HTML pages** and **JSON APIs** validated with Shopify’s app-proxy signature (with dev-only bypasses where implemented).

**Pages**

- **`/apps/project-clad/projects`** — Project list: search, approvals state, jobs, line items with product imagery, cart integration, **NA** customer tag handling (can hide add-to-cart for tagged customers unless staff), activity-oriented UX.
- **`/apps/project-clad/projects/:projectId`** — Alternate project UI with **pricing gate** (cookie after password unlock).
- **`/apps/project-clad/project`** — Primary **project detail** experience: jobs, line items, **order lifecycle** (draft → pending review → ready to order → ordered → delivered → paid), **delivery address** and **receive mode** (delivery vs pickup), **Ottawa-area scheduling** fields, **comments** and **activity timeline**, **member management**, **share links**, **approval** submit/cancel/approve, **reorder** jobs/items, **edit lines**, **confirm order** (creates/links Shopify flow), **staff** fulfillment photo upload, **mark paid** / **set lifecycle** for privileged users.
- **`/apps/project-clad/work-orders`** — Informs storefront visitors that **work orders are managed in Admin** (staff); still themed with shop nav.
- **`/apps/project-clad/share/:token`** — **Share-token** access to a project for collaborators with **view** or **edit** role.
- **Fulfillment photo** routes — Signed access to uploaded **package / fulfillment** images where applicable.

**JSON / action APIs** (representative)

- **`/apps/project-clad/api/projects`** — List projects visible to the current customer (owner, member, or app admin / global staff).
- **`/apps/project-clad/api/project-actions`** — Query-string and JSON-driven actions: e.g. **unlock pricing**, **create/delete job**, **delete item**, **share project**, **add/remove member**, **submit/cancel approval**, **approve** (with email hooks respecting **email notification prefs**).
- **`/apps/project-clad/api/save-job`** — **Save cart lines into a project**: new project, existing project, or existing job; merges quantities; captures **variant snapshots** and **immutable order-line audit** JSON; can send **order-created** notification email; **enqueues `DrawingJob`** rows for configured custom-part lines for downstream CAD.
- **`/apps/project-clad/api/price`** — **Live price quote** from `GaugeConfig` for L/Z/U given dimensions and gauge (used by theme custom-part UI).
- **`/apps/project-clad/api/draft-order`** — Builds **draft orders** in Shopify from custom-part payloads (uses offline session + Admin API).
- **`/apps/project-clad/api/work-orders`** — **Staff-only** JSON API to mirror admin work-order updates from the storefront when the viewer has admin/staff privileges.
- **`/apps/project-clad/api/members`**, **`api/drawing-jobs`**, and parallel **`/api/*`** routes — Same handlers where duplicated for URL layout.

**Drawing jobs**

- Saving jobs with the right line properties creates **`DrawingJob`** records (shape, lengths, angle, gauge, status).
- **`/apps/project-clad/api/drawing-jobs`** (GET/PATCH) is intended for a **background worker** authenticated with **`DRAWING_WORKER_API_KEY`** (Bearer); returns pending jobs and thickness from `GaugeConfig` for Inventor-style output. Workers mark jobs **processing / completed / failed** and optional **part numbers**.

### Theme app extension (`extensions/project-clad-theme`)

- **`cart-actions` block** — Cart UI wired to **login**, **list projects**, **save cart to project/job** (`save-job` API), checkout **delivery vs pickup** modal for custom parts, and related flows (see Liquid `data-projectclad-*` attributes).
- **`custom-part-form` block** — **Configure Custom L** (and tags for Z/U on products): dimension inputs, live **price** fetches from **`/apps/project-clad/api/price`**, add to cart with **line item properties** (`shape_type`, `gauge`, `L1`, `L2`, etc.) consumed by the cart transform and backend.

### Shopify Function: Cart Transform (`extensions/projectclad-cart-transform`)

A **Rust → WASM** **cart transform** adjusts **cart line prices** for **L-shaped** custom parts using **line item properties** (gauge, L1, L2): fixed price per unit from **embedded gauge rate table** in the function (separate from DB `GaugeConfig`; merchants should align strategy between Function and app DB).

### Webhooks (`shopify.app.toml`)

- **`app/uninstalled`**, **`app/scopes_update`** — Standard app lifecycle.
- **`orders/paid`** — When a paid order matches a stored **`JobOrderLink`**, the app records **payment**, builds a **receipt snapshot** from line items, updates lifecycle/activity, and keeps idempotency if already paid.

### Email & notifications

Uses **nodemailer** and `SMTP_*` environment variables (`sendEmail`, `isEmailConfigured`). Notable flows:

- **Order / project status** — `orderCreatedEmail.server.ts` (`sendOrderCreatedNotificationEmail`, `sendProjectStatusNotificationEmail`).
- **Fulfillment / package** — `fulfillmentNotify.server.ts` after delivery-type notifications (photos, finance copy); respects prefs and idempotency (`fulfillmentNotifiedAt`).
- **Transactional recipients** — `transactionalEmail.server.ts` and shop prefs; optional env overrides in `.env.example` (`PROJECTCLAD_*_EMAIL`).

Per-kind toggles live in **`ShopSettings.emailNotificationPrefsJson`** (see `emailNotificationPrefs.server.ts`). **Project status / activity** emails default to **off**; enable them in the app’s **Automated email notifications** settings.

---

## Data model (Prisma / PostgreSQL)

The app uses **PostgreSQL** (`DATABASE_URL`). Core entities include:

- **`Session`** — Shopify OAuth sessions.
- **`Project`**, **`Job`**, **`JobItem`** — Customer projects, named orders/jobs, and line items with **price snapshots**, **custom JSON**, **variant snapshots**, and **order line capture**.
- **`ProjectMember`**, **`ProjectShareToken`** — Collaboration and magic-link style sharing.
- **`ApprovalRequest`** — Project- and job-level approvals.
- **`ProjectActivityEvent`**, **`ProjectComment`** — Timeline and threaded-style comments (with soft delete metadata on comments).
- **`JobOrderLink`** — Links a job to a Shopify **order id** for webhooks and UI.
- **`DrawingJob`** — Async CAD/drawing pipeline per line item.
- **`GaugeConfig`** — Per-shop gauge: **pricing value**, **thickness**, **baseline for catalog sync**.
- **`ShopSettings`** — Branding, nav, passwords, admin lists, email prefs.

---

## Tech stack

- **React Router 7** (Shopify’s React Router app template lineage), **React 18**, embedded **Shopify App Bridge**.
- **`@shopify/shopify-app-react-router`**, **Prisma**, **nodemailer**.
- **Theme extension** (Liquid + JS/CSS assets).
- **Cart Transform** extension (**Rust** / WASM).

---

## Configuration

- **Shopify CLI** — `shopify.app.toml` defines **scopes** (e.g. customers, orders, products, draft orders, **app proxy**), **webhooks**, and **app proxy** prefix `apps`, subpath `project-clad`.
- **`.env`** — Copy from `.env.example`. Set **`DATABASE_URL`**, Shopify vars from CLI or hosting, **`SMTP_*`** for mail, optional **`DRAWING_WORKER_API_KEY`**, optional **`PROJECTCLAD_*_EMAIL`** overrides.

---

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | `shopify app dev` — local dev with tunnel |
| `npm run build` | `prisma generate` + production client build |
| `npm run start` | Serve built app |
| `npm run setup` | `prisma migrate deploy` + generate (e.g. Docker) |
| `npm run typecheck` | TypeScript check |
| `npm run init-part-registry` | Local part registry DB helper |

---

## Development notes

- Use **`npm run dev`** and install the app on a dev store; app proxy URLs resolve to your tunnel.
- **Embedded app navigation**: use React Router / Polaris `Link` patterns as in Shopify’s embedded-app guidance (avoid raw `<a>` navigation that drops session).
- **Email**: use app passwords only; never commit secrets (see comments in `.env.example`).

For generic Shopify hosting, database migration, and troubleshooting topics that still apply, see [Shopify app deployment](https://shopify.dev/docs/apps/launch/deployment) and the [React Router Shopify package](https://shopify.dev/docs/api/shopify-app-react-router).

---

## Repository extras

The repo may also contain **standalone tooling** (for example **Inventor / sketch** helpers under `sketch-to-inventor/` or `scripts/inventor-*`) that are **not** required to run the core Shopify app but support manufacturing workflows around drawing jobs.
