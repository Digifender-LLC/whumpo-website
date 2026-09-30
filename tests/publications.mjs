import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import wrangler from 'wrangler';
import {build} from 'esbuild';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendChat,readChat}=await module('src/chat.ts');const {default:host}=await module('src/site-host.ts');
const dir=await mkdtemp('/tmp/whumpo-publish-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
async function chat(user,content,id=crypto.randomUUID(),revision){const state=await readChat(db,user);return {id,result:await sendChat(db,user,{content,id,revision:revision??state.state.revision})};}
async function create(user,name){await chat(user,'/new');await chat(user,'A synthetic '+name+' website.');const p=await chat(user,name);const v=await chat(user,`/build ocean ${p.id}`);assert.equal(v.result.status,200);return {project:p.id,version:v.id};}
const url=id=>'https://'+id+'.whumpo.site/';
const served=id=>host.fetch(new Request(url(id)),{DB:db});
try{
 const user=await account(),other=await account();const a=await create(user,'Alpha'),b=await create(user,'Beta');
 assert.equal((await served(a.project)).status,404);
 let review=await chat(user,'/publish '+a.version);assert.equal((await served(a.project)).status,404);
 await chat(other,'/confirm '+review.id);assert.equal((await served(a.project)).status,404);
 const confirmId=crypto.randomUUID(),revision=(await readChat(db,user)).state.revision;
 const confirms=await Promise.all([chat(user,'/confirm '+review.id,confirmId,revision),chat(user,'/confirm '+review.id,confirmId,revision)]);assert.ok(confirms.every(x=>x.result.status===200),JSON.stringify(confirms));
 let live=await served(a.project);assert.equal(live.status,200);const original=await live.text();assert.ok(original.includes('Alpha'));assert.equal(live.headers.get('cache-control'),'no-store');assert.ok(live.headers.get('content-security-policy').includes('sandbox;'));
 assert.equal((await db.prepare('SELECT revision FROM publications WHERE project_id=?').bind(a.project).first()).revision,1);
 let second=await chat(user,'/publish '+b.version);assert.equal((await chat(user,'/confirm '+second.id)).result.status,409);assert.equal((await served(b.project)).status,404);
 // A new version remains private until exact review/confirmation.
 const newer=await chat(user,'/build forest '+a.project);assert.equal(await(await served(a.project)).text(),original);
 const stale=await chat(user,'/publish '+a.version);const fresh=await chat(user,'/publish '+newer.id);assert.equal((await chat(user,'/confirm '+fresh.id)).result.status,200);
 assert.notEqual(await(await served(a.project)).text(),original);assert.equal((await chat(user,'/confirm '+stale.id)).result.status,409);
 const restore=await chat(user,'/restore '+a.version);assert.equal((await chat(user,'/confirm '+restore.id)).result.status,200);assert.equal(await(await served(a.project)).text(),original);
 const off=await chat(user,'/unpublish '+a.project);assert.equal((await served(a.project)).status,200);await chat(user,'/confirm '+off.id);assert.equal((await served(a.project)).status,404);
 assert.equal((await chat(user,'/confirm '+second.id)).result.status,200);assert.equal((await served(b.project)).status,200);
 assert.equal((await host.fetch(new Request(url(a.project)+'s/'+b.project),{DB:db})).status,404);
 assert.equal((await host.fetch(new Request('https://'+b.project+'.whumpo.site.evil.example/'),{DB:db})).status,404);
 // No control-plane routes or write methods on the public host.
 assert.equal((await host.fetch(new Request(url(b.project)+'api/chat'),{DB:db})).status,404);
 assert.equal((await host.fetch(new Request(url(b.project),{method:'POST'}),{DB:db})).status,405);
 assert.equal((await host.fetch(new Request(url(b.project),{method:'HEAD'}),{DB:db})).status,200);
 assert.equal((await(await host.fetch(new Request(url(b.project),{method:'HEAD'}),{DB:db})).text()),'');
 // Expired actions cannot change public state.
 const expired=crypto.randomUUID();await db.prepare("INSERT INTO publication_actions(id,user_id,project_id,kind,expected_revision,expires_at) VALUES(?,?,?,'unpublish',1,'2000-01-01T00:00:00.000Z')").bind(expired,user,b.project).run();await chat(user,'/confirm '+expired);assert.equal((await served(b.project)).status,200);
 const foreign=await chat(other,'/publish '+a.version);assert.ok((await readChat(db,other)).turns.at(-1).assistant_text.includes('No matching'));
 assert.equal(await db.prepare('SELECT id FROM publication_actions WHERE id=?').bind(foreign.id).first(),null);
 await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();assert.equal((await served(b.project)).status,404);
 console.log('Publication checks passed: explicit confirmation, owner isolation, same-ID concurrency, one live site, stale/expired reviews, exact restore, unpublish, immutable previews, public route/method boundaries and account cleanup.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
