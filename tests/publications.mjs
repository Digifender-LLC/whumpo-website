import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);scopes.set(user,await authority.scope());return authority;}
const {sendChat,readChat,host}=m;
async function account(){const id=crypto.randomUUID();await accountAuthority(id);return id;}
async function chat(user,content,id=crypto.randomUUID(),revision){const state=await readChat(scope(user),user);return {id,result:await sendChat(scope(user),user,{content,id,revision:revision??state.state.revision})};}
async function create(user,name){return createFixtureProject(scope(user),user,name,'A synthetic '+name+' website.');}
const url=id=>'https://'+id+'.whumpo.site/';
const served=id=>host.fetch(new Request(url(id)),{DB:db});
try{
 const user=await account(),other=await account();const a=await create(user,'Alpha'),b=await create(user,'Beta');
 assert.equal((await served(a.project)).status,404);
 let review=await chat(user,'/publish '+a.version);assert.equal((await served(a.project)).status,404);
 await chat(other,'/confirm '+review.id);assert.equal((await served(a.project)).status,404);
 const confirmId=crypto.randomUUID(),revision=(await readChat(scope(user),user)).state.revision;
 const confirms=await Promise.all([chat(user,'/confirm '+review.id,confirmId,revision),chat(user,'/confirm '+review.id,confirmId,revision)]);assert.ok(confirms.every(x=>x.result.status===200),JSON.stringify(confirms));
 let live=await served(a.project);assert.equal(live.status,200);const original=await live.text();assert.ok(original.includes('Alpha'));assert.equal(live.headers.get('cache-control'),'no-store');assert.ok(live.headers.get('content-security-policy').includes('sandbox;'));
 assert.equal((await db.prepare('SELECT revision FROM publications WHERE project_id=?').bind(a.project).first()).revision,1);
 let second=await chat(user,'/publish '+b.version);assert.equal((await chat(user,'/confirm '+second.id)).result.status,409);assert.equal((await served(b.project)).status,404);
 // A new version remains private until exact review/confirmation.
 const newer={id:await changeFixtureWebsite(scope(user),user,a.project,[{type:'design.setTheme',theme:'forest'}])};assert.equal(await(await served(a.project)).text(),original);
 const stale=await chat(user,'/publish '+a.version);const fresh=await chat(user,'/publish '+newer.id);assert.equal((await chat(user,'/confirm '+fresh.id)).result.status,200);
 assert.notEqual(await(await served(a.project)).text(),original);assert.equal((await chat(user,'/confirm '+stale.id)).result.status,409);
 const restore=await chat(user,'/restore '+a.version);assert.equal((await chat(user,'/confirm '+restore.id)).result.status,200);assert.equal(await(await served(a.project)).text(),original);
 const off=await chat(user,'/unpublish '+a.project);assert.equal((await served(a.project)).status,200);await chat(user,'/confirm '+off.id);assert.equal((await served(a.project)).status,404);
 assert.equal((await chat(user,'/confirm '+second.id)).result.status,200);assert.equal((await served(b.project)).status,200);
 assert.equal((await host.fetch(new Request(url(a.project)+'s/'+b.project),{DB:db})).status,404);
 assert.equal((await host.fetch(new Request('https://'+b.project+'.whumpo.site.evil.example/'),{DB:db})).status,404);
 // Owner decisions Q-30 and Q-34 (November 1, 2026): after a failed renewal the customer keeps existing published sites, may still re-publish them, and gets no new site. That is what a
 // lapse already does (the quota exempts a project that is already published), so there is no grace code; this pins it. Coverage ends here by voiding the invoice (WH-042), which is immediate.
 {const u=await account(),x=await create(u,'Xray'),y=await create(u,'Yankee'),z=await create(u,'Zulu'),invoice=await paidPlan(db,u,'personal');
  for(const site of [x,y]){const r=await chat(u,'/publish '+site.version);assert.equal((await chat(u,'/confirm '+r.id)).result.status,200);}
  assert.equal((await served(y.project)).status,200);
  await db.prepare("INSERT INTO stripe_invoice_voids(invoice_id,reason,source_id,created_at) VALUES(?,'refund','ch_pin',unixepoch())").bind(invoice).run();
  const next={id:await changeFixtureWebsite(scope(u),u,x.project,[{type:'design.setTheme',theme:'clay'}])};
  const again=await chat(u,'/publish '+next.id);assert.equal((await chat(u,'/confirm '+again.id)).result.status,200,'an already-published site can still be re-published after coverage ends');
  assert.equal((await served(x.project)).status,200);assert.equal((await served(y.project)).status,200,'existing sites stay up');
  const fresh=await chat(u,'/publish '+z.version);assert.equal((await chat(u,'/confirm '+fresh.id)).result.status,409,'no new site beyond the Explore limit once coverage has ended');assert.equal((await served(z.project)).status,404);}
 // No control-plane routes or write methods on the public host.
 assert.equal((await host.fetch(new Request(url(b.project)+'api/chat'),{DB:db})).status,404);
 assert.equal((await host.fetch(new Request(url(b.project),{method:'POST'}),{DB:db})).status,405);
 assert.equal((await host.fetch(new Request(url(b.project),{method:'HEAD'}),{DB:db})).status,200);
 assert.equal((await(await host.fetch(new Request(url(b.project),{method:'HEAD'}),{DB:db})).text()),'');
 // Expired actions cannot change public state.
 const expired=crypto.randomUUID();await db.prepare("INSERT INTO publication_actions(id,user_id,project_id,kind,expected_revision,expires_at) VALUES(?,?,?,'unpublish',1,'2000-01-01T00:00:00.000Z')").bind(expired,user,b.project).run();await chat(user,'/confirm '+expired);assert.equal((await served(b.project)).status,200);
 const foreign=await chat(other,'/publish '+a.version);assert.ok((await readChat(scope(other),other)).turns.at(-1).assistant_text.includes('No matching'));
 assert.equal(await db.prepare('SELECT id FROM publication_actions WHERE id=?').bind(foreign.id).first(),null);
 await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();assert.equal((await served(b.project)).status,404);
 console.log('Publication checks passed: explicit confirmation, owner isolation, same-ID concurrency, one live site, stale/expired reviews, exact restore, unpublish, immutable previews, public route/method boundaries and account cleanup.');
}finally{await store.close();}
