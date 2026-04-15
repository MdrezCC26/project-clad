# Email: Order approved (current + logo)

Sent when an approver approves a project / order / line request.  
**Code:** `app/routes/apps.project-clad.api.project-actions.tsx` — subject `Order approved: {contextLabel}`, per-recipient `sendEmail`.

## Subject (from code)

```
Order approved: {contextLabel}
```

Example: `Order approved: Mike Test in E-mail Tester`

## Body (current plain text — sample)

```
Mike Drezin has approved: Mike Test in E-mail Tester

Items:
  • Custom Omega (×1)
  • T JAMB 3.125 (×1)

View project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

## Requirements (documented — implement when requested)

- **Copy / structure:** Keep **as-is** for now (no other content changes specified).
- **Logo:** **Canadian Cladding PROJECTS** logo at the **top**, same as other Project Clad transactional emails (once HTML/multipart exists).

## Mockup (target — body unchanged, logo added)

```
[Logo: Canadian Cladding PROJECTS]

Mike Drezin has approved: Mike Test in E-mail Tester

Items:
  • Custom Omega (×1)
  • T JAMB 3.125 (×1)

View project: https://rnc2a0-d3.myshopify.com/apps/project-clad/project?id=cmnxa24zh000am73g1ilc0e3n
```

_Note: When there is only one order in scope, the “Items:” block may omit per-order labels; behavior stays as current code until you request changes._
