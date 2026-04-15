# Email: Project status / snapshot notifications (planned change)

**Code:** `sendProjectStatusNotificationEmail` in `app/utils/orderCreatedEmail.server.ts` — called from `emailProjectStatusSnapshot` in `app/routes/apps.project-clad.project.tsx` for many **project / order state** changes.

**Recipients today:** `PROJECTCLAD_ORDER_NOTIFY_EMAIL` + project **owner** + **actor** (`collectRecipientEmails`).

## Requirement (all status-change mails in this family)

- **Do not include** the **`── Full project snapshot ──`** block or any **`buildFullProjectSnapshotText`** output in the body.
- **Intro lines** must **not** promise content that is no longer there (e.g. remove or rewrite *“Current project contents are listed below.”* when there is no snapshot — adjust each `introLines` at the `emailProjectStatusSnapshot` call sites so copy matches what the email still contains).

## Target mockup — “Delivery settings updated” (example)

_Subject today: `ProjectClad: Delivery settings updated — {Project name}`._

```
[Logo: Canadian Cladding PROJECTS]

The delivery address or receive mode for this project was changed on the project page.

Open project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

_(Optional: move **`Open project:`** to the **bottom** to match other email specs — product choice.)_

## Triggers using this template today

Each uses a **headline** + optional **introLines**; implementation should drop snapshot for **all** of these:

- Orders reordered · Order lines reordered · Order deleted from project · Order updated on project page · New empty order added · Order moved to / into another project · Order copied to / into another project · Line removed from order · Project details updated · **Delivery settings updated** (your sample)

## Related

- `cart-new-project-order-saved.md` — cart save mail (separate helper; snapshot already planned optional there).
- `app/utils/orderCreatedEmail.server.ts` — remove or gate `snapshot` in `sendProjectStatusNotificationEmail` when implementing.
