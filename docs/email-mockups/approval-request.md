# Email: Approval request (current sample)

Sent when a team member submits something for approval (project / order / line scope).  
**Code:** `app/routes/apps.project-clad.api.project-actions.tsx` — subject `Approval request: {contextLabel}`, per-recipient `sendEmail`.

## Subject (from code)

```
Approval request: {contextLabel}
```

Example context label for an order: `Mike Test in E-mail Tester`

## Body (current plain text — sample)

```
Mike Drezin has submitted the following for approval: Mike Test in E-mail Tester

View and approve: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n&approve=1&approveJobId=cmnxa24zh000cm73gzg88xnwa
```

## Global note (from project email spec)

- **Logo** on every transactional email when HTML/branding is implemented (not reflected in this text-only sample).

## Requirements (documented — implement when requested)

- **Logo:** **Canadian Cladding PROJECTS** logo at the **top**, same asset and placement as other Project Clad transactional emails (required once HTML/multipart exists; asset/path TBD at implementation).
- **Opening:** `{Customer name}` has submitted the following for review:  
  - `{Customer name}` = submitting person’s name (same idea as today’s “Mike Drezin”; not the literal words “Customer Name”).
- **Then labeled lines (each on its own line):**
  - **Project:** {project display name}
  - **Order:** {order/job name when scope is order or line; use “—” or TBD for project-only scope}
  - **`Project # {value}`** (no colon after `#`): project-level number as used elsewhere in app
  - **PO Number:** {order-level PO when applicable; “—” or omit when not applicable — confirm vs job `purchaseOrderNumber` at implement time}
- **Reminder block (fixed copy):**  
  `Reminder! Add your address in EDIT PROJECT DETAILS to qualify for $15 shipping!`
- **Approve link:** **`Review your order:`** + full URL (plain text unless you later switch to HTML); place at **bottom** for consistency with cart email layout. _(Replaces former “View and approve:”.)_

## Mockup (target plain text)

```
[Logo: Canadian Cladding PROJECTS]

Mike Drezin has submitted the following for review:

Project: E-mail Tester
Order: Mike Test
Project # 98765
PO Number: —

Reminder! Add your address in EDIT PROJECT DETAILS to qualify for $15 shipping!

Review your order: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n&approve=1&approveJobId=cmnxa24zh000cm73gzg88xnwa
```

_(Sample uses prior test data; `PO Number` shown as `—` until real job PO is wired in implementation.)_

## Subject line

_Unchanged unless you specify._ Current: `Approval request: {contextLabel}`.
