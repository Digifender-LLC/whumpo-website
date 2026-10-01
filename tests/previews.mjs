import assert from 'node:assert/strict';
const base='http://localhost:8787';
async function account(){const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email:`preview-${crypto.randomUUID()}@example.com`,password:'correct horse battery staple'})});assert.equal(r.status,200,await r.text());return r.headers.get('set-cookie').split(';')[0];}
const owner=await account(),other=await account();
async function request(path,cookie=owner,data){return fetch(base+'/api'+path,{method:data?'POST':'GET',headers:{cookie,origin:base,'content-type':'application/json'},body:data?JSON.stringify(data):undefined});}
async function send(content,revision,id=crypto.randomUUID()){return request('/chat',owner,{id,content,revision});}
assert.equal((await send('A bakery <script>alert(document.cookie)</script>',0)).status,200);
assert.equal((await send('Bread & Butter',1)).status,200);
const id=crypto.randomUUID();
const pair=await Promise.all([send('/build',2,id),send('/build',2,id)]);assert.ok(pair.every(r=>r.status===200));
const chat=await(await request('/chat')).json();assert.equal(chat.state.revision,3);assert.equal(chat.turns.at(-1).version_id,id);
const preview=await request(`/site-versions/${id}/preview`);assert.equal(preview.status,200);
assert.ok(preview.headers.get('content-security-policy').startsWith('sandbox;'));
assert.ok(preview.headers.get('cache-control').includes('no-store'));
const html=await preview.text();assert.ok(html.includes('Bread &amp; Butter'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
assert.equal((await request(`/site-versions/${id}/preview`,other)).status,404);
assert.equal((await fetch(base+`/api/site-versions/${id}/preview`)).status,401);
const projects=await(await request('/projects')).json();const project=projects.projects[0].id;
assert.equal((await request(`/projects/${project}/versions`,other)).status,404);
let versions=await(await request(`/projects/${project}/versions`)).json();assert.equal(versions.versions.length,1);
assert.equal((await send('/build clay',3)).status,200);
assert.equal(await(await request(`/site-versions/${id}/preview`)).text(),html);
assert.equal((await send(`/build ocean ${project}`,0)).status,409);
assert.equal((await send('/build javascript:evil',4)).status,400);
const billing=await(await request('/billing')).json();assert.equal(billing.standardAI.creditCharge,0);assert.equal(billing.standardAI.creditCharge,0);
const catalog=await(await request('/components')).json();assert.ok(!JSON.stringify(catalog).includes('Bread'));assert.ok(!JSON.stringify(catalog).includes('bakery'));
for(let revision=4;revision<27;revision++)assert.equal((await send('/build forest',revision)).status,200);
assert.equal((await send('/build',27)).status,409);
assert.equal((await(await request('/chat')).json()).state.revision,27);
versions=await(await request(`/projects/${project}/versions`)).json();assert.equal(versions.versions.length,25);
console.log('Preview checks passed: same-ID concurrency, immutable rendering, tenant isolation, HTML escaping, sandbox/no-store headers, catalog isolation, free assembly, invalid configuration, quota rollback.');
