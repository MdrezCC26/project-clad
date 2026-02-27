import nodemailer from "nodemailer";

const from =
  process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@localhost";
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASSWORD;
const host = process.env.SMTP_HOST || "localhost";
const port = Number(process.env.SMTP_PORT) || 587;
const secure = process.env.SMTP_SECURE === "true";

export function isEmailConfigured(): boolean {
  return Boolean(
    user && pass && process.env.SMTP_HOST?.trim(),
  );
}

/** Which SMTP env vars are set (for debugging, no values). */
export function getSmtpConfigStatus(): {
  SMTP_USER: boolean;
  SMTP_PASSWORD: boolean;
  SMTP_HOST: boolean;
} {
  return {
    SMTP_USER: Boolean(process.env.SMTP_USER),
    SMTP_PASSWORD: Boolean(process.env.SMTP_PASSWORD),
    SMTP_HOST: Boolean(process.env.SMTP_HOST),
  };
}

export type SendEmailOptions = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; content: string | Buffer }>;
};

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  if (!user || !pass) {
    throw new Error(
      "SMTP not configured. Set SMTP_USER and SMTP_PASSWORD in .env.",
    );
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text ?? undefined,
    html: options.html ?? undefined,
    attachments: options.attachments ?? undefined,
  });
}
