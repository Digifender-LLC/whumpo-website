import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import wrangler from 'wrangler';
const b=await build({stdin:{contents:"export * from './src/chat';export * from './src/domains';export * from './src/site-agent';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {sendChat,sendChatControl,readChat,listDomains,prepareSiteAction,siteContext}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-proof-removal-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const now=()=>new Date().toISOString();
async function account(){const id=crypto.randomUUID(),project=crypto.randomUUID();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(id,id+'@example.test',now()).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Domain fixture','Testing','draft',?,?)").bind(project,id,now(),now()).run();return {id,project};}
async function chat(a,content){const state=await readChat(db,a.id),input={id:crypto.randomUUID(),revision:state.state.revision,content};return {id:input.id,input,result:await sendChat(db,a.id,input)};}
async function confirm(a,reviewId){const input={id:crypto.randomUUID(),revision:(await readChat(db,a.id)).state.revision,action:{type:'confirm',kind:'domainProof',reviewId}};return {id:input.id,input,result:await sendChatControl(db,a.id,input)};}
const present=id=>db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(id).first();
async function claim(a,name='www.example.com'){return chat(a,'/domain '+name+' '+a.project)}
try{
 const owner=await account(),other=await account(),c=await claim(owner),r=await chat(owner,'/remove-domain-proof '+c.id);
 assert.ok(await present(c.id));assert.equal((await readChat(db,owner.id)).turns.at(-1).domain_proof_confirmation_id,r.id);
 await confirm(other,r.id);assert.ok(await present(c.id));
 await assert.rejects(db.prepare('DELETE FROM domain_claims WHERE id=?').bind(c.id).run(),/domain_proof_removal_unreviewed/);
 await assert.rejects(prepareSiteAction(db,owner.id,crypto.randomUUID(),JSON.stringify({reply:'Remove',action:{kind:'domain',operation:'confirmRemoval',claimId:c.id}}),await siteContext(db,owner.id)));
 const confirmed=await confirm(owner,r.id);assert.equal(confirmed.result.status,200);assert.equal(await present(c.id),null);
 assert.equal((await sendChatControl(db,owner.id,confirmed.input)).status,200);await confirm(owner,r.id);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE action='domain.proof.removed'").first()).n,1);assert.equal((await listDomains(db,owner.id)).domains.length,0);
 // Same hostname can be added again with a new identity and proof; old messages cannot revive it.
 const replacement=await claim(owner);assert.notEqual((await present(replacement.id)).token,(await db.prepare('SELECT proof_token FROM domain_proof_removals WHERE id=?').bind(r.id).first()).proof_token);await sendChat(db,owner.id,c.input);assert.equal(await present(c.id),null);
 // A renewed proof invalidates the prior review atomically, including its Chat button.
 const renewal=await chat(owner,'/remove-domain-proof '+replacement.id);await db.prepare('UPDATE domain_claims SET token=? WHERE id=?').bind('renewed-token',replacement.id).run();
 assert.equal((await confirm(owner,renewal.id)).result.status,409);assert.ok(await present(replacement.id));assert.equal((await readChat(db,owner.id)).turns.find(t=>t.id===renewal.id).domain_proof_confirmation_id,null);
 // A hosting review arriving after removal review retains the proof and rolls back confirmation.
 const retain=await chat(owner,'/remove-domain-proof '+replacement.id);
 await db.prepare("INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,created_at,expires_at) VALUES(?,?,?,?,?,'zone','target','hash','review',?,?)").bind(crypto.randomUUID(),owner.id,replacement.id,owner.project,'www.example.com',now(),new Date(Date.now()+600000).toISOString()).run();
 assert.equal((await confirm(owner,retain.id)).result.status,409);assert.ok(await present(replacement.id));assert.equal((await db.prepare('SELECT status FROM domain_proof_removals WHERE id=?').bind(retain.id).first()).status,'pending');
 const blocked=await chat(owner,'/remove-domain-proof '+replacement.id);assert.equal(await db.prepare('SELECT id FROM domain_proof_removals WHERE id=?').bind(blocked.id).first(),null);
 // DNS recovery rows created after review must also survive removal attempts.
 const dnsClaim=await claim(owner,'dns.example.com'),dnsReview=await chat(owner,'/remove-domain-proof '+dnsClaim.id);
 await db.prepare("INSERT INTO cloudflare_dns_actions(id,user_id,claim_id,project_id,token_id,zone_id,zone_name,record_name,content,inventory_hash,created_at,expires_at) VALUES(?,?,?,?,'token','zone','example.com','_tellumo.dns.example.com','proof','hash',?,?)").bind(crypto.randomUUID(),owner.id,dnsClaim.id,owner.project,now(),new Date(Date.now()+600000).toISOString()).run();
 assert.equal((await confirm(owner,dnsReview.id)).result.status,409);assert.ok(await present(dnsClaim.id));assert.equal((await db.prepare('SELECT COUNT(*) n FROM cloudflare_dns_actions WHERE claim_id=?').bind(dnsClaim.id).first()).n,1);
 // Two simultaneous confirmations share a conversation revision; only one can commit.
 const second=await claim(owner,'two.example.com'),review=await chat(owner,'/remove-domain-proof '+second.id),state=await readChat(db,owner.id);
 const results=await Promise.all([1,2].map(()=>sendChatControl(db,owner.id,{id:crypto.randomUUID(),revision:state.state.revision,action:{type:'confirm',kind:'domainProof',reviewId:review.id}})));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(await present(second.id),null);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE action='domain.proof.removed'").first()).n,2);assert.equal((await db.prepare('SELECT count(*) n FROM standard_ai_requests WHERE user_id=?').bind(owner.id).first()).n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM publications').first()).n,0);
 console.log('Domain proof removal passed: explicit owner confirmation, no raw/model deletion, stale renewal, hosting race rollback, replay, concurrent confirmation, fresh re-add, preserved provider history and no inference/publication.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
