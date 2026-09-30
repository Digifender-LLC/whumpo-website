import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import wrangler from 'wrangler';
import {build} from 'esbuild';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendChat,readChat}=await module('src/chat.ts');const {default:host}=await module('src/site-host.ts');
const dir=await mkdtemp('/tmp/tellumo-publish-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
async function chat(user,content,id=crypto.randomUUID(),revision){const state=await readChat(db,user);return {id,result:await sendChat(db,user,{content,id,revision:revision??state.state.revision})};}
async function create(user,name){await chat(user,'/new');await chat(user,'A synthetic '+name+' website.');const p=await chat(user,name);const v=await chat(user,`/build ocean ${p.id}`);assert.equal(v.result.status,200);return {project:p.id,version:v.id};}
const url=id=>'https://'+id+'.whumpo.site/';
const served=id=>host.fetch(new Request(url(id)),{DB:db});
const {readTraffic,recordTraffic,cleanupTraffic,trafficDescription}=await module('src/site-traffic.ts');
const {inspectWorkspace}=await module('src/workspace-read.ts');
try{
 const user=await account(),other=await account(),a=await create(user,'Traffic fixture');
 assert.equal((await served(a.project)).status,404);assert.deepEqual((await readTraffic(db,user)).rows,[]);
 const review=await chat(user,'/publish '+a.version);await chat(user,'/confirm '+review.id);
 await Promise.all(Array.from({length:12},()=>served(a.project)));
 let report=await readTraffic(db,user);assert.equal(report.rows.length,1);assert.equal(report.rows[0].requests,12);assert.ok(report.enabledAt);
 for(const [path,method] of [['','HEAD'],['','POST'],['missing','GET'],['assets/'+crypto.randomUUID()+'.jpg','GET'],['s/'+a.project,'GET']])await host.fetch(new Request(url(a.project)+path,{method}),{DB:db});
 assert.equal((await readTraffic(db,user)).rows[0].requests,12);
 assert.deepEqual((await readTraffic(db,other)).rows,[]);
 const ctxTasks=[];const ctx={waitUntil:p=>ctxTasks.push(p)};
 assert.equal((await host.fetch(new Request(url(a.project)+'?private=query'),{DB:db},ctx)).status,200);await Promise.all(ctxTasks);assert.equal(ctxTasks.length,1);
 assert.equal((await readTraffic(db,user)).rows[0].requests,13);
 const columns=(await db.prepare('PRAGMA table_info(site_traffic_daily)').all()).results.map(r=>r.name);assert.deepEqual(columns,['project_id','day','requests']);
 assert.match(await inspectWorkspace(db,user,'traffic'),/Recorded page requests: 13/);
 const turn=await chat(user,'/traffic');assert.equal(turn.result.status,200);assert.match((await readChat(db,user)).turns.at(-1).assistant_text,/Recorded page requests: 13/);
 const cutoff=new Date();cutoff.setUTCDate(cutoff.getUTCDate()-30);await recordTraffic(db,a.project,cutoff);
 assert.equal((await readTraffic(db,user)).rows.length,1);await cleanupTraffic(db);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM site_traffic_daily').first()).n,1);
 // Counter failure must not take down an otherwise healthy page.
 const broken={prepare(sql){if(sql.startsWith('INSERT INTO site_traffic_daily'))throw Error('synthetic counter failure');return db.prepare(sql)}};
 assert.equal((await host.fetch(new Request(url(a.project)),{DB:broken})).status,200);
 assert.equal((await readTraffic(db,user)).rows[0].requests,13);
 const off=await chat(user,'/unpublish '+a.project);await chat(user,'/confirm '+off.id);assert.equal((await served(a.project)).status,404);assert.equal((await readTraffic(db,user)).rows[0].requests,13);
 await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM site_traffic_daily').first()).n,0);
 console.log('Traffic passed: live HTML only, concurrent exact counts, no identifiers, owner isolation, chat inspection, retention, deletion cascade, waitUntil and fail-open serving.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
