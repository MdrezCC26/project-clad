# Email backlog / future work

Items not implemented yet; expand with mockups and requirements when you prioritize them.

## Project member added

**Need:** A notification email when **you (or someone else) is added to a project** as a member.

- **Mockup / spec:** `member-added-to-project.md`
- **Trigger:** TBD at implementation (e.g. `add-member` or equivalent route after successful invite).
- **Recipients:** The newly added person (and optionally project owner — TBD).

_No code path sends this today; add when product copy and behavior are defined._

## Order placed (thank you)

**Need:** Email when an order is **placed** via **Order now** after approval.

- **Spec / mockup:** `order-placed-thank-you.md` (customer) · `order-placed-shop-notify.md` (shop / internal)
- **Trigger today:** After successful `confirm-order-now` in `apps.project-clad.project.tsx` (no email is sent yet).
