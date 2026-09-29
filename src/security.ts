const encoder = new TextEncoder();
// Cloudflare's deployed Web Crypto runtime caps PBKDF2 at 100,000 iterations.
// A separately stored server pepper protects against offline database-only attacks.
const iterations = 100_000;
const hashPrefix = "pbkdf2-sha256:100000:hmac-sha256:v1:";

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) throw new Error("Invalid hex");
  return Uint8Array.from(hex.match(/../g)!, (part) => Number.parseInt(part, 16));
}

export async function hashPassword(password: string, pepper: string, salt?: string): Promise<{ salt: string; hash: string }> {
  if (pepper.length < 32) throw new Error("Password pepper is not configured");
  const saltBytes = salt ? fromHex(salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = new ArrayBuffer(saltBytes.length);
  new Uint8Array(saltBuffer).set(saltBytes);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBuffer, iterations, hash: "SHA-256" }, key, 256);
  const pepperKey = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const protectedHash = await crypto.subtle.sign("HMAC", pepperKey, derived);
  return { salt: toHex(saltBytes), hash: hashPrefix + toHex(new Uint8Array(protectedHash)) };
}

export async function verifyPassword(password: string, salt: string, expected: string, pepper: string): Promise<boolean> {
  const actual = await hashPassword(password, pepper, salt);
  if (!expected.startsWith(hashPrefix)) return false;
  const a = fromHex(actual.hash.slice(hashPrefix.length));
  const b = fromHex(expected.slice(hashPrefix.length));
  if (a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export function newSessionToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}
