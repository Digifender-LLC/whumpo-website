// Wrangler generates resource binding types; secret values are set separately.
interface Env {
  TURNSTILE_SECRET?: string;
  PASSWORD_PEPPER?: string;
  AI_API_KEY?: string;
}
