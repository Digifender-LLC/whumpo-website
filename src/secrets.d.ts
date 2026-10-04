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
  STRIPE_WEBHOOK_SECRET?: string;
  // Owner-supplied, non-secret support values. Unset means not configured; never invent defaults.
  SUPPORT_CONTACT?: string;
  SUPPORT_HOURS?: string;
  SUPPORT_NOTIFICATION_PROVIDER?: string;
  SUPPORT_NOTIFICATION_REVIEW?: string;
}
