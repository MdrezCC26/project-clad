# Mockup: Cart save — new project + first order

Spec source: email-thread requirements (cart / `sendOrderCreatedNotificationEmail` when mode creates new project).  
Implementation: not done until explicitly requested.

## Subject

```
ProjectClad: Your order has been saved! — {Project name}
```

Example: `ProjectClad: Your order has been saved! — E-mail Tester`

## Body (plain text)

Placeholders: `{...}` = dynamic. Sample values match the “E-mail Tester” test.

```
[Logo: Canadian Cladding PROJECTS]

Your order has been saved!

Project: E-mail Tester
Order: Mike Test
Project # 98765
Company: Canadian Cladding

Lines saved in this cart action:

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

Open project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

## Rules captured in this mockup

- Opening line: **Your order has been saved!** (replaces “New project and order saved from cart”).
- Omit: **Shop**, **Project ID**, **Order ID**.
- Keep: **Project:** name, **Order:** name, **`Project # {value}`** (no colon after `#`), **Company:** name.
- Line items: omit **vendor** suffix, **Variant ID**, **Source** (e.g. live); labels **Unit Price** / **Total**.
- Properties: customer-facing rows only; omit **`_data`**, **`_admin_summary`**, and other internal `_*` lines after the last visible property. **Custom lines:** show submitted dimensions/options (gauge, lengths, etc.). **Standard (non-custom) lines:** include **Color:** (and other relevant shopper-facing fields).
- No **`── Full project snapshot ──`** (optional snapshot later via separate product decision).
- **Open project:** full URL at **bottom**; plain text (no HTML link label).
- **Logo** at top (asset TBD when implementing HTML or multipart).

## Related code (for implementers)

- `app/utils/orderCreatedEmail.server.ts` — `sendOrderCreatedNotificationEmail`
- Trigger: `app/routes/apps.project-clad.api.save-job.tsx` (new project path; headline string will change when implemented)
