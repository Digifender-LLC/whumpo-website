Error.stackTraceLimit=0;
import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import wrangler from 'wrangler';
const b=await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/billing';export {readChat,sendChat} from './src/chat';"},bundle:true,format:'esm',platform:'node',write:false});
const {readUsageHistory,describeUsageHistory,getBilling,reserveUsage,dispatchUsage,finishUsage,uncertainUsage,setOverage,grantCredits,readChat,sendChat}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-usage-history-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB,id=()=>crypto.randomUUID(),hash='a'.repeat(64),owner=id(),other=id();
 for(const u of [owner,other])await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(u,u+'@example.test',new Date().toISOString()).run();
 assert.equal((await readUsageHistory(db,owner)).rows.length,0);assert.equal((await db.prepare('SELECT count(*) n FROM billing_accounts').first()).n,0,'A history lookup does not initialize billing');
 for(const page of [0,-1,1.5,1001,NaN])await assert.rejects(readUsageHistory(db,owner,page),e=>e.status===400);
 const settled=id();await reserveUsage(db,owner,settled,hash,40);await dispatchUsage(db,owner,settled);await finishUsage(db,owner,settled,40);
 await grantCredits(db,owner,id(),20,'synthetic fixture');await setOverage(db,owner,true);
 const mixed=id();await reserveUsage(db,owner,mixed,hash,15);await dispatchUsage(db,owner,mixed);await finishUsage(db,owner,mixed,15);
 const unknown=id();await reserveUsage(db,owner,unknown,hash,3);await dispatchUsage(db,owner,unknown);await uncertainUsage(db,owner,unknown);
 const reserved=id();await reserveUsage(db,owner,reserved,hash,1);
 const sent=id();await reserveUsage(db,owner,sent,hash,1);await dispatchUsage(db,owner,sent);
 for(let i=0;i<20;i++){const r=id();await reserveUsage(db,owner,r,hash,1);await finishUsage(db,owner,r,0);}
 await reserveUsage(db,other,id(),hash,3);
 const before=await getBilling(db,owner),readOnly={prepare(sql){assert.match(sql,/^SELECT /);return db.prepare(sql);}},first=await readUsageHistory(readOnly,owner),second=await readUsageHistory(readOnly,owner,2);assert.equal(first.rows.length,20);assert.ok(first.hasMore);assert.equal(second.rows.length,5);assert.equal(second.hasMore,false);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,25);
 const rows=[...first.rows,...second.rows];assert.deepEqual(rows.find(r=>r.id===mixed)&&[rows.find(r=>r.id===mixed).quota_charged,rows.find(r=>r.id===mixed).credits_charged],[10,5]);assert.equal(rows.find(r=>r.id===unknown).credits_reserved,3);assert.ok(rows.every(r=>!('request_hash' in r)&&!('user_id' in r)));
 const lastPage=await readUsageHistory({prepare:()=>({bind:()=>({all:async()=>({results:Array.from({length:21},()=>rows[0])})})})},owner,1000);assert.equal(lastPage.hasMore,false);assert.equal(lastPage.truncated,true);assert.match(describeUsageHistory(lastPage),/outside this preview history window/);
 assert.equal((await readUsageHistory(db,other)).rows.length,1);const description=describeUsageHistory({rows,page:1,hasMore:true,truncated:false});assert.match(description,/Outcome needs review/);assert.match(description,/not a final charge/);assert.match(description,/Released; no charge/);assert.match(description,/Next: \/usage-history 2/);assert.ok(!description.includes(hash));assert.deepEqual((await getBilling(db,owner)).quota,before.quota);assert.deepEqual((await getBilling(db,owner)).credits,before.credits);
 await readChat(db,owner);await db.prepare("UPDATE workspace_state SET step='ready' WHERE user_id=?").bind(owner).run();
 const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No provider calls allowed')};
 try{for(const content of ['/usage-history','show my usage history','/usage-history 2']){const state=await readChat(db,owner),input={id:id(),revision:state.state.revision,content};assert.equal((await sendChat(db,owner,input,{baseURL:'https://invalid.test/v1',apiKey:'unused',model:'unused'})).status,200);assert.equal((await sendChat(db,owner,input)).status,200);const turn=await db.prepare('SELECT mode,assistant_text FROM chat_turns WHERE id=?').bind(input.id).first();assert.equal(turn.mode,'guided');assert.match(turn.assistant_text,/Historical test-unit usage/);}
 for(const content of ['/usage-history 0','/usage-history 1 trailing']){const state=await readChat(db,owner);assert.equal((await sendChat(db,owner,{id:id(),revision:state.state.revision,content})).status,400);assert.equal((await readChat(db,owner)).state.revision,state.state.revision);}
 }finally{globalThis.fetch=originalFetch;}
 assert.deepEqual((await getBilling(db,owner)).credits,before.credits);assert.equal((await db.prepare('SELECT count(*) n FROM usage_operations WHERE user_id=?').bind(owner).first()).n,25);
 console.log('Usage history passed: read-only owner scope, exact quota/credit charges and holds, all states, deterministic pagination, no billing initialization or fingerprints, guided Chat/replay and no provider dispatch or balance changes.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
