import prisma from "../db.server";
import { sendEmail, type SendEmailOptions } from "./email.server";
import { shopStringFilter } from "./projectAccess.server";

/** CID referenced from HTML `<img src="cid:…">` (nodemailer inline attachment). */
const LOGO_CID = "projectclad-logo@transactional";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainTextToHtmlBody(text: string): string {
  return escapeHtml(text).replace(/\r\n/g, "\n").split("\n").join("<br />\n");
}

function parseDataUrlToInlineImage(dataUrl: string): {
  buffer: Buffer;
  mime: string;
  ext: string;
} | null {
  const t = dataUrl.trim();
  if (!t.toLowerCase().startsWith("data:")) return null;
  const lower = t.toLowerCase();
  const marker = ";base64,";
  const idx = lower.indexOf(marker);
  if (idx === -1) return null;
  /** MIME is first segment before any `;` (e.g. `image/png` vs `image/png;charset=utf-8`). */
  const meta = t.slice("data:".length, idx);
  const mime = meta.split(";")[0]?.trim() || "image/png";
  const b64 = t.slice(idx + marker.length).replace(/\s/g, "");
  try {
    const buffer = Buffer.from(b64, "base64");
    if (!buffer.length) return null;
    const ml = mime.toLowerCase();
    const ext =
      ml.includes("jpeg") || ml === "image/jpg"
        ? "jpg"
        : ml.includes("webp")
          ? "webp"
          : ml.includes("gif")
            ? "gif"
            : "png";
    return { buffer, mime, ext };
  } catch {
    return null;
  }
}

export async function getShopLogoDataUrlForEmail(
  shop: string,
): Promise<string | null> {
  try {
    const row = await prisma.shopSettings.findFirst({
      where: { shop: shopStringFilter(shop) },
      select: { logoDataUrl: true },
    });
    const v = row?.logoDataUrl?.trim();
    return v || null;
  } catch (err) {
    console.warn(
      "[transactionalEmail] could not load shop logo:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export function buildTransactionalHtmlAndAttachments(
  plainText: string,
  logoDataUrl: string | null,
): { html: string; attachments?: NonNullable<SendEmailOptions["attachments"]> } {
  const parsed = logoDataUrl ? parseDataUrlToInlineImage(logoDataUrl) : null;
  const logoBlock = parsed
    ? `<p style="margin:0 0 20px 0;line-height:0"><img src="cid:${LOGO_CID}" alt="Canadian Cladding PROJECTS" width="260" style="max-width:100%;height:auto;border:0;display:block" /></p>`
    : `<p style="margin:0 0 16px 0;font-size:14px;font-weight:600;color:#222;letter-spacing:0.02em">Canadian Cladding PROJECTS</p>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:16px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
<div style="max-width:640px">
${logoBlock}
<div>${plainTextToHtmlBody(plainText)}</div>
</div>
</body>
</html>`;

  if (!parsed) {
    return { html };
  }
  return {
    html,
    attachments: [
      {
        filename: `logo.${parsed.ext}`,
        content: parsed.buffer,
        cid: LOGO_CID,
        contentDisposition: "inline" as const,
        contentType: parsed.mime,
      },
    ],
  };
}

/**
 * Sends multipart HTML + plain text, with shop logo from Admin settings when configured.
 */
export async function sendTransactionalEmail(args: {
  shop: string;
  to: string;
  subject: string;
  text: string;
  extraAttachments?: SendEmailOptions["attachments"];
}): Promise<void> {
  const logoDataUrl = await getShopLogoDataUrlForEmail(args.shop);
  const { html, attachments: logoAttachments } =
    buildTransactionalHtmlAndAttachments(args.text, logoDataUrl);
  const merged = [...(logoAttachments ?? []), ...(args.extraAttachments ?? [])];
  const attachmentPayload = merged.length ? { attachments: merged } : {};

  try {
    await sendEmail({
      to: args.to,
      subject: args.subject,
      text: args.text,
      html,
      ...attachmentPayload,
    });
  } catch (err) {
    console.error(
      "[transactionalEmail] send with HTML/logo failed; retrying text-only:",
      err instanceof Error ? err.message : err,
    );
    await sendEmail({
      to: args.to,
      subject: args.subject,
      text: args.text,
      ...(args.extraAttachments?.length
        ? { attachments: args.extraAttachments }
        : {}),
    });
  }
}

/**
 * One message per address (avoids some SMTP servers rejecting multi-recipient `To:`).
 * @returns how many messages were accepted by SMTP (0 if every attempt failed).
 */
export async function sendTransactionalEmailToRecipients(args: {
  shop: string;
  recipients: string[];
  subject: string;
  text: string;
  extraAttachments?: SendEmailOptions["attachments"];
}): Promise<number> {
  const seen = new Set<string>();
  let ok = 0;
  for (const raw of args.recipients) {
    const to = raw.trim();
    if (!to) continue;
    const key = to.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await sendTransactionalEmail({
        shop: args.shop,
        to,
        subject: args.subject,
        text: args.text,
        extraAttachments: args.extraAttachments,
      });
      ok += 1;
    } catch (err) {
      console.error(
        `[transactionalEmail] failed for recipient ${to}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return ok;
}
