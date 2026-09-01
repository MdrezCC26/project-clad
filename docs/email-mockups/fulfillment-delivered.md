# Email: Order fulfilled / delivered (customer)

Sent after fulfillment confirmation. **Customer** and **finance** each get a branded HTML message from the same shell; finance also includes the price box.

**Code:** `app/utils/fulfillmentNotify.server.ts` — `sendFulfillmentPackageEmails`  
**HTML:** `buildCustomerDeliveredEmailHtml` / `buildFinanceDeliveredEmailHtml` in `financeDeliveredEmailHtml.server.ts`

## Subject (from code)

**Customer**

```
ProjectClad: Order delivered — {Project name} · {Order name}
```

**Finance**

```
ProjectClad: Finance — Order delivered — {Project name} · {Order name}
```

## Customer HTML (current)

Same layout as finance (cream card, logo, detail card, CTA) **without** the Subtotal / Delivery / Tax / Total box. Headline: `{Order name} has been delivered!`

## Local preview

```powershell
npm run preview:customer-email -- --open
```

## Related

- `docs/email-mockups/fulfillment-delivered-finance.md` — finance variant (includes price box)
- Trigger: project / work-orders / admin phase fulfillment → `sendFulfillmentPackageEmails`
