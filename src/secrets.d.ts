// Wrangler generates resource binding types; secret values are set separately.
interface Env {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  CONNECTION_ENCRYPTION_KEY?: string;
  TURNSTILE_SECRET?: string;
  PASSWORD_PEPPER?: string;
  AI_API_KEY?: string;
  STRIPE_TEST_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}
