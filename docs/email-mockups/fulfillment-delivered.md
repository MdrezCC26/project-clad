# Email: Order fulfilled / delivered (current sample)

Sent after fulfillment photos (or equivalent flow); **owner** and **finance** each get a separate message (same body; finance subject has **`[finance]`** suffix).

**Code:** `app/utils/fulfillmentNotify.server.ts` — `sendFulfillmentPackageEmails` → `sendEmail`.

## Subject (from code)

**Owner**

```
ProjectClad: Order delivered — {Project name} · {Order name}
```

**Finance** (same, with suffix)

```
ProjectClad: Order delivered — {Project name} · {Order name} [finance]
```

## Body (current plain text — your sample)

When **scheduled delivery** is set on the job, the real email can include an extra line after **Order ID** (from `formatPreferredDeliveryDisplay`). Your paste omits that line.

```
Order fulfilled — Mike Test

Project: E-mail Tester
Project ID: cmnxa24zh000am73g1ilc0e3n
Order ID: cmnxa24zh000cm73gzg88xnwa

Ship to: (not on file)

Line items:
1. Custom Omega — Qty 1 × $36.80 = $36.80
2. T JAMB 3.125 — Qty 1 × $20.80 = $20.80

Subtotal: $57.60
Delivery: $0.00
Tax: $0.00
Total: $57.60

View in Projects: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

## Recipients

- **Owner:** project owner’s Shopify customer email (if present).
- **Finance:** `PROJECTCLAD_FINANCE_EMAIL` env (comma/semicolon list) or default in code.

## Requirements (documented — implement when requested)

- **Opening line (fixed copy):** `Your order has been delivered!` — replaces current **`Order fulfilled — {order name}`** as the **first line** of the body.
- **Header block (match order-created / cart email):** Immediately after the opening line, use the same labeled fields as **`cart-new-project-order-saved.md`** — **Project:**, **Order:**, **`Project # {value}`** (no colon after `#`), **PO Number:**, **Company:**. Do **not** show **Project ID** or **Order ID** in the customer-facing body.
- **Scheduled delivery:** If present (job schedule fields), keep a **preferred delivery** line after this header block and before **Ship to** (same data as today’s `formatPreferredDeliveryDisplay`).
- **Line items — properties:** Same filtering as **`cart-new-project-order-saved.md`** (no `_data` / `_admin_summary` / internal `_*`). **Custom / configured lines:** include **entered dimensions and options** (e.g. gauge, L1–L3, color/finish, painted side, etc.—whatever the customer submitted). **Standard (non-custom) catalog lines:** include **color** (label as **Color:** for customer-facing copy unless storefront uses another field name).
- _Further TBD:_ link label wording, real delivery/tax in totals when not zero.

**Global note:** Other email specs use **Canadian Cladding PROJECTS** logo at top once HTML/multipart exists—apply here too unless you decide otherwise.

## Target mockup (plain text)

_Fictional **Ship to** address for illustration only._

```
[Logo: Canadian Cladding PROJECTS]

Your order has been delivered!

Project: E-mail Tester
Order: Mike Test
Project # 98765
PO Number: —
Company: Canadian Cladding

Ship to:
  1846 Queen Street East
  Toronto, ON M4L 1G8
  Canada

Line items:

1. Custom Omega
   Qty 1 × $36.80 = $36.80

      Properties:
      · Gauge: 18 Gauge
      · L1: 4
      · L2: 3
      · L3: 3
      · Additional Details:
      · Color: 0000 - Galvanized
      · Painted Side: Not Painted

2. T JAMB 3.125
   Qty 1 × $20.80 = $20.80

      Properties:
      · Color: Deep Grey

Subtotal: $57.60
Delivery: $0.00
Tax: $0.00
Total: $57.60

View in Projects: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

## Related

- Trigger: `app/routes/apps.project-clad.project.tsx` (calls `sendFulfillmentPackageEmails` after successful fulfillment notify).
- `docs/email-mockups/cart-new-project-order-saved.md` — possible line-item style reference if you align copy.
