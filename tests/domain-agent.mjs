import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendAIChat,reconcileChat}=await module('src/ai-chat.ts');const {readChat}=await module('src/chat.ts');const {getBilling}=await module('src/billing.ts');
const dir=await mkdtemp('/tmp/tellumo-domain-agent-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
const cfg={baseURL:'https://provider.test/v1',apiKey:'fake-key',model:'fake-model',protocol:'responses'};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(id).run();const project=crypto.randomUUID();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Bakery','Fresh bread','draft',?,?)").bind(project,id,new Date().toISOString(),new Date().toISOString()).run();return {id,project};}
const {siteContext}=await module('src/site-agent.ts');
let calls=0,dnsCalls=0,mode='match';const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(new URL(url instanceof Request?url.url:url).hostname!=='cloudflare-dns.com')return realFetch(url,options);
 dnsCalls++;assert.equal(options.redirect,'manual');if(mode==='fail')return new Response('unavailable',{status:503});
 const name=new URL(url).searchParams.get('name'),row=await db.prepare('SELECT token FROM domain_claims WHERE hostname=?').bind(name.slice(9)).first();
 return Response.json({Status:0,Answer:[{name:name+'.',type:16,data:JSON.stringify(mode==='match'?'tellumo-verification='+row.token:'wrong')}]});
};
const provider=action=>async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'I connected your domain and bought it.',action})}]}],usage:{input_tokens:100,output_tokens:200}});};
async function send(user,action,database=db){const state=await readChat(db,user.id),id=crypto.randomUUID();await sendAIChat(database,user.id,id,state.state.revision,'Help with my domain',cfg,provider(action));return {id,revision:state.state.revision,turn:(await readChat(db,user.id)).turns.at(-1)};}
try{
 const owner=await account(),other=await account();
 const prepare={kind:'domain',operation:'prepare',projectId:owner.project,hostname:'WWW.EXAMPLE.COM'};
 const created=await send(owner,prepare);assert.equal(created.turn.status,'completed');assert.match(created.turn.assistant_text,/TXT record/);assert.ok(!created.turn.assistant_text.includes('bought'));assert.match(created.turn.assistant_text,/does not change hosting/);
 let row=await db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(created.id).first();assert.equal(row.project_id,owner.project);assert.equal(row.hostname,'www.example.com');
 const context=await siteContext(db,owner.id);assert.equal(context.domains[0].id,created.id);assert.ok(!JSON.stringify(context).includes(row.token));assert.equal((await siteContext(db,other.id)).domains.length,0);
 const priorCalls=calls;await sendAIChat(db,owner.id,created.id,created.revision,'Help with my domain',cfg,provider(prepare));assert.equal(calls,priorCalls);
 await send(owner,prepare);assert.equal((await db.prepare('SELECT COUNT(*) n FROM domain_claims WHERE project_id=?').bind(owner.project).first()).n,1);
 const check={kind:'domain',operation:'check',claimId:created.id},checked=await send(owner,check);assert.match(checked.turn.assistant_text,/Ownership of www.example.com verified/);assert.equal(dnsCalls,1);
 await sendAIChat(db,owner.id,checked.id,checked.revision,'Help with my domain',cfg,provider(check));assert.equal(dnsCalls,1);
 mode='wrong';await send(owner,check);assert.equal((await db.prepare('SELECT verified_at FROM domain_claims WHERE id=?').bind(created.id).first()).verified_at,null);
 mode='fail';const before=await getBilling(db,owner.id);const failed=await send(owner,check);assert.equal(failed.turn.status,'failed');assert.match(failed.turn.assistant_text,/DNS could not be checked/);assert.equal((await getBilling(db,owner.id)).quota.spent,before.quota.spent);assert.equal((await getBilling(db,owner.id)).quota.reserved,0);mode='match';
 for(const [user,action] of [[other,check],[other,prepare],[owner,{...prepare,hostname:'https://evil.com/path'}],[owner,{...prepare,hostname:'a.com /verify-domain x'}],[owner,{...prepare,url:'https://evil.com'}],[owner,{...check,token:'invented'}],[owner,{kind:'domain',operation:'purchase',hostname:'example.com'}],[owner,{kind:'domain',operation:'connect',claimId:created.id}]]){
  const before=await getBilling(db,user.id),beforeDNS=dnsCalls;const rejected=await send(user,action);assert.equal(rejected.turn.status,'failed');assert.equal(dnsCalls,beforeDNS);assert.equal((await getBilling(db,user.id)).quota.spent,before.quota.spent);assert.equal((await getBilling(db,user.id)).quota.reserved,0);
 }
 await db.prepare("UPDATE domain_claims SET expires_at='2000-01-01' WHERE id=?").bind(created.id).run();const expired=await send(owner,check);assert.equal(expired.turn.status,'failed');assert.match(expired.turn.assistant_text,/expired/);
 await send(owner,prepare);const renewed=await db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(created.id).first();assert.notEqual(renewed.token,row.token);
 let lost=false;const lossy=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{const result=await target.batch(statements);if(!lost&&await target.prepare("SELECT id FROM domain_claims WHERE hostname='lost.example.com'").first()){lost=true;throw Error('Lost acknowledgement');}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const recovered=await send(owner,{...prepare,hostname:'lost.example.com'},lossy);assert.equal(recovered.turn.status,'completed');assert.ok(lost);assert.equal((await db.prepare("SELECT COUNT(*) n FROM domain_claims WHERE hostname='lost.example.com'").first()).n,1);
 await send(owner,{...prepare,hostname:'third.example.com'});const beforeQuota=await getBilling(db,owner.id),quota=await send(owner,{...prepare,hostname:'fourth.example.com'});assert.equal(quota.turn.status,'failed');assert.match(quota.turn.assistant_text,/Domain test limit/);assert.equal((await getBilling(db,owner.id)).quota.spent,beforeQuota.quota.spent);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM publications WHERE version_id IS NOT NULL').first()).n,0);
 console.log('Domain AI actions passed: owned metadata without proof tokens, validated preparation, exact DNS checking, authoritative receipts, replay, renewal, tenant boundaries, unsupported operations, failure/quota refunds and lost-commit recovery.');
}finally{globalThis.fetch=realFetch;await proxy.dispose();await rm(dir,{recursive:true,force:true});}
