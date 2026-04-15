# Email: Member added to project (planned)

**Status:** Not sent today. Documented for when `add-member` (or equivalent) should notify the new member.

**Branding:** **Canadian Cladding PROJECTS** logo at top, same as other transactional emails.

## Project number label (global)

Use **`Project # {value}`** with **no colon** after `#` (e.g. `Project # 98765`). Apply this pattern in **all** customer-facing email mockups.

## Subject (TBD)

Example: `ProjectClad: You’ve been added to a project — {Project name}`

## Target mockup (plain text)

```
[Logo: Canadian Cladding PROJECTS]

You’ve been added to a project

Alex Johnson added you to the project below.

Project: E-mail Tester
Project # 98765
Company: Canadian Cladding
Your access: Edit

Open project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

## Requirements (documented — implement when requested)

- **Recipient:** The **newly added** member’s email (from Shopify customer lookup when implemented).
- **Opening:** Short confirmation that they were added (copy above is a starting point).
- **Who:** Name of the person who added them (`{Inviter name}`).
- **Fields:** **Project:** name, **`Project # {number}`** (no colon), **Company:** if present, **Your access:** `View` or `Edit` matching member role.
- **Link:** **`Open project:`** + URL at **bottom** (plain text unless you add HTML later).
- **Optional later:** List of orders, PO lines, or “reply if questions” — not in this mockup.

## Related

- `docs/email-mockups/backlog.md` — original backlog note.
- Trigger TBD: e.g. `add-member` in `apps.project-clad.project.tsx` after successful create.
