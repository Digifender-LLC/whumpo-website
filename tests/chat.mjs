import assert from 'node:assert/strict';
const base = process.env.TELLUMO_TEST_URL || 'http://127.0.0.1:8787';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
async function register() {
  const r = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: {origin:base, 'content-type':'application/json'}, body:JSON.stringify({email:`chat-${crypto.randomUUID()}@example.com`,password:'correct horse battery staple'}) });
  assert.equal(r.status, 200, await r.text());
  return r.headers.get('set-cookie').split(';')[0];
}
const owner = await register(), other = await register();
async function get(cookie, path='/chat') { const r=await fetch(`${base}/api${path}`,{headers:{cookie}}); assert.equal(r.status,200); return r.json(); }
async function send(content, revision, id=crypto.randomUUID(), cookie=owner) { return fetch(`${base}/api/chat`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({content,revision,id})}); }
assert.equal((await get(owner)).turns.length,0);
assert.equal((await send('A bakery for my neighborhood',0)).status,200);
assert.equal((await get(owner)).state.step,'name');
const id=crypto.randomUUID();
const retries=await Promise.all([send('Bread & Butter',1,id),send('Bread & Butter',1,id)]);
assert.ok(retries.every(r=>r.status===200));
assert.equal((await get(owner,'/projects')).projects.length,1);
assert.equal((await get(owner)).turns.length,2);
assert.equal((await get(other)).turns.length,0);
assert.equal((await get(other,'/projects')).projects.length,0);
assert.equal((await send('Different payload',1,id)).status,409);
assert.equal((await send('/plans',0)).status,409);
const concurrent=await Promise.all([send('/plans',2),send('/projects',2)]);
assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
assert.equal((await get(owner)).state.revision,3);
assert.equal((await send('/new',3)).status,200);
assert.equal((await send('My second idea',4)).status,200);
assert.equal((await get(owner)).state.step,'name');
assert.equal((await send('/plans',5)).status,200);
assert.equal((await get(owner)).state.step,'name');
assert.equal((await send('My second site',6)).status,200);
assert.equal((await get(owner,'/projects')).projects.length,2);
assert.equal((await fetch(`${base}/api/chat`)).status,401);
console.log('Chat checks passed: persisted onboarding, tenant isolation, duplicate replay, conflicting tabs, and commands during onboarding.');
