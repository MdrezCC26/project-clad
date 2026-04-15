# Email: Order placed — **shop only** (planned)

This file is the **order that goes specifically to the shop** when **Order now** succeeds — internal operations email only. It is **not** the customer thank-you (`order-placed-thank-you.md`) and **not** a separate “work order” product unless you add that later.

**Status:** Not sent today. Same trigger as customer mail: **`confirm-order-now`** in `apps.project-clad.project.tsx`.

**Audience (product):** **`mike@canadiancladding.ca`** and **`michaeldrezin@canadiancladding.ca`** — both get every shop order-placed email. Suggested implementation: **`PROJECTCLAD_SHOP_ORDER_NOTIFY_EMAIL=mike@canadiancladding.ca,michaeldrezin@canadiancladding.ca`** (dedupe if ever duplicated).

**Intent:** Give staff production / fulfillment context **without pricing**. No **Shop** line, **Project ID**, or **Order ID** in the body (use **Open project** link and human-readable fields instead).

**Branding:** **Canadian Cladding PROJECTS** logo at top (optional for pure internal; included below for consistency).

## Subject (suggested)

```
ProjectClad [Shop]: Order placed — {Order name} — {Project name}
```

Example: `ProjectClad [Shop]: Order placed — Mike Test — E-mail Tester`

---

## Mockup A — shop only · **Pickup**

_**Order placed** date/time: server clock in store timezone (format TBD)._

_**Requested delivery** line must match the **same wording** the app uses for the order’s preferred slot (`scheduledDeliveryDate` + `scheduledDeliveryWindow`), then **uppercase the whole line** so it matches the storefront banner (e.g. “PICKUP … BETWEEN 9AM AND 10AM”). Logic today lives in `formatPreferredDeliveryDisplay` and the pickup branch of `formatOrderDeliveryFootline` in `app/utils/preferredDeliveryFormat.ts` (`Pickup …` replaces `Delivery …` for store pickup orders)._

_Visual reference (storefront banner): one line, **all caps**, e.g. **PICKUP WEDNESDAY, APRIL 15, 2026 BETWEEN 9AM AND 10AM**. Plain-text email = that same line without HTML styling._

```
[Logo: Canadian Cladding PROJECTS]

Order placed on Monday, April 13, 2026 at 2:30 PM,

Placed by
Customer name: Mike Drezin
Email: mike.drezin@example.com
Phone: (416) 555-0199

Project / order
Project: E-mail Tester
Project # 98765
Order: Mike Test
PO Number: —
Company: Canadian Cladding
Fulfillment: Pickup

Requested delivery:
PICKUP WEDNESDAY, APRIL 15, 2026 BETWEEN 9AM AND 10AM

Line items:

1. Custom Omega · Qty 1

      Properties:
      · Gauge: 18 Gauge
      · L1: 4
      · L2: 3
      · L3: 3
      · Additional Details:
      · Color: 0000 - Galvanized
      · Painted Side: Not Painted

2. T JAMB 3.125 · Qty 1

      Properties:
      · Color: Deep Grey

Open project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

---

## Mockup B — shop only · **Delivery**

_Same rules as Mockup A, plus **Ship to** (delivery only — see requirements)._

```
[Logo: Canadian Cladding PROJECTS]

Order placed on Tuesday, April 14, 2026 at 10:15 AM,

Placed by
Customer name: Alex Johnson
Email: alex.j@leereno.ca
Phone: (647) 555-7788

Project / order
Project: Summer Reno
Project # PO-4421
Order: Kitchen package
PO Number: JOB-88
Company: Lee Renovations Ltd.
Fulfillment: Delivery

Requested delivery:
DELIVERY THURSDAY, APRIL 17, 2026 BETWEEN 1PM AND 2PM

Ship to:
  2247 Lakeshore Blvd W
  Etobicoke, ON M8V 3M2
  Canada

Line items:

1. Custom Omega · Qty 2

      Properties:
      · Gauge: 24 Gauge
      · L1: 10
      · L2: 8
      · L3: —
      · Color: Black (matte)
      · Painted Side: Outside only

2. T JAMB 3.125 · Qty 1

      Properties:
      · Color: Deep Grey

Open project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=proj_example_placeholder
```

## Requirements (documented — implement when requested)

- **Opening (fixed pattern):** `Order placed on {date} at {time},` — first line of body after logo (comma as shown; date/time format TBD with store timezone).
- **Do not include:** `An order was just placed in ProjectClad (Order now).` · **`Shop:`** line · **`Project ID:`** · **`Order ID:`**
- **Placed by:** **Customer name**, **Email**, and **Phone** (phone from Shopify Admin customer when available; **—** if missing).
- **Project / order block:** **Project:**, **`Project # {value}`** (no colon after `#`), **Order:**, **PO Number:**, **Company:**, **Fulfillment:** (delivery vs pickup).
- **Ship to:** Include **only when `Fulfillment: Delivery`** — project ship-to fields (same source as customer-facing ship blocks); use **`Ship to: (not on file)`** when delivery but address incomplete. **Do not include a `Ship to:` block for pickup** (store pickup has no ship-to in this email).
- **Requested delivery:** Build the **same sentence** the app already derives from `scheduledDeliveryDate` + `scheduledDeliveryWindow` (see `formatPreferredDeliveryDisplay` in `app/utils/preferredDeliveryFormat.ts`; for **pickup** orders use the `Pickup …` form from `formatOrderDeliveryFootline`, i.e. `Delivery …` → `Pickup …`). Then **`.toUpperCase()`** (or equivalent) on the **entire line** for the email so it matches the storefront banner (**PICKUP WEDNESDAY, … BETWEEN 9AM AND 10AM**). For **delivery** orders, uppercase the **`DELIVERY …`** line the same way. Omit the **Requested delivery:** block when date/window are missing (or show **—** — product TBD).
- **Line items:** **No pricing** (no unit price, line totals, subtotal, delivery fee, tax, or grand total). **Qty** only if useful for production; keep **Properties** blocks (custom dimensions + **Color** on standard lines; omit `_data` / `_admin_summary`).
- **Link:** **`Open project:`** at bottom (URL may still contain `id=` query param for navigation; that is not a separate “Project ID” label line).

## Related

- `order-placed-thank-you.md` — customer thank-you (same trigger; may still include pricing per that spec).
- `cart-new-project-order-saved.md` — property formatting reference.
- `fulfillment-delivered.md` — customer delivered mail (uses same underlying date/window helpers; shop mail adds **all-caps** treatment).
