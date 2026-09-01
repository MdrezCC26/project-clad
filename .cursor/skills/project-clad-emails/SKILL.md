---
name: project-clad-emails
description: >-
  Maps transactional email behavior in Project Clad (SMTP via nodemailer, subjects,
  recipients, and what code paths trigger sends). Use when the user asks about emails,
  notifications, project or order status mail, fulfillment mail, SMTP, or changing
  email copy or triggers for storefront / app proxy flows.
---

# Project Clad — email work

## First step

Read `app/utils/email.server.ts` for transport (`nodemailer`), env vars (`SMTP_*`), and `isEmailConfigured`. All sends should go through `sendEmail` unless a dedicated helper wraps it.

## Where emails are sent (inventory)

Run a fresh search when behavior may have changed:

```text
rg "sendEmail|sendOrderCreatedNotificationEmail|sendProjectStatusNotificationEmail|sendFulfillmentPackageEmails" app -g "*.{ts,tsx}"
```

Known entry points (verify in repo):

| Area | File | Notes |
|------|------|--------|
| Core send | `app/utils/email.server.ts` | `sendEmail`, `isEmailConfigured` |
| Order / project status copy | `app/utils/orderCreatedEmail.server.ts` | `sendOrderCreatedNotificationEmail`, `sendProjectStatusNotificationEmail` |
| Fulfillment / package photos | `app/utils/fulfillmentNotify.server.ts` | `sendFulfillmentPackageEmails` → **customer + finance** branded HTML; both attach delivery photo |
| Branded HTML shell | `app/utils/brandedEmailHtml.server.ts` | Shared cream/card/zigzag layout |
| Delivered HTML (customer/finance) | `app/utils/financeDeliveredEmailHtml.server.ts` | Shared confirmation; finance adds price box |
| Finance recipients + mutes | `app/utils/financeEmailRecipients.server.ts` | Env list; Admin mutes in `emailNotificationPrefsJson` |
| API actions (many intents) | `app/routes/apps.project-clad.api.project-actions.tsx` | Direct `sendEmail` calls for specific actions |
| Projects list / admin-style actions | `app/routes/apps.project-clad.projects.tsx` | At least one `sendEmail` path |
| Save job → order created mail | `app/routes/apps.project-clad.save-job.tsx` | Imports `sendOrderCreatedNotificationEmail` |
| Project page actions | `app/routes/apps.project-clad.project.tsx` | `sendProjectStatusNotificationEmail`, `sendFulfillmentPackageEmails` (check loader/action intents) |
| Settings / test | `app/routes/app.settings.tsx` | Test send + SMTP help text |

## Tracing “project state changed → email”

1. Find the **action** or **API route** that mutates state (`intent`, `formData`, or JSON body).
2. From there, grep for `sendEmail`, `sendProjectStatusNotificationEmail`, `sendOrderCreatedNotificationEmail`, or `sendFulfillmentPackageEmails`.
3. Read the **subject** and **text/html** construction at the call site; helpers in `orderCreatedEmail.server.ts` centralize some templates.

## Conventions for changes

- Prefer **one helper module** (`orderCreatedEmail.server.ts`, `fulfillmentNotify.server.ts`) for customer-facing copy so subjects and bodies stay consistent.
- Preserve **idempotency** where the code already guards duplicate sends (read surrounding `if` / flags before adding new sends).
- Do not log secrets or full email bodies in production logs.
- After route or copy changes: `npm run build` or `npm run typecheck` as appropriate; no extra email-specific CLI.

## Optional: dedicated chat

For large email refactors, open a **new chat** titled around “Project Clad emails” and @-mention this skill or say “use the project-clad-emails skill” so context stays scoped.

## Local HTML preview (no SMTP)

```powershell
npm run preview:finance-email
npm run preview:finance-email -- --open
npm run preview:customer-email
npm run preview:customer-email -- --open
```

Writes under `docs/email-mockups/` (sample data). Override path with `$env:OUT="…"`.
