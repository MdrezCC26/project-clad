# Email: Project deleted — backup CSV (current behavior)

**Product note:** Current subject + one-line body + CSV attachment are **approved as-is** (no spec change required unless you reopen it later).

Sent when a **project member admin** deletes a project from the projects list (`delete-project` action). Fires **before** the project row is removed from the database.

**Code:** `app/routes/apps.project-clad.projects.tsx` — `sendEmail` with CSV attachment.

**Recipient today:** Fixed address **`michaeldrezin@canadiancladding.ca`** (`backupEmail` in code). **TBD:** env-driven list if you need more recipients.

## Subject (from code)

```
ProjectClad project export: {Project name}
```

Example: `ProjectClad project export: E-mail Tester`

## Body (current plain text)

_Attachment: CSV filename `projectclad-{sanitized-project-name}.csv` (content from `getCsvForProjectIds`)._

```
Your project "E-mail Tester" has been deleted.
```

## Related

- `app.settings.tsx` — different flow: **email CSV** to an arbitrary address from admin settings.
