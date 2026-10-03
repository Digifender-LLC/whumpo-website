const encoder = new TextEncoder();
function toHex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function newSessionToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}
export async function hashToken(token: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))));
}
