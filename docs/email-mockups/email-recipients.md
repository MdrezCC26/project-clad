# Who gets which email (current code)

Plain list of **every** `sendEmail` path and **who receives** it. Use this when changing copy or adding env vars.

| # | Email (trigger) | Who receives | Notes |
|---|-----------------|--------------|--------|
| 1 | **Cart / order saved** (`sendOrderCreatedNotificationEmail` — new project, new order on project, order updated from cart) | **`PROJECTCLAD_ORDER_NOTIFY_EMAIL`** (comma/semicolon split) **+** Shopify emails for **project owner** and **actor** (person who saved), deduped | If env + lookups yield no addresses, send is skipped. |
| 2 | **Project status / snapshot** (`sendProjectStatusNotificationEmail` — reorder, edit, delivery settings, move/copy, delete line, etc.) | **Same as row 1** | One combined `To:` with all addresses. |
| 3 | **Order delivered / fulfilled** (`sendFulfillmentPackageEmails`) | **(A)** Project **owner** Shopify email — one mail (when enabled). **(B)** Finance mail: all addresses in **`PROJECTCLAD_FINANCE_EMAIL`** (or code default), minus per-address mutes in Admin → Automated email notifications | Customer + finance both attach the delivery photo when present. Finance also gets PO PDF. |
| 4 | **Approval requested** (`submit-for-approval`) | Each email of **project members who do not have the `NA` Shopify tag**, **excluding the submitter** (`customerId`). Must have at least one approver mailbox or API returns 400. | Submitters are typically NA-tagged per product rules. |
| 5 | **Order approved** (`approve`) | **Project owner** + **every project member** with a known email (same set used for approval flow, plus approver id `vid` deduped in `memberIds`) | Includes NA-tagged members; each address gets its own send in a loop. |
| 6 | **Order rejected** (POST `cancel-approval-request` with reason — `action` handler) | **Project owner** + **every project member** with a known email | Includes the person who rejected, if they are owner/member. |
| 7 | **Project deleted** (member admin deletes project) | **`michaeldrezin@canadiancladding.ca`** only (hardcoded `backupEmail`) | CSV attached. |
| 8 | **Admin: email CSV** (`app.settings` intent `email-csv`) | Whatever address the admin types in **`toEmail`** | Shop session, not storefront. |

## Planned (not in `sendEmail` yet — from mockups)

| Email | Intended recipients (TBD until implemented) |
|-------|-----------------------------------------------|
| **Order placed — customer thank you** | TBD (e.g. actor / owner / list). |
| **Order placed — shop** | **`mike@canadiancladding.ca`** and **`michaeldrezin@canadiancladding.ca`** (both recipients on every shop order-placed mail). Implement via env list (e.g. `PROJECTCLAD_SHOP_ORDER_NOTIFY_EMAIL`) or explicit config. |
| **Member added to project** | TBD (new member; maybe owner). |

## Product target — finance & shop (locked for implementation)

| Mail | Recipients |
|------|------------|
| **Finance — delivered** (`fulfillmentNotify` finance send) | Default **`michael.drezin@live.co.uk`**, or override with **`PROJECTCLAD_FINANCE_EMAIL`** |
| **Shop — order placed** (`confirm-order-now`, when built) | **`mike@canadiancladding.ca`** **and** **`michaeldrezin@canadiancladding.ca`** |

## Env / constants quick reference

| Variable / constant | Used for |
|---------------------|----------|
| `PROJECTCLAD_ORDER_NOTIFY_EMAIL` | Rows **1** and **2** |
| `PROJECTCLAD_FINANCE_EMAIL` | Row **3** — all addresses get finance delivered mail (minus Admin mutes); omit to use code default **`michaeldrezin@canadiancladding.ca`** |
| `PROJECTCLAD_SHOP_ORDER_NOTIFY_EMAIL` (planned) | Shop order-placed: e.g. **`mike@canadiancladding.ca,michaeldrezin@canadiancladding.ca`** |
| `backupEmail` in `projects.tsx` | Row **7** |
