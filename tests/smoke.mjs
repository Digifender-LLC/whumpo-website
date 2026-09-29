import assert from "node:assert/strict";

const base = process.env.TELLUMO_TEST_URL || "http://127.0.0.1:8787";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Run this signup smoke test locally; deployed signup requires real Turnstile verification.");
const headers = { origin: base, "content-type": "application/json" };
const suffix = crypto.randomUUID();

async function register(prefix) {
  const response = await fetch(`${base}/api/auth/register`, {
    method: "POST", headers,
    body: JSON.stringify({ email: `${prefix}-${suffix}@example.com`, password: "correct horse battery staple" })
  });
  assert.equal(response.status, 200, await response.text());
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("tellumo_session="));
  return cookie;
}

assert.equal((await fetch(`${base}/api/health`)).status, 200);
const owner = await register("owner");
const other = await register("other");
const created = await fetch(`${base}/api/projects`, {
  method: "POST", headers: { ...headers, cookie: owner },
  body: JSON.stringify({ name: "Private site", purpose: "Tenant isolation check" })
});
assert.equal(created.status, 201);
const { project } = await created.json();
assert.equal((await fetch(`${base}/api/projects/${project.id}`, { headers: { cookie: owner } })).status, 200);
assert.equal((await fetch(`${base}/api/projects/${project.id}`, { headers: { cookie: other } })).status, 404);
assert.equal((await fetch(`${base}/api/projects/${project.id}`)).status, 401);
const denied = await fetch(`${base}/api/projects`, {
  method: "POST", headers: { ...headers, origin: "https://invalid.example", cookie: owner },
  body: JSON.stringify({ name: "Rejected" })
});
assert.equal(denied.status, 403);
const activity = await fetch(`${base}/api/activity`, { headers: { cookie: owner } });
assert.equal(activity.status, 200);
assert.ok((await activity.json()).activity.some((event) => event.action === "project.created"));
// Quota must hold even when requests arrive together.
const batch = await Promise.all(Array.from({ length: 22 }, (_, index) => fetch(`${base}/api/projects`, {
  method: "POST", headers: { ...headers, cookie: owner }, body: JSON.stringify({ name: `Quota ${index}` })
})));
assert.equal(batch.filter((response) => response.status === 201).length, 19);
assert.equal(batch.filter((response) => response.status === 409).length, 3);
assert.equal((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...headers, cookie: owner } })).status, 200);
assert.equal((await fetch(`${base}/api/me`, { headers: { cookie: owner } })).status, 401);
const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers, body: JSON.stringify({ email: `owner-${suffix}@example.com`, password: "correct horse battery staple" }) });
assert.equal(login.status, 200);
console.log("Smoke checks passed: auth, tenant isolation, origin, activity, concurrent quota, logout, login");
