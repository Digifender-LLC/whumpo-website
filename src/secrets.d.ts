// Wrangler generates resource binding types; secret values are set separately.
interface Env {
  CLOUDFLARE_CLIENT_ID?: string;
  CLOUDFLARE_CLIENT_SECRET?: string;
  CLOUDFLARE_DOMAINS_TOKEN?: string;
  DOMAIN_HOSTING_READY?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  CONNECTION_ENCRYPTION_KEYRING?: string;
  CMS_BRIDGE_MASTER_KEY?: string;
  TURNSTILE_SECRET?: string;
  AI_API_KEY?: string;
  STRIPE_SANDBOX_CATALOG?: string;
  STRIPE_TEST_KEY?: string;
  // Live account key held unread while checkout is blocked (Q-007); no code reads it.
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // WH-086 FCM sender service-account JSON (send-only role); read by the push adapter once it lands.
  FCM_SERVICE_ACCOUNT_JSON?: string;
  // Owner activation of push delivery and device registration. Only the value 'fcm' activates; unset means inactive (WH-086).
  PUSH_NOTIFICATION_PROVIDER?: string;
  // Owner-supplied, non-secret support values. Unset means not configured; never invent defaults.
  SUPPORT_HOURS?: string;
  SUPPORT_NOTIFICATION_PROVIDER?: string;
  SUPPORT_NOTIFICATION_REVIEW?: string;
  // WH-036 owner activation of contact notices (docs/contact-forms.md). All three unset means inactive.
  CONTACT_NOTIFICATION_PROVIDER?: string;
  CONTACT_NOTIFICATION_REVIEW?: string;
  // WH-158 owner's monthly spending limit for customer-configured notices, whole cents. Unset means every configured notice is cancelled at send time (ceiling-unset).
  NOTIFICATION_CUSTOMER_CEILING_CENTS?: string;
  CONTACT_EMAIL?: SendEmail;
}
