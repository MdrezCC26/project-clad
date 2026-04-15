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
    /** Comma-separated staff inboxes for new-order notifications (in addition to project owner / actor). */
    PROJECTCLAD_ORDER_NOTIFY_EMAIL?: string;
    /**
     * Optional. Numeric Shopify customer IDs (comma-separated) that always get app-admin
     * access if the Customer `admin` tag is not visible via API (e.g. API quirks).
     */
    PROJECTCLAD_APP_ADMIN_CUSTOMER_IDS?: string;
    /**
     * Optional. Comma/newline-separated emails with global storefront staff access
     * (matched to signed `logged_in_customer_email`, case-insensitive).
     */
    PROJECTCLAD_GLOBAL_STAFF_EMAILS?: string;
    /**
     * Comma/newline/semicolon-separated emails allowed to change **line unit prices** on the
     * storefront project page (`save-order-edit`). Must match signed-in customer email (case-insensitive).
     * When unset, unit price changes are rejected until configured.
     */
    PROJECTCLAD_UNIT_PRICE_EDITOR_EMAILS?: string;
    /** Set to "1" to log staff-access checks (shop + viewer id) on the server. */
    PROJECTCLAD_DEBUG_STAFF?: string;
  }
}
