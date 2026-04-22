# Email: Order delivered — finance (sample with custom line)

**Code:** `sendFulfillmentPackageEmails` in `app/utils/fulfillmentNotify.server.ts` (finance branch: separate body from owner).

**Recipient:** Finance mailbox — first address in `PROJECTCLAD_FINANCE_EMAIL`, or default `michaeldrezin@canadiancladding.ca`. Skipped when that address equals the project owner (case-insensitive).

**Branding:** Same as other transactional mail: HTML + shop logo when `sendTransactionalEmail` runs; this doc shows **plain text** only.

---

## Subject

```
ProjectClad: Finance — Order delivered — Lee Reno · Kitchen package
```

---

## Body (plain text) — delivery + custom configured line

_Fictional customer and address. Line item math: $73.60 + $20.80 = **$94.40**._

```
This order has been delivered. Please proceed with the invoice for this order.

Customer details
Customer name: Alex Johnson
Email: alex.j@leereno.ca
Phone: (647) 555-7788
Company on project: Lee Renovations Ltd.

Project / order
Project: Lee Reno
Project # PO-4421
Order: Kitchen package
PO Number: JOB-88

Ship to:
  2247 Lakeshore Blvd W
  Etobicoke, ON M8V 3M2
  Canada

Line items:

1. Custom Omega
   Qty 2 × $36.80 = $73.60

      Properties:
      · shape_type: L
      · Gauge: 18 Gauge
      · L1: 10
      · L2: 8
      · L3: 6
      · A1: 90
      · Additional Details: Field cut, mitre north wall
      · Color: 0000 - Galvanized
      · Painted Side: Outside only

2. T JAMB 3.125
   Qty 1 × $20.80 = $20.80

      Properties:
      · Color: Deep Grey

Subtotal: $94.40
Delivery: $0.00
Tax: $0.00
Total: $94.40

View project (ProjectClad): https://your-store.myshopify.com/apps/project-clad/project?id=proj_example_placeholder
```

---

## Pickup variant (no ship-to block)

When the job is **store pickup**, the finance body uses **`Fulfillment: Store pickup`** instead of **Ship to:** (same line items and totals as above).

---

## Related

- `fulfillment-delivered-finance.md` — product requirements and shorter sample.
- `fulfillment-delivered.md` — owner-facing delivered mail.
- `cart-new-project-order-saved.md` — property filtering rules (customer-facing; internal `_*` keys omitted in sent mail).
