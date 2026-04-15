# Email: Order rejected

Sent when an approver rejects a pending approval. **Recipients:** all project **members** with known emails (when SMTP is configured).

**Rejection reason:** The email **must always** include a **Rejection reason** section, populated from the **reason text box** in the reject modal on the project page. The modal should **require** a non-empty reason before submit (today the UI label still says “optional” in `apps.project-clad.project.tsx` — align app + API validation when implementing).

**Code:** `app/routes/apps.project-clad.api.project-actions.tsx` — POST `cancel-approval-request` with `rejectReason` (action handler).

## Subject (from code)

```
Order rejected: {contextLabel}
```

Example: `Order rejected: Mike Test in E-mail Tester`

## Body (current plain text — sample)

_No logo; single block._

```
Mike Drezin has rejected: Mike Test in E-mail Tester

Rejection reason:
Line items exceed approved quantities.

View project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

Today’s production still sends if the reason is empty (no **Rejection reason:** block). **Target behavior:** do not send the rejection email without a reason, or reject the API request until reason is provided — match the required modal.

## Requirements (documented — implement when requested)

- **Logo:** **Canadian Cladding PROJECTS** at top (same as other transactional emails).
- **Opening:** Name of person who rejected + clear rejection line (target mockup below).
- **Header block:** Match other customer mails — **Project:**, **Order:**, **`Project # {value}`** (no colon after `#`), **PO Number:**, **Company:** (values from project/job when implemented).
- **Rejection reason:** **Always** present — label **`Rejection reason:`** then one or more lines from the reject-modal text box (required before submit).
- **Link:** **`View project:`** + URL at **bottom** (plain text unless HTML later).

## Target mockup (plain text)

```
[Logo: Canadian Cladding PROJECTS]

Mike Drezin has rejected this submission for review:

Project: E-mail Tester
Order: Mike Test
Project # 98765
PO Number: —
Company: Canadian Cladding

Rejection reason:
Line items exceed approved quantities.

View project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

_Opening line copy can be shortened (e.g. back to `has rejected: {contextLabel}`) if you prefer; update this doc when you lock final wording._
