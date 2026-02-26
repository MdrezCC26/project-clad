/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

declare namespace NodeJS {
  interface ProcessEnv {
    // Optional SMTP (used only when sending email from the app)
    SMTP_FROM?: string;
    SMTP_USER?: string;
    SMTP_PASSWORD?: string;
    SMTP_HOST?: string;
    SMTP_PORT?: string;
    SMTP_SECURE?: string;
  }
}
