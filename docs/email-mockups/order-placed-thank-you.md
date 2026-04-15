# Email: Order placed — thank you (planned)

**Status:** Not sent today. After **Order now** succeeds, the app sets `orderLifecycleStatus` to `ordered` in `confirm-order-now` (`app/routes/apps.project-clad.project.tsx`) but does **not** call `sendEmail`.

## Product intent

- Notify the customer (and/or staff — **TBD**) when an order has been **placed** from the project page.
- **Opening (fixed copy):** `Your order has been successfully placed, thank you for choosing Canadian Cladding.`
- **Line items:** Same **presentation rules** as the cart “order saved” email where possible (see `cart-new-project-order-saved.md`): e.g. no raw shop/project/order IDs in customer-facing body unless you decide otherwise, no variant ID / vendor / source / `_data` / `_admin_summary`, **Unit Price** / **Total** labels, properties filtered for customers, **logo** at top.
- **Link:** Plain-text link to open the project (and/or order context) at the **bottom**, consistent with other emails.
- **Header fields:** **Project:**, **Order:**, **`Project # {value}`** (no colon after `#`), **PO Number:** (job `purchaseOrderNumber`; **—** when empty), **Company:** — same pattern as cart / fulfillment mockups.
- **Address:** Show **delivery address** from project fields when the order was placed as **delivery** (`fulfillmentMethod` on the job after `confirm-order-now`). For **pickup**, show a clear **store pickup** line (exact copy TBD) instead of a ship-to block.
- **Order totals (after line items):** Include **Subtotal** (sum of line totals for this order only), plus **Delivery** and **Tax**, then **Total** (Subtotal + Delivery + Tax). Pickup orders should show **Delivery: $0.00** (or equivalent) unless you use different copy. **Source for dollar amounts at implementation:** TBD (e.g. Shopify checkout/order, shop settings, or calculated rules)—must not be placeholder-only in production.

## Draft mockup (plain text)

_Sample values align with **`cart-new-project-order-saved.md`** (E-mail Tester / Mike Test / same two lines). Address is illustrative for delivery._

```
[Logo: Canadian Cladding PROJECTS]

Your order has been successfully placed, thank you for choosing Canadian Cladding.

Project: E-mail Tester
Order: Mike Test
Project # 98765
PO Number: —
Company: Canadian Cladding

Ship to:
  100 Industrial Way
  Toronto, ON M5H 2N2
  Canada

Order lines:

1. Custom Omega
   Qty 1 · Unit Price $36.80 · Total $36.80

      Properties:
      · Gauge: 18 Gauge
      · L1: 4
      · L2: 3
      · L3: 3
      · Additional Details:
      · Color: 0000 - Galvanized
      · Painted Side: Not Painted

2. T JAMB 3.125
   Qty 1 · Unit Price $20.80 · Total $20.80

      Properties:
      · Color: Deep Grey

Subtotal: $57.60
Delivery: $15.00
Tax: $9.44
Total: $82.04

Open project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

_For **pickup**, replace the **Ship to:** block with your chosen store-pickup wording; **Delivery** is typically **$0.00**. Line item math: $36.80 + $20.80 = **$57.60** subtotal. **Delivery / tax / total** above are **illustrative**; real values come from your pricing/tax rules at implementation._

## Open decisions (before implementation)

- **Recipients:** Placing customer only, owner + env list, or same as `sendOrderCreatedNotificationEmail`?
- **Subject line:** e.g. `ProjectClad: Your order has been placed — {project}`? _(Body opening line is fixed as above.)_
- **Fulfillment method:** Address block reflects delivery vs pickup (see Product intent); fine-tune pickup copy if needed.
- **Multiple jobs:** N/A for this trigger (single `jobId` on confirm).

## Related

- `order-placed-shop-notify.md` — **Shop / internal** email for the same **Order now** event (IDs + `Shop:` line OK).
- `docs/email-mockups/cart-new-project-order-saved.md` — item detail formatting reference.
- `docs/email-mockups/backlog.md` — other future mails.
