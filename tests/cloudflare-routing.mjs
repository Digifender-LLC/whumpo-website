import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const b=await build({stdin:{contents:"export {reviewCNAME,reviewTXT,confirmDNS,listDNSActions} from './src/cloudflare-dns';export {seal} from './src/connection-vault';export {reviewHosting} from './src/domain-hosting';export {sendChat,readChat} from './src/chat';export {sendAIChat} from './src/ai-chat';export {getBilling} from './src/billing';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {reviewCNAME,reviewTXT,confirmDNS,listDNSActions,seal,reviewHosting,sendChat,readChat,sendAIChat,getBilling}=m;
const fixture=await databaseFixture({d1:true}),db=fixture.db,identities=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
const config={clientId:'fixture',clientSecret:'fixture-secret',key:fixtureKeyring('a'.repeat(64))},zone='b'.repeat(32),target='hosting.whumpo.site',now=()=>new Date().toISOString();
async function account(apex=false){
 const identity=await workspaceFixture(db,m),user=identity.account,project=crypto.randomUUID(),claim=crypto.randomUUID(),tokenId=crypto.randomUUID(),connection=crypto.randomUUID(),proof=crypto.randomUUID(),hostname=apex?'example.com':'test-'+user+'.example.com';
 identities.set(user,identity);scopes.set(user,await identity.scope());await paidPlan(db,user,'business');
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Routing fixture','Testing','draft',?,?)").bind(project,user,now(),now()).run();
 await db.prepare('INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(claim,project,hostname,proof,new Date(Date.now()+86400000).toISOString(),now()).run();
 await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,'active')").bind(tokenId,user,await seal(config.key,`whumpo:cloudflare:token:${user}:${tokenId}`,JSON.stringify({access:'fixture-access'})),new Date(Date.now()+3600000).toISOString(),now()).run();
 await reviewHosting(scope(user),user,connection,claim,{token:'synthetic',zone:'8d46ee4e394514402479acf16579f7b5',target});
 await db.prepare("UPDATE domain_connections SET state='provisioning',provider_id=? WHERE id=?").bind(crypto.randomUUID(),connection).run();
 return {user,project,claim,tokenId,connection,proof,hostname};
}
function provider(a){const p={records:[],posts:0,lose:false,async send(url,init){
 assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer fixture-access');const u=new URL(url);assert.equal(u.origin,'https://api.cloudflare.com');
 if(u.pathname===`/client/v4/zones/${zone}`)return Response.json({success:true,result:{id:zone,name:'example.com',status:'active'}});
 assert.equal(u.pathname,`/client/v4/zones/${zone}/dns_records`);
 if(init.method==='POST'){p.posts++;const data=JSON.parse(init.body);assert.deepEqual(data,{type:'CNAME',name:a.hostname,content:target,ttl:1,proxied:false,comment:data.comment});assert.match(data.comment,/^Whumpo routing /);const created={...data,id:crypto.randomUUID().replaceAll('-','')};p.records.push(created);if(p.lose)throw Error('Lost response');return Response.json({success:true,result:created});}
 assert.equal(u.searchParams.get('name.exact'),a.hostname);return Response.json({success:true,result:p.records,result_info:{total_count:p.records.length}});
 }};return p;}
const review=(a,p,id=crypto.randomUUID(),database=scope(a.user),ready=true)=>reviewCNAME(database,a.user,id,a.connection,zone,config,p.send,ready);
const echo=async(user,id)=>{const r=(await listDNSActions(scope(user),user)).actions.find(x=>x.id===id)?.receipt;return r?.reviewDigest&&{reviewDigest:r.reviewDigest,acceptedPrice:r.price};},confirm=async(a,p,id,database=scope(a.user),ready=true)=>confirmDNS(database,a.user,id,config,p.send,ready,await echo(a.user,id));
const beforeDispatch=(a,fn)=>identities.get(a.user).scope(interceptDatabase(db,/UPDATE cloudflare_dns_actions SET state=\?/,fn));
try{
 await initializeFixtureKeys(db,config.key);
 const a=await account(),other=await account(),p=provider(a),r=await review(a,p);
 assert.equal(r.state,'review');assert.equal(r.record.type,'CNAME');assert.equal(r.record.proxied,false);assert.equal(p.posts,0);assert.equal('proof_token' in r,false);
 await assert.rejects(reviewCNAME(scope(other.user),other.user,crypto.randomUUID(),a.connection,zone,config,p.send,true),{status:404});
 await assert.rejects(confirm(other,p,r.id),{status:404});
 await assert.rejects(reviewTXT(scope(a.user),a.user,r.id,a.claim,zone,config,p.send),{status:409});
 await assert.rejects(confirm(a,p,r.id,undefined,false),{status:503});assert.equal(p.posts,0);
 assert.equal((await confirm(a,p,r.id)).state,'applied');assert.equal((await confirm(a,p,r.id)).state,'applied');assert.equal(p.posts,1);
 assert.equal((await confirm(a,p,(await review(a,p)).id)).state,'unchanged');assert.equal(p.posts,1);
 assert.equal((await db.prepare('SELECT serve_until FROM domain_connections WHERE id=?').bind(a.connection).first()).serve_until,null);
 for(const rec of [{type:'A',content:'192.0.2.1'},{type:'AAAA',content:'2001:db8::1'},{type:'NS',content:'ns.example.net'},{type:'TXT',content:'preserve me'},{type:'CNAME',content:'other.example.net',proxied:false},{type:'CNAME',content:target,proxied:true}]){
  const c=await account(),cp=provider(c);cp.records=[{id:'c'.repeat(32),name:c.hostname,ttl:300,...rec}];await assert.rejects(review(c,cp),{status:409});assert.equal(cp.posts,0);assert.equal(cp.records[0].content,rec.content);
 }
 const apex=await account(true),ap=provider(apex);await assert.rejects(review(apex,ap),{status:409});assert.equal(ap.posts,0);
 const disabled=await account(),dp=provider(disabled);await assert.rejects(review(disabled,dp,crypto.randomUUID(),undefined,false),{status:503});
 const stale=await account(),sp=provider(stale),sr=await review(stale,sp);sp.records.push({id:'d'.repeat(32),name:stale.hostname,type:'CNAME',content:target,ttl:1,proxied:false});await assert.rejects(confirm(stale,sp,sr.id),{status:409});assert.equal(sp.posts,0);
 // Dispatch checks remain atomic even if connection, token or ownership changes after provider reads.
 for(const mutation of ['proof','connection','credential']){
  const c=await account(),cp=provider(c),cr=await review(c,cp);
  const gate=await beforeDispatch(c,async()=>{if(mutation==='proof')await db.prepare('UPDATE domain_claims SET token=? WHERE id=?').bind('rotated',c.claim).run();if(mutation==='connection')await db.prepare("UPDATE domain_connections SET state='disconnecting' WHERE id=?").bind(c.connection).run();if(mutation==='credential')await db.prepare("UPDATE cloudflare_token_vault SET state='revoking' WHERE id=?").bind(c.tokenId).run();});
  await assert.rejects(confirm(c,cp,cr.id,gate),{status:409});assert.equal(cp.posts,0);
 }
 const uncertain=await account(),up=provider(uncertain);up.lose=true;const ur=await review(uncertain,up);assert.equal((await confirm(uncertain,up,ur.id)).state,'uncertain');
 await db.prepare("UPDATE domain_connections SET state='disconnecting' WHERE id=?").bind(uncertain.connection).run();
 assert.equal((await confirm(uncertain,up,ur.id,undefined,false)).state,'observed');assert.equal(up.posts,1);
 const unknown=await account(),np=provider(unknown),nr=await review(unknown,np),send=np.send;np.send=async(u,i)=>{if(i.method==='POST'){np.posts++;throw Error('No response');}return send(u,i);};assert.equal((await confirm(unknown,np,nr.id)).state,'uncertain');assert.equal((await confirm(unknown,np,nr.id)).state,'uncertain');assert.equal(np.posts,1);
 // Internal handler strings exercise committed Chat actions; the public input
 // remains natural language (natural-chat.mjs covers that boundary).
 const chat=await account(),cp=provider(chat),opts={config,transport:cp.send,hostingReady:true};
 const msg=async(content,id=crypto.randomUUID(),revision)=>{const state=await readChat(scope(chat.user),chat.user);return sendChat(scope(chat.user),chat.user,{id,content,revision:revision??state.state.revision},undefined,opts);};
 const reviewId=crypto.randomUUID();await msg('/review-routing '+chat.connection+' '+zone,reviewId);assert.match((await readChat(scope(chat.user),chat.user)).turns.at(-1).assistant_text,/DNS-only CNAME/);assert.equal(cp.posts,0);
 await msg('/check-dns '+reviewId);assert.equal(cp.posts,0);
 const rev=(await readChat(scope(chat.user),chat.user)).state.revision,id=crypto.randomUUID();await msg('/confirm-dns '+reviewId,id,rev);await msg('/confirm-dns '+reviewId,id,rev);assert.equal(cp.posts,1);assert.equal((await getBilling(scope(chat.user),chat.user)).standardAI.creditCharge,0);
 // AI may only prepare exact server-derived routing. Supplied target or confirmation is rejected.
 const agent=await account(),agp=provider(agent),ai={baseURL:'https://model.invalid/v1',apiKey:'synthetic',model:'synthetic',protocol:'responses'};
 const action={kind:'dns',operation:'routingReview',connectionId:agent.connection,zoneId:zone};
 for(const proposed of [action,{...action,target:'evil.example'},{kind:'dns',operation:'confirm',reviewId}]){
  const state=await readChat(scope(agent.user),agent.user),turn=crypto.randomUUID();
  await sendAIChat(scope(agent.user),agent.user,turn,state.state.revision,'Review website routing',ai,async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Already changed DNS.',action:proposed})}]}],usage:{input_tokens:100,output_tokens:100}}),{config,transport:agp.send,hostingReady:true});
  const result=(await readChat(scope(agent.user),agent.user)).turns.at(-1);assert.equal(result.status,proposed===action?'completed':'failed');assert.ok(!result.assistant_text.includes('Already changed DNS.'));assert.equal(agp.posts,0);
 }
 assert.equal((await listDNSActions(scope(agent.user),agent.user)).actions.length,1);
 console.log('Routing checks passed: fixed target, owner/config/apex gates, conflict preservation, unchanged receipts, stale inventory, atomic proof/connection/credential races, uncertain read-only recovery, chat replay and AI review-only authority.');
}finally{await fixture.close();}
