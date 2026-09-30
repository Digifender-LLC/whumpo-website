import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const code=await build({entryPoints:['src/standard-ai-usage.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {reserveStandardAI,readStandardAI,dispatchStandardAI,markStandardAIUncertain,completeStandardAI,cancelStandardAI}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-standard-ai-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
try{
 const user=crypto.randomUUID(),other=crypto.randomUUID(),id=crypto.randomUUID(),hash='a'.repeat(64),now=new Date().toISOString();
 for(const owner of [user,other])await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(owner,owner+'@example.test',now).run();
 const reservations=await Promise.all([reserveStandardAI(db,user,id,hash),reserveStandardAI(db,user,id,hash)]);
 assert.equal(reservations.filter(r=>r.created).length,1);
 assert.equal(await readStandardAI(db,other,id),null);
 await assert.rejects(()=>reserveStandardAI(db,other,id,hash),/identity/);
 await assert.rejects(()=>reserveStandardAI(db,user,id,'b'.repeat(64)),/identity/);
 assert.equal(await dispatchStandardAI(db,other,id),false);
 const dispatched=await Promise.all([dispatchStandardAI(db,user,id),dispatchStandardAI(db,user,id)]);assert.equal(dispatched.filter(Boolean).length,1);
 await markStandardAIUncertain(db,user,id);await assert.rejects(()=>cancelStandardAI(db,user,id),/dispatched/);
 assert.equal(await dispatchStandardAI(db,user,id),false);
 const settled=await completeStandardAI(db,user,id,3000,450);assert.equal(settled.state,'completed');
 assert.deepEqual(await completeStandardAI(db,user,id,3000,450),settled);
 await assert.rejects(()=>completeStandardAI(db,user,id,3000,451),/conflicts/);
 assert.equal((await reserveStandardAI(db,user,id,hash)).created,false);
 await assert.rejects(()=>db.prepare("UPDATE standard_ai_requests SET request_hash=? WHERE id=?").bind('b'.repeat(64),id).run());
 for(const n of [-1,NaN,Infinity,1.1,Number.MAX_SAFE_INTEGER+1])await assert.rejects(()=>completeStandardAI(db,user,id,n,1));
 const cancelled=crypto.randomUUID();await reserveStandardAI(db,user,cancelled,hash);await cancelStandardAI(db,user,cancelled);await cancelStandardAI(db,user,cancelled);assert.equal(await dispatchStandardAI(db,user,cancelled),false);
 const racing=crypto.randomUUID();await reserveStandardAI(db,user,racing,hash);const race=await Promise.allSettled([dispatchStandardAI(db,user,racing),cancelStandardAI(db,user,racing)]);const final=await readStandardAI(db,user,racing);assert.ok(['dispatched','released'].includes(final.state));assert.equal(race[0].value,final.state==='dispatched');assert.equal(race[1].status,final.state==='released'?'fulfilled':'rejected');
 // Even without any billing account or allowance, standard receipts complete without charging.
 for(const table of ['billing_accounts','usage_periods','usage_operations','billing_ledger','credit_grants','inference_calls'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0,table);
 console.log('Standard AI receipts passed: duplicate/competing admission, owner isolation, dispatch/cancel race, uncertain-result retention, exact completion replay, immutable identity and zero customer/provider ledger mutation.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
