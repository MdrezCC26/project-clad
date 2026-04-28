# Email: Order delivered — finance (planned / separate copy)

**Intent:** During the **same delivered / fulfillment** phase as the customer-facing **delivered** mail, send a **second, finance-only** message (not the same body as the owner).

**Recipients (product):** default **`michael.drezin@live.co.uk`**, or first address in **`PROJECTCLAD_FINANCE_EMAIL`** when set.

**Today:** `sendFulfillmentPackageEmails` in `fulfillmentNotify.server.ts` sends finance the **same body** as the owner, with subject suffix **`[finance]`**. **Target:** Replace finance body with a template like below (customer + order context for accounting).

**Branding:** **Canadian Cladding PROJECTS** logo at top (match other mails unless finance asks for plain internal only).

## Subject (suggested)

```
ProjectClad: Finance — Order delivered — {Project name} · {Order name}
```

_(Or keep `… [finance]` on the existing subject if you prefer continuity.)_

## Target mockup (plain text)

_Customer block = project **owner** from Shopify (name, email, phone when available). Sample names are fictional._

```
[Logo: Canadian Cladding PROJECTS]

This order has been delivered. Please proceed with the invoice for this order.

Customer details
Customer name: Jordan Lee
Email: jordan.lee@example.com
Phone: (416) 555-0142
Company on project: Canadian Cladding

Project / order
Project: E-mail Tester
Project # 98765
Order: Mike Test
PO Number: —

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

View project (ProjectClad): https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

## Requirements (documented — implement when requested)

- **Opening copy (fixed):** After the logo, a single line: `This order has been delivered. Please proceed with the invoice for this order.` — then blank line, then **Customer details** (no separate “finance notification” or “totals below” headline).
- **Always include a “Customer details” section** for finance: at minimum **name** and **email** from the **project owner’s** Shopify customer record; **phone** when Admin API returns it; **Company on project** from `project.companyName` (or **—** if empty).
- **Project / order block:** **Project:**, **Order:**, **`Project # {value}`** (no colon after `#`), **PO Number:** (job PO or **—**), then **Ship to** and **line items + money** (same math as owner delivered mail).
- **Line items — properties:** Match **`fulfillment-delivered.md`**: custom lines show **submitted dimensions/options**; standard lines include **Color:** (and other relevant customer-facing properties only).
- **Internal context:** Do **not** include a **Shop:** myshopify.com line in this mail. **Shopify Admin deep link** to the paid order when/if you store `orderLink` / GID and can build URLs — mark **TBD** until data exists.
- **Link:** Keep a **ProjectClad** project URL at bottom for quick lookup.
- **Owner email:** unchanged; this mail is **in addition** to (or replaces duplicate body for) finance only.

## Data sources (for implementers)

- Owner identity: `project.ownerCustomerId` + `getCustomersByIds(shop, [ownerId])` (display name, email, phone).
- Project fields: `name`, `poNumber`, `companyName`, shipping columns, `shop`.
- Job: `name`, `purchaseOrderNumber`, line items as today in `sendFulfillmentPackageEmails`.

## Related

- `fulfillment-delivered-finance-custom-part-sample.md` — full sample with a **custom configured** line + a catalog line.
- `fulfillment-delivered.md` — customer-facing delivered mockup.
- `fulfillmentNotify.server.ts` — owner + finance sends.
