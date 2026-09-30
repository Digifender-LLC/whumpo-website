import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const bundle=await build({stdin:{contents:"export * from './src/fair-use-reviews';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {openFairUseReview:open,readFairUseReview:read,resolveFairUseReview:resolve}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-fair-review-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),id=crypto.randomUUID();
 for(const user of [owner,other])await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,'test','test',?)").bind(user,user+'@example.test',new Date().toISOString()).run();
 const context={plan:'starter',category:'project_churn',reviewer:'operator-fixture',context:'Check whether the repeated sites are legitimate client work.'};
 const [a,b]=await Promise.all([open(db,owner,id,context),open(db,owner,id,context)]);
 assert.equal(Number(a.replayed)+Number(b.replayed),1);assert.deepEqual(a.review,b.review);assert.equal(a.enforcementEnabled,false);
 assert.equal(a.review.state,'open');assert.equal(a.review.revision,0);
 for(const change of [{plan:'business'},{context:'Different context'},{reviewer:'other-operator'},{category:'unrelated_chat'}])await assert.rejects(open(db,owner,id,{...context,...change}),e=>e.status===409);
 await assert.rejects(read(db,other,id),e=>e.status===404);
 await assert.rejects(open(db,other,id,context),e=>e.status===404);
 await assert.rejects(resolve(db,other,id,{revision:0,outcome:'confirmed_pattern',reviewer:'operator-fixture',resolution:'wrong owner'}),e=>e.status===404);
 const decision={revision:0,outcome:'legitimate_use',reviewer:'operator-fixture',resolution:'Customer is building client websites; exports are part of delivery.'};
 const results=await Promise.all([resolve(db,owner,id,decision),resolve(db,owner,id,{...decision,outcome:'confirmed_pattern',resolution:'Conflicting review'})].map(p=>p.then(value=>({value}),error=>({error}))));
 assert.equal(results.filter(r=>r.value).length,1);assert.equal(results.find(r=>r.error).error.status,409);
 const resolved=results.find(r=>r.value).value.review;
 const retry=await resolve(db,owner,id,{revision:0,outcome:resolved.outcome,reviewer:resolved.resolved_by,resolution:resolved.resolution});assert.equal(retry.replayed,true);assert.deepEqual(retry.review,resolved);
 assert.deepEqual((await open(db,owner,id,context)).review,resolved);
 assert.equal(resolved.state,'resolved');assert.equal(resolved.revision,1);assert.ok(resolved.resolved_at);
 for(const sql of ["UPDATE fair_use_reviews SET context='changed' WHERE id=?","UPDATE fair_use_reviews SET user_id='changed' WHERE id=?","UPDATE fair_use_reviews SET state='open',revision=0,outcome=NULL,resolution=NULL,resolved_by=NULL,resolved_at=NULL WHERE id=?","UPDATE fair_use_reviews SET resolution='changed' WHERE id=?"]){await assert.rejects(db.prepare(sql).bind(id).run());}
 const missing=crypto.randomUUID();await assert.rejects(open(db,missing,crypto.randomUUID(),context),e=>e.status===404);
 for(const change of [{plan:'explore'},{category:'heavy_usage'},{context:''},{context:'x'.repeat(2001)},{reviewer:'\0bad'}])await assert.rejects(open(db,owner,crypto.randomUUID(),{...context,...change}),e=>e.status===400);
 assert.equal((await db.prepare('SELECT count(*) n FROM fair_use_reviews').first()).n,1);
 assert.equal((await db.prepare('SELECT requested_mode FROM fair_use_control WHERE id=1').first()).requested_mode,'monitor');
 assert.equal((await db.prepare('SELECT count(*) n FROM chat_turns').first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM billing_accounts').first()).n,0);
 await db.prepare('DELETE FROM users WHERE id=?').bind(owner).run();assert.equal((await db.prepare('SELECT count(*) n FROM fair_use_reviews').first()).n,0);
 console.log('Fair-use review records passed: owner isolation, immutable scope, concurrent creation/resolution, exact lost-response replay, input limits, account deletion and unchanged Monitor/chat/billing state.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
