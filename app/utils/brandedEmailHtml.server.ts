/**
 * Branded HTML email shell matching the Canadian Cladding delivery-confirmation
 * visual (cream canvas, white card, red zigzag, dark footer).
 * Prefer CID / hosted logo URLs — do not embed large base64 images (Outlook).
 */

export const BRANDED_EMAIL_LOGO_CID = "projectclad-logo@transactional";

export function escapeEmailHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type BrandedEmailDetailRow = {
  label: string;
  value: string;
  /** When true, value may contain trusted HTML (already escaped fragments). */
  html?: boolean;
};

export type BrandedEmailCta = {
  href: string;
  label: string;
};

export type BuildBrandedEmailHtmlArgs = {
  title: string;
  preheader: string;
  /** Optional red uppercase label above the headline; omit to hide. */
  eyebrow?: string;
  headline: string;
  subcopy: string;
  detailRows: BrandedEmailDetailRow[];
  /** Extra sections between detail card and CTA (line items, totals, etc.). */
  bodyHtml?: string;
  /** Primary dark buttons (stacked). Prefer over single `cta`. */
  ctas?: BrandedEmailCta[];
  /** @deprecated Use `ctas`. */
  cta?: BrandedEmailCta | null;
  /** Secondary text links under the CTA. */
  secondaryLinksHtml?: string;
  footerNote?: string;
  /** When true, render `<img src="cid:…">`; otherwise text wordmark. */
  hasLogo: boolean;
};

function corrugatedDividerHtml(): string {
  return `
        <tr>
          <td style="padding:0;margin:0;font-size:0;line-height:0;height:6px;background-color:#B3272C;">
            &nbsp;
          </td>
        </tr>`;
}

function detailRowsHtml(rows: BrandedEmailDetailRow[]): string {
  const parts: string[] = [];
  rows.forEach((row, i) => {
    const isLast = i === rows.length - 1;
    const pad = isLast ? "" : " padding-bottom:16px;";
    const value = row.html ? row.value : escapeEmailHtml(row.value);
    parts.push(`
                    <tr>
                      <td class="detail-label email-label" style="font-family:'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size:11px; letter-spacing:0.5px; text-transform:uppercase; color:#9A968D; padding-bottom:4px;">${escapeEmailHtml(row.label)}</td>
                    </tr>
                    <tr>
                      <td class="email-text" style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:15px; color:#1E2124; font-weight:600;${pad}">
                        ${value}
                      </td>
                    </tr>`);
  });
  return parts.join("\n");
}

/**
 * Full HTML document for transactional mail (table-based, Outlook-friendly).
 */
export function buildBrandedEmailHtml(args: BuildBrandedEmailHtmlArgs): string {
  const logoBlock = args.hasLogo
    ? `<img src="cid:${BRANDED_EMAIL_LOGO_CID}" width="196" height="64" alt="Canadian Cladding" style="display:block; width:196px; height:64px; max-width:100%; border:0;">`
    : `<p style="margin:0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:18px; font-weight:700; color:#1E2124; letter-spacing:0.02em;">Canadian Cladding</p>`;

  const ctaList: BrandedEmailCta[] = [
    ...(args.ctas ?? []),
    ...(args.cta ? [args.cta] : []),
  ].filter((c) => c.href.trim() && c.label.trim());

  const ctaButtonsHtml = ctaList.length
    ? `
            <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
              <tr>
                ${ctaList
                  .map((c, i) => {
                    const href = escapeEmailHtml(c.href);
                    const label = escapeEmailHtml(c.label);
                    return `
                <td class="stack" style="${i > 0 ? "padding-left:12px;" : ""}">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td class="email-btn" bgcolor="#000000" style="border-radius:3px; background-color:#000000; mso-padding-alt:13px 18px;">
                        <a href="${href}" target="_blank" style="display:inline-block; padding:13px 18px; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:13px; font-weight:600; color:#FFFFFF !important; text-decoration:none; letter-spacing:0.3px; white-space:nowrap;">
                          <span style="color:#FFFFFF !important;">${label}</span>
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>`;
                  })
                  .join("")}
              </tr>
            </table>`
    : "";

  const ctaBlock = ctaButtonsHtml
    ? `
        <tr>
          <td class="px-fluid email-card-bg" align="center" bgcolor="#EEECE7" style="padding: 0 40px 16px 40px; background-color:#EEECE7;">
            ${ctaButtonsHtml}
            ${args.secondaryLinksHtml ?? ""}
          </td>
        </tr>`
    : args.secondaryLinksHtml
      ? `
        <tr>
          <td class="px-fluid email-card-bg" bgcolor="#EEECE7" style="padding: 0 40px 16px 40px; background-color:#EEECE7;">
            ${args.secondaryLinksHtml}
          </td>
        </tr>`
      : "";

  const bodySection = args.bodyHtml
    ? `
        <tr>
          <td class="px-fluid email-card-bg" bgcolor="#EEECE7" style="padding: 0 40px 32px 40px; background-color:#EEECE7;">
            ${args.bodyHtml}
          </td>
        </tr>`
    : "";

  const footerNote = args.footerNote?.trim();
  const footerSecondLine = footerNote
    ? `<br>${escapeEmailHtml(footerNote)}`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeEmailHtml(args.title)}</title>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
<style>
  :root { color-scheme: light only; }
  body, table, td { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  body { margin:0; padding:0; width:100% !important; background-color:#FFFFFF; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  table { border-collapse:collapse !important; }
  a { color:#B3272C; }

  .email-root { background-color:#FFFFFF; }
  .email-container { background-color:#EEECE7; }
  .email-card-bg { background-color:#EEECE7; }
  .email-text { color:#1E2124; }
  .email-muted { color:#5A5F66; }
  .email-label { color:#9A968D; }
  .email-btn { background-color:#000000; }
  .email-btn a { color:#FFFFFF !important; }

  /*
   * Keep the cream card + dark text even when the OS/client is in dark mode.
   * Outlook otherwise remaps #EEECE7 → dark gray and kills contrast.
   */
  @media (prefers-color-scheme: dark) {
    body,
    .email-root { background-color:#FFFFFF !important; }
    .email-container,
    .email-card-bg { background-color:#EEECE7 !important; }
    .email-text,
    .hero-headline { color:#1E2124 !important; }
    .email-muted { color:#5A5F66 !important; }
    .email-label,
    .detail-label { color:#9A968D !important; }
    .email-btn { background-color:#000000 !important; }
    .email-btn a,
    .email-btn span { color:#FFFFFF !important; }
  }

  /* Outlook.com dark mode */
  [data-ogsc] body,
  [data-ogsc] .email-root,
  [data-ogsb] body,
  [data-ogsb] .email-root { background-color:#FFFFFF !important; }
  [data-ogsc] .email-container,
  [data-ogsc] .email-card-bg,
  [data-ogsb] .email-container,
  [data-ogsb] .email-card-bg { background-color:#EEECE7 !important; }
  [data-ogsc] .email-text,
  [data-ogsc] .hero-headline,
  [data-ogsb] .email-text,
  [data-ogsb] .hero-headline { color:#1E2124 !important; }
  [data-ogsc] .email-muted,
  [data-ogsb] .email-muted { color:#5A5F66 !important; }
  [data-ogsc] .email-label,
  [data-ogsc] .detail-label,
  [data-ogsb] .email-label,
  [data-ogsb] .detail-label { color:#9A968D !important; }
  [data-ogsc] .email-btn,
  [data-ogsb] .email-btn { background-color:#000000 !important; }
  [data-ogsc] .email-btn a,
  [data-ogsc] .email-btn span,
  [data-ogsb] .email-btn a,
  [data-ogsb] .email-btn span { color:#FFFFFF !important; }

  @media screen and (max-width: 600px) {
    .email-container { width:100% !important; }
    .stack { display:block !important; width:100% !important; padding-left:0 !important; }
    .stack + .stack { padding-top:10px !important; }
    .px-fluid { padding-left:24px !important; padding-right:24px !important; }
    .hero-headline { font-size:26px !important; line-height:32px !important; }
    .detail-label { padding-top:14px !important; }
  }
</style>
</head>
<body bgcolor="#FFFFFF" style="margin:0;padding:0;background-color:#FFFFFF;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
  ${escapeEmailHtml(args.preheader)}
</div>

<table role="presentation" class="email-root" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF;">
  <tr>
    <td align="center" style="padding: 32px 16px;">

      <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" bgcolor="#EEECE7" style="width:600px; max-width:600px; background-color:#EEECE7; border-radius:4px; overflow:hidden;">

        <tr>
          <td class="px-fluid email-card-bg" align="center" bgcolor="#EEECE7" style="padding: 36px 40px 26px 40px; background-color:#EEECE7;">
            ${logoBlock}
          </td>
        </tr>

        ${corrugatedDividerHtml()}

        <tr>
          <td class="px-fluid email-card-bg" bgcolor="#EEECE7" style="padding: 40px 40px 8px 40px; background-color:#EEECE7;">
            ${
              args.eyebrow?.trim()
                ? `<p style="margin:0 0 10px 0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; color:#B3272C; font-weight:700;">
              ${escapeEmailHtml(args.eyebrow.trim())}
            </p>`
                : ""
            }
            <h1 class="hero-headline email-text" style="margin:0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:30px; line-height:36px; color:#1E2124; font-weight:800;">
              ${escapeEmailHtml(args.headline)}
            </h1>
          </td>
        </tr>

        <tr>
          <td class="px-fluid email-card-bg" bgcolor="#EEECE7" style="padding: 4px 40px 28px 40px; background-color:#EEECE7;">
            <p class="email-muted" style="margin:0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:15px; line-height:24px; color:#5A5F66;">
              ${escapeEmailHtml(args.subcopy)}
            </p>
          </td>
        </tr>

        <tr>
          <td class="px-fluid email-card-bg" bgcolor="#EEECE7" style="padding: 0 40px 32px 40px; background-color:#EEECE7;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#EEECE7" style="border:1px solid #E4E1DA; border-radius:4px; background-color:#EEECE7;">
              <tr>
                <td bgcolor="#EEECE7" style="padding:24px 24px 20px 24px; background-color:#EEECE7;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${detailRowsHtml(args.detailRows)}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${bodySection}
        ${ctaBlock}

        <tr>
          <td class="px-fluid email-card-bg" bgcolor="#EEECE7" style="padding: 0 40px; background-color:#EEECE7;">
            <div style="border-top:1px solid #EDEBE5; font-size:0; line-height:0;">&nbsp;</div>
          </td>
        </tr>

        <tr>
          <td class="px-fluid email-card-bg" bgcolor="#EEECE7" style="padding: 12px 40px 36px 40px; background-color:#EEECE7;">
            <p class="email-label" style="margin:0 0 16px 0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:13px; line-height:20px; color:#9A968D;">
              Questions about this order? Reach us at
              <a href="mailto:info@canadiancladding.ca" style="color:#B3272C; text-decoration:none;">info@canadiancladding.ca</a>.
            </p>
            <p class="email-label" style="margin:0; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:11px; line-height:18px; color:#9A968D;">
              Canadian Cladding &nbsp;·&nbsp; 11158325 Canada Inc. &nbsp;·&nbsp; Ottawa, ON${footerSecondLine}
            </p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

export function formatEmailDateTime(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
