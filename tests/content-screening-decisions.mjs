Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const b=await build({entryPoints:['src/content-screening-decisions.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {reserveContentScreening}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-screening-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB,now=Date.now(),userId=crypto.randomUUID(),other=crypto.randomUUID(),key='12'.repeat(32);
 for(const u of [userId,other])await db.prepare("INSERT INTO users VALUES(?,?,'fixture','fixture',?)").bind(u,u+'@example.test',new Date().toISOString()).run();
 const history={userId,complete:true,events:Array.from({length:28},(_,i)=>({userId,incidentId:'b-'+i,kind:'verified_benign',disposition:'active',occurredAt:now-(i%7)*86400000}))};
 const target={userId,kind:'chat_text',digest:'a'.repeat(64)};
 const first=await reserveContentScreening(db,history,target,undefined,now);assert.equal(first.required,true);
 const retry=await reserveContentScreening(db,history,target,key,now);assert.equal(retry.required,true);assert.equal(retry.reason,'sampling_unavailable');assert.equal(retry.permissionGranted,false);
 assert.equal((await db.prepare('SELECT count(*) n FROM content_screening_decisions').first()).n,1);
 await assert.rejects(()=>reserveContentScreening(db,history,{...target,userId:other},key,now));
 await assert.rejects(()=>db.prepare('UPDATE content_screening_decisions SET required=0').run());
 let skipped;
 for(let i=1;i<=100;i++){
  const t={...target,digest:i.toString(16).padStart(64,'0')};
  if(!(await reserveContentScreening(db,history,t,key,now)).required){skipped=t;break;}
 }
 assert.ok(skipped);
 const race=await Promise.all([reserveContentScreening(db,{...history,currentContentFlag:true},skipped,key,now),reserveContentScreening(db,history,skipped,key,now)]);
 assert.ok(race.some(r=>r.required));
 const sticky=await reserveContentScreening(db,history,skipped,key,now);assert.equal(sticky.required,true);assert.equal(sticky.escalated,true);
 const lostDB=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{await target.batch(statements);throw Error('Synthetic lost response');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const lost=await reserveContentScreening(lostDB,history,{...target,kind:'media'},key,now);assert.equal(lost.recovered,true);assert.equal(lost.required,true);
 const failedDB=new Proxy(db,{get(target,key){if(key==='batch')return async()=>{throw Error('Synthetic storage failure');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(()=>reserveContentScreening(failedDB,history,{...target,kind:'imported_code'},key,now),e=>e.status===503);
 const foreignHistory={...history,userId:other,events:[]};assert.equal((await reserveContentScreening(db,foreignHistory,{...target,userId:other},undefined,now)).required,true);
 assert.equal((await db.prepare('SELECT count(*) n FROM content_screening_decisions WHERE user_id=?').bind(other).first()).n,1);
 await assert.rejects(()=>db.prepare("UPDATE content_screening_decisions SET digest=? WHERE user_id=?").bind('f'.repeat(64),userId).run());
 console.log('Persistent screening passed: sticky selection, escalation, tenant isolation, concurrent retries, immutable scope, lost response recovery, database failure holds, and no execution permission.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
