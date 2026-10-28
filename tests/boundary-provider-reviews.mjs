// WH-004 slice 3 regression: domain-hosting routes and provider-facing exact reviews, through the real handlers.
// Local D1/R2 and synthetic accounts; every provider call goes to a recording stub and no network is used.
// Closes evidence gaps recorded in docs/boundary-audit.json:
//   4. every `/api/domain-hosting` HTTP route refuses a foreign and an unauthenticated caller;
//   6. a hosting proof renewed after the review refuses the confirmation before any DNS or provider call;
//   3. confirming an expired hosting, DNS, GitHub backup or domain-proof-removal review is refused and changes
//      nothing (application-page, backend-form, module and upgrade reviews are in boundary-review-lifecycle).
// Each refusal has a negative control: the legitimate owner, or an identical unexpired review of the same state.
import assert from 'node:assert/strict';
import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,files=store.env?.FILES,id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const ctx={waitUntil(){throw Error('No background work is expected');}};
const owners=new Map();
async function owner(){const a=await workspaceFixture(db,m),o={id:a.account,token:a.token,scope:await a.scope()};owners.set(o.id,o);return o;}
async function chat(o,content){
 const turn=id(),state=await m.readChat(o.scope,o.id);
 const result=await m.sendChat(o.scope,o.id,{id:turn,content,revision:state.state.revision});
 assert.equal(result.status,200,content+': '+JSON.stringify(result));return turn;
}
const scalar=async(sql,...values)=>(await db.prepare(sql).bind(...values).first()).n;
const refused=(promise,status,pattern)=>assert.rejects(promise,e=>e.status===status&&(!pattern||pattern.test(e.message)));
/** Runs `fn` with the process clock moved back so a review the real handler prepares is already expired. */
async function atPast(ms,fn){const clock=Date.now;Date.now=()=>clock()-ms;try{return await fn();}finally{Date.now=clock;}}
async function claim(o,hostname){
 const {project}=await createFixtureProject(o.scope,o.id,'Domains '+hostname,'A synthetic domain website');
 const turn=await chat(o,`/domain ${hostname} ${project}`);
 return {project,id:turn,hostname,row:()=>db.prepare('SELECT * FROM domain_claims WHERE id=?').bind(turn).first()};
}
const hosting={token:'synthetic-token',zone:'a'.repeat(32),target:'hosting.whumpo.site'};
/** A Cloudflare/DNS stub that proves ownership with the claim's current token and records every call. */
function transport(claimRow,{proof=true}={}){
 const t={calls:0,writes:0,async send(input,init={}){
  t.calls++;const u=new URL(input);
  if(u.hostname==='cloudflare-dns.com'){
   const txt=u.searchParams.get('type')==='TXT',token=txt&&proof?(await claimRow()).token:'';
   return Response.json({Status:0,Answer:[{name:u.searchParams.get('name')+'.',type:txt?16:5,data:txt?JSON.stringify(proof?'whumpo-verification='+token:'wrong'):hosting.target+'.'}]});
  }
  assert.equal(u.origin,'https://api.cloudflare.com');
  if(init.method==='POST'){t.writes++;return Response.json({success:true,result:{id:id(),hostname:JSON.parse(init.body).hostname,status:'pending',ssl:{status:'initializing'}}});}
  return Response.json({success:true,result:[],result_info:{total_count:0}});
 }};
 return t;
}
const connection=review=>db.prepare('SELECT state,provider_id,expires_at,proof_hash FROM domain_connections WHERE id=?').bind(review).first();
try{
 const a=await owner(),b=await owner();

 // 4. Every /api/domain-hosting route refuses a foreign and an unauthenticated caller before any provider call.
 {
  const realFetch=globalThis.fetch,outbound=[];
  globalThis.fetch=async(url,init)=>{outbound.push(String(url));return Response.json({Status:0,Answer:[]});};
  const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},DOMAIN_HOSTING_READY:'verified',CLOUDFLARE_DOMAINS_TOKEN:'synthetic-token'};
  const http=(path,{token,method='GET',body,origin='https://whumpo.com'}={})=>m.worker.fetch(new Request('https://whumpo.com'+path,{method,headers:{origin,'content-type':'application/json',...(token?{cookie:'__Host-whumpo_session='+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);
  try{
   const c=await claim(a,'www.example.com'),review=id();
   const reviewed=await http('/api/domain-hosting/review',{token:a.token,method:'POST',body:{id:review,claimId:c.id}});
   assert.equal(reviewed.status,200,'negative control: the owner prepares a hosting review: '+await reviewed.clone().text());
   assert.equal((await reviewed.json()).state,'review');
   const snapshot=async()=>JSON.stringify([await connection(review),await scalar('SELECT count(*) n FROM domain_connections')]);
   const before=await snapshot();
   const routes=[['GET','/api/domain-hosting'],['POST','/api/domain-hosting/review',{id:id(),claimId:c.id}],['POST',`/api/domain-hosting/${review}/confirm`,{}],['POST',`/api/domain-hosting/${review}/refresh`,{}],['POST',`/api/domain-hosting/${review}/disconnect`,{}]];
   for(const [method,path,body] of routes){
    const anonymous=await http(path,{method,body});
    assert.equal(anonymous.status,401,`${method} ${path} without a session`);
    const crossOrigin=method==='POST'?await http(path,{token:a.token,method,body,origin:'https://foreign.test'}):null;
    if(crossOrigin)assert.equal(crossOrigin.status,403,`${method} ${path} from a foreign origin`);
    const foreign=await http(path,{token:b.token,method,body}),text=await foreign.text();
    if(method==='GET')assert.deepEqual(JSON.parse(text).connections,[],'a foreign caller lists none of the owner\'s connections');
    else assert.equal(foreign.status,404,`${method} ${path} with a foreign session: ${text}`);
    assert.ok(!text.includes(review)&&!text.includes(c.hostname),`${method} ${path} leaks nothing to a foreign caller`);
   }
   assert.equal(await snapshot(),before,'refused calls changed nothing');
   assert.equal(outbound.length,0,'no refused call reached DNS or the provider');
   // Negative controls: the owner is admitted on the same routes (reads, refresh, confirm and disconnect).
   const own=await (await http('/api/domain-hosting',{token:a.token})).json();
   assert.deepEqual(own.connections.map(x=>x.id),[review]);
   const refresh=await http(`/api/domain-hosting/${review}/refresh`,{token:a.token,method:'POST',body:{}});
   assert.equal(refresh.status,200);assert.equal((await refresh.json()).state,'review');
   const confirm=await http(`/api/domain-hosting/${review}/confirm`,{token:a.token,method:'POST',body:{}});
   assert.equal(confirm.status,409,'negative control: the owner\'s confirm reaches the DNS proof check');
   assert.match((await confirm.json()).error,/ownership proof was not found/);
   assert.ok(outbound.length>0&&outbound.every(url=>url.startsWith('https://cloudflare-dns.com/')),'only the owner\'s confirm reached the resolver');
   const disconnect=await http(`/api/domain-hosting/${review}/disconnect`,{token:a.token,method:'POST',body:{}});
   assert.equal(disconnect.status,200);assert.equal((await disconnect.json()).state,'disconnected');
  }finally{globalThis.fetch=realFetch;}
  console.log('Domain hosting routes: every route refuses an unauthenticated and a foreign caller with no change and no provider call; the owner is admitted on each.');
 }

 // 6. Proof renewed after the review: the confirmation is refused before any DNS or provider call.
 {
  const c=await claim(a,'renewed.example.com');
  const stale=await m.reviewHosting(a.scope,a.id,id(),c.id,hosting);
  const original=await c.row();
  // The seven-day proof lapses (fixture clock boundary), then the owner renews it through the real command.
  await db.prepare("UPDATE domain_claims SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(c.id).run();
  await chat(a,`/domain ${c.hostname} ${c.project}`);
  const renewed=await c.row();
  assert.notEqual(renewed.token,original.token,'the ownership proof was renewed through the real command');
  assert.ok(renewed.expires_at>now(),'the renewed proof is current');
  const t=transport(c.row);
  await refused(m.confirmHosting(a.scope,a.id,stale.id,hosting,t.send),409,/Domain proof changed/);
  assert.equal(t.calls,0,'no DNS or provider call was made');
  assert.equal((await connection(stale.id)).state,'review');
  assert.equal(await scalar("SELECT count(*) n FROM domain_connections WHERE claim_id=? AND state<>'review'",c.id),0);
  const fresh=await m.reviewHosting(a.scope,a.id,id(),c.id,hosting);
  assert.notEqual((await connection(fresh.id)).proof_hash,(await connection(stale.id)).proof_hash,'the new review binds the renewed proof');
  const confirmed=await m.confirmHosting(a.scope,a.id,fresh.id,hosting,t.send);
  assert.equal(confirmed.state,'provisioning','negative control: a review of the renewed proof is admitted');
  assert.equal(t.writes,1);
  console.log('Hosting proof renewal: the older review is refused before any DNS or provider call; a review of the renewed proof is admitted.');
 }

 // 3. Hosting review expiry: the stored expiry is in the past; an identical unexpired review is admitted.
 {
  const c=await claim(a,'expired.example.com');
  const expired=await atPast(700000,()=>m.reviewHosting(a.scope,a.id,id(),c.id,hosting));
  assert.ok((await connection(expired.id)).expires_at<=now(),'the stored review is expired');
  const t=transport(c.row);
  await refused(m.confirmHosting(a.scope,a.id,expired.id,hosting,t.send),409,/review expired/);
  assert.equal(t.calls,0,'no DNS or provider call was made');
  assert.equal((await connection(expired.id)).state,'review');
  const twin=await m.reviewHosting(a.scope,a.id,id(),c.id,hosting);
  assert.equal((await m.confirmHosting(a.scope,a.id,twin.id,hosting,t.send)).state,'provisioning','negative control: the unexpired twin is admitted');
  assert.equal(t.writes,1);
  console.log('Hosting reviews: an expired review is refused before any call; the unexpired twin is admitted.');
 }

 // 3. Domain-proof removal review expiry (typed confirm control; the stored review has a ten-minute expiry).
 {
  const c=await claim(a,'removal.example.com');
  const expiredTurn=await atPast(700000,()=>chat(a,'/remove-domain-proof '+c.id));
  const stored=await db.prepare('SELECT status,expires_at FROM domain_proof_removals WHERE id=?').bind(expiredTurn).first();
  assert.equal(stored.status,'pending');assert.ok(stored.expires_at<=now());
  const control=async review=>{const turn=id(),state=await m.readChat(a.scope,a.id);return {turn,result:await m.sendChatControl(a.scope,a.id,{id:turn,revision:state.state.revision,action:{type:'confirm',kind:'domainProof',reviewId:review}})};};
  const lapsed=await control(expiredTurn);
  assert.ok(await c.row(),'the expired removal review left the proof in place');
  assert.equal((await db.prepare('SELECT status FROM domain_proof_removals WHERE id=?').bind(expiredTurn).first()).status,'pending');
  assert.equal(await scalar("SELECT count(*) n FROM activity_events WHERE action='domain.proof.removed' AND project_id=?",c.project),0);
  const reply=(await m.readChat(a.scope,a.id)).turns.find(t=>t.id===lapsed.turn);
  assert.ok(reply,'the refusal is saved as an explicit reply');assert.match(reply.assistant_text,/expired/);
  const twinTurn=await chat(a,'/remove-domain-proof '+c.id);
  const removed=await control(twinTurn);
  assert.equal(removed.result.status,200);
  assert.equal(await c.row(),null,'negative control: the unexpired twin removes the proof');
  assert.equal(await scalar("SELECT count(*) n FROM activity_events WHERE action='domain.proof.removed' AND project_id=?",c.project),1);
  console.log('Domain-proof removal reviews: an expired review leaves the proof in place; the unexpired twin removes it.');
 }

 // 3. DNS review expiry (Cloudflare TXT proof): the stored expiry is in the past; the identical twin is applied.
 {
  const keys=fixtureKeyring('a'.repeat(64)),config={clientId:'fixture',clientSecret:'fixture-secret',key:keys},zone='b'.repeat(32);
  await initializeFixtureKeys(db,keys);
  const o=await owner();await paidPlan(db,o.id,'business');
  const tokenId=id();
  await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,'active')").bind(tokenId,o.id,await m.seal(keys,`whumpo:cloudflare:token:${o.id}:${tokenId}`,JSON.stringify({access:'fixture-access'})),new Date(Date.now()+3600000).toISOString(),now()).run();
  const c=await claim(o,'www.example.com');
  const provider={records:[],posts:0,send:async(url,init)=>{
   const u=new URL(url);assert.equal(u.origin,'https://api.cloudflare.com');assert.equal(init.headers.authorization,'Bearer fixture-access');
   if(u.pathname===`/client/v4/zones/${zone}`)return Response.json({success:true,result:{id:zone,name:'example.com',status:'active'}});
   assert.equal(u.pathname,`/client/v4/zones/${zone}/dns_records`);
   if(init.method==='POST'){provider.posts++;const data=JSON.parse(init.body),created={...data,id:id().replaceAll('-','')};provider.records.push(created);return Response.json({success:true,result:created});}
   return Response.json({success:true,result:provider.records,result_info:{total_count:provider.records.length}});
  }};
  const expired=await atPast(700000,()=>m.reviewTXT(o.scope,o.id,id(),c.id,zone,config,provider.send));
  const action=review=>db.prepare('SELECT state,expires_at,provider_id FROM cloudflare_dns_actions WHERE id=?').bind(review).first();
  assert.ok((await action(expired.id)).expires_at<=now(),'the stored DNS review is expired');
  await refused(m.confirmDNS(o.scope,o.id,expired.id,config,provider.send),409,/expired or the proof changed/);
  assert.equal(provider.posts,0,'no DNS record was written');
  assert.equal((await action(expired.id)).state,'review');assert.equal((await action(expired.id)).provider_id,null);
  const twin=await m.reviewTXT(o.scope,o.id,id(),c.id,zone,config,provider.send);
  assert.equal((await m.confirmDNS(o.scope,o.id,twin.id,config,provider.send,false,{reviewDigest:twin.receipt.reviewDigest,acceptedPrice:twin.receipt.price})).state,'applied','negative control: the unexpired twin writes the record');
  assert.equal(provider.posts,1);
  console.log('Cloudflare DNS reviews: an expired review is refused with no provider write; the unexpired twin is applied.');
 }

 // 3. GitHub backup review expiry: the stored expiry is in the past; the identical twin completes.
 {
  const keys=fixtureKeyring('ab'.repeat(32)),config={clientId:'Iv1.test',clientSecret:'synthetic-secret',appId:123,slug:'test',key:keys};
  const o=await owner();await paidPlan(db,o.id,'business');
  const token=id();
  await db.prepare('INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,?)').bind(token,o.id,await m.seal(keys,`whumpo:github:token:${o.id}:${token}`,'ghu_synthetic_private'),new Date(Date.now()+3600000).toISOString(),'active').run();
  await db.prepare('INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,?)').bind(o.id,'44','test',token,now()).run();
  const {version}=await createFixtureProject(o.scope,o.id,'Bakery','A local bakery','clay');
  const remote={writes:0,head:'a'.repeat(40),tree:null,send:async(url,init={})=>{
   assert.equal(init.headers.authorization,'Bearer ghu_synthetic_private');
   if(url==='https://api.github.com/user/installations?per_page=100')return Response.json({total_count:1,installations:[{id:1,app_id:123,suspended_at:null,account:{login:'test'},repository_selection:'selected'}]});
   const repo={id:17,owner:{login:'test'},name:'backup',private:true,default_branch:'main',permissions:{push:true}};
   if(url==='https://api.github.com/user/installations/1/repositories?per_page=20&page=1')return Response.json({repositories:[repo]});
   if(url==='https://api.github.com/repos/test/backup')return Response.json(repo);
   if(url.includes('/git/ref/heads/'))return Response.json({object:{sha:remote.head}});
   assert.equal(url,'https://api.github.com/graphql');
   if(JSON.parse(init.body).query.startsWith('query'))return Response.json({data:{repository:{p0:null,p1:null,p2:null,p3:remote.writes?{__typename:'Tree',oid:remote.tree}:null}}});
   remote.writes++;remote.head='b'.repeat(40);
   return Response.json({data:{createCommitOnBranch:{commit:{oid:remote.head}}}});
  }};
  const input=()=>({id:id(),versionId:version,owner:'test',repo:'backup',repoId:17});
  const expired=await atPast(700000,()=>m.reviewBackup(o.scope,files,o.id,input(),config,remote.send));
  const stored=review=>db.prepare('SELECT state,expires_at,commit_sha FROM github_backups WHERE id=?').bind(review).first();
  assert.ok((await stored(expired.id)).expires_at<=now(),'the stored backup review is expired');
  await refused(m.confirmBackup(o.scope,files,o.id,expired.id,config,remote.send),409,/review expired/);
  assert.equal(remote.writes,0,'no commit was written to the repository');
  assert.equal((await stored(expired.id)).state,'pending');
  const twin=await m.reviewBackup(o.scope,files,o.id,input(),config,remote.send);
  remote.tree=(await db.prepare('SELECT tree_sha FROM github_backups WHERE id=?').bind(twin.id).first()).tree_sha;
  assert.equal((await m.confirmBackup(o.scope,files,o.id,twin.id,config,remote.send,{reviewDigest:twin.receipt.reviewDigest,acceptedPrice:twin.receipt.price})).state,'complete','negative control: the unexpired twin is committed');
  assert.equal(remote.writes,1);
  console.log('GitHub backup reviews: an expired review is refused with no repository write; the unexpired twin completes.');
 }
}catch(error){console.error(String(error?.stack??error).split('\n').filter(line=>!line.includes('data:text/javascript')).join('\n'));process.exitCode=1;}
finally{await store.close?.();}
