import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {createFixtureProject} from './current-site-fixture.mjs';
const b=await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/feature-admission';export * from './src/feature-preview-grants';export * from './src/github-connection';export * from './src/cloudflare-connection';export * from './src/cloudflare-dns';export * from './src/github-backups';export * from './src/connection-vault';export * from './src/connection-recovery';export * from './src/security';export * from './src/backup-chat';export * from './src/dns-chat';export {default as worker} from './src/index';"},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),seconds=()=>Math.floor(Date.now()/1000),later=()=>new Date(Date.now()+3600000).toISOString();
const gh={clientId:'Iv1.fixture',clientSecret:'fixture',appId:123,slug:'fixture',key:'a'.repeat(64)},cf={clientId:'fixture',clientSecret:'fixture',key:'a'.repeat(64)},zone='a'.repeat(32);
const deny=async()=>{throw Error('Unexpected provider request');};let checks=0;
async function rejected(p,status=403){await assert.rejects(p,e=>e.status===status);checks++;}
async function owner(plan){const u=id();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(u,u+'@example.invalid',now()).run();if(plan)await paidPlan(db,u,plan);return u;}
async function grant(user,provider,operation,projectId=null){const g={id:id(),userId:user,projectId,featureId:'connections.'+provider,operation,purpose:'private-test-acceptance',reviewReference:'https://github.com/zemdregon/whumpo/issues/64',startsAt:seconds()-1,endsAt:seconds()+3600};await m.issueFeaturePreviewGrant(db,g,'local');return g;}
const revoke=g=>m.revokeFeaturePreviewGrant(db,{userId:g.userId,projectId:g.projectId},g.id,'local');
async function credentials(u){const g=id(),c=id();await db.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,'active')").bind(g,u,await m.seal(gh.key,`tellumo:github:token:${u}:${g}`,'ghu_fixture'),later()).run();await db.prepare('INSERT INTO github_connections VALUES(?,?,?,?,?)').bind(u,'44','fixture',g,now()).run();await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,'active')").bind(c,u,await m.seal(cf.key,`tellumo:cloudflare:token:${u}:${c}`,JSON.stringify({access:'fixture'})),later(),now()).run();return {g,c};}
function intercept(database,pattern,hook){return {...database,prepare(q){const stmt=database.prepare(q);const wrap=s=>({bind:(...a)=>wrap(s.bind(...a)),first:async(...a)=>{if(pattern.test(q))await hook();return s.first(...a);},all:(...a)=>s.all(...a),run:async()=>{if(pattern.test(q))await hook();return s.run();}});return wrap(stmt);}};}
async function dns(u){const project=id(),claim=id(),token=id(),proof=id().replaceAll('-','').repeat(2);await db.prepare("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,'Fixture',?,?)").bind(project,u,now(),now()).run();await db.prepare("INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)").bind(claim,project,'www.example.com',proof,later(),now()).run();await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,'active')").bind(token,u,await m.seal(cf.key,`tellumo:cloudflare:token:${u}:${token}`,JSON.stringify({access:'fixture'})),later(),now()).run();return {u,project,claim,token,proof};}
let posts=0,reads=0;
const dnsProvider=async(url,init)=>{if(init.method==='POST'){posts++;throw Error('Uncertain test write');}reads++;return Response.json(url.includes('dns_records')?{success:true,result:[],result_info:{total_count:0}}:{success:true,result:{id:zone,name:'example.com',status:'active'}});};
try{
 for(const plan of [undefined,'starter','personal']){
  const u=await owner(plan);await credentials(u);
  await rejected(m.startGitHub(db,u,'session',gh));await rejected(m.startCloudflare(db,u,'session',cf));
  await rejected(m.githubInstallations(db,u,gh,deny));await rejected(m.cloudflareZones(db,u,cf,1,deny));
  assert.equal((await m.connectionStatus(db,u,gh)).github.connected,true);assert.equal((await m.cloudflareStatus(db,u,cf)).inclusion.read,false);
  assert.deepEqual((await m.listBackups(db,u)).backups,[]);assert.deepEqual((await m.listDNSActions(db,u)).actions,[]);
  assert.match(await m.backupChatCommand(db,u,id(),'/github-installations',{github:gh,githubTransport:deny})(),/requires Business/);
  assert.match(await m.dnsChatCommand(db,u,id(),'/dns-zones',{config:cf,transport:deny})(),/requires Business/);
  const session='1'.repeat(32)+u.replaceAll('-','');await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await m.hashToken(session),u,later(),now()).run();
  const env={DB:db,ENVIRONMENT:'local',GITHUB_CLIENT_ID:gh.clientId,GITHUB_CLIENT_SECRET:gh.clientSecret,GITHUB_APP_ID:String(gh.appId),GITHUB_APP_SLUG:gh.slug,CONNECTION_ENCRYPTION_KEY:gh.key,CLOUDFLARE_CLIENT_ID:cf.clientId,CLOUDFLARE_CLIENT_SECRET:cf.clientSecret,API_LIMITER:{limit:async()=>({success:true})}};
  for(const provider of ['github','cloudflare']){const r=await m.worker.fetch(new Request('https://whumpo.com/api/connections/'+provider+'/start',{method:'POST',headers:{origin:'https://whumpo.com',cookie:'tellumo_session='+session}}),env);assert.equal(r.status,403);assert.match((await r.json()).error,/requires Business/);}
  await m.disconnectGitHub(db,u,gh,async()=>new Response(null,{status:204}));await m.disconnectCloudflare(db,u,cf,async()=>new Response(null,{status:200}));
 }
 for(const plan of ['business','business-pro']){const u=await owner(plan);assert.ok((await m.startGitHub(db,u,'s',gh)).url);assert.ok((await m.startCloudflare(db,u,'s',cf)).url);}
 // A grant revoked during OAuth cannot activate its returned credential. Cleanup still works.
 for(const provider of ['github','cloudflare']){
  const u=await owner(),g=await grant(u,provider,'connect'),config=provider==='github'?gh:cf;
  const start=await (provider==='github'?m.startGitHub:m.startCloudflare)(db,u,'s',config),state=new URL(start.url).searchParams.get('state');let revoked=0;
  const transport=async(url)=>{if(url.includes('access_token')||url.endsWith('/oauth2/token')){await revoke(g);return Response.json(provider==='github'?{access_token:'ghu_fixture',expires_in:3600}:{access_token:'fixture',expires_in:3600,token_type:'Bearer'});}if(url.includes('/revoke')||url.includes('/applications/')){revoked++;return new Response(null,{status:provider==='github'?204:200});}throw Error('No identity discovery after lost grant');};
  await rejected((provider==='github'?m.finishGitHub:m.finishCloudflare)(db,u,'s',state,'code',config,transport));assert.equal(revoked,1);assert.equal(provider==='github'?(await m.connectionStatus(db,u,gh)).github.connected:(await m.cloudflareStatus(db,u,cf)).connected,false);
 }
 // SQL admission rechecks a revocation that happens after the initial resolver read.
 {
  const u=await owner(),g=await grant(u,'github','connect'),start=await m.startGitHub(db,u,'s',gh);let revoked=0;
  const transport=async(url)=>{if(url.includes('access_token'))return Response.json({access_token:'ghu_fixture',expires_in:3600});if(url.endsWith('/user')){await revoke(g);return Response.json({id:44,login:'fixture'});}if(url.includes('/applications/')){revoked++;return new Response(null,{status:204});}throw Error('Unexpected OAuth path');};
  await rejected(m.finishGitHub(db,u,'s',new URL(start.url).searchParams.get('state'),'code',gh,transport));assert.equal(revoked,1);assert.equal((await m.connectionStatus(db,u,gh)).github.connected,false);
 }
 for(const provider of ['github','cloudflare']){const u=await owner(),g=await grant(u,provider,'connect'),racing=intercept(db,new RegExp('INSERT INTO '+provider+'_oauth_states'),()=>revoke(g));await rejected((provider==='github'?m.startGitHub:m.startCloudflare)(racing,u,'s',provider==='github'?gh:cf));assert.equal((await db.prepare('SELECT count(*) n FROM '+provider+'_oauth_states WHERE user_id=?').bind(u).first()).n,0);}
 // A saved credential is not enough to disclose a provider response after eligibility loss.
 for(const provider of ['github','cloudflare']){const u=await owner();await credentials(u);const g=await grant(u,provider,'read');const transport=async()=>{await revoke(g);return Response.json(provider==='github'?{installations:[],total_count:0}:{success:true,result:[],result_info:{total_pages:1}});};await rejected(provider==='github'?m.githubInstallations(db,u,gh,transport):m.cloudflareZones(db,u,cf,1,transport));}
 // Exact project scope; prepare, confirm and dispatch are independent permissions.
 const d=await dns(await owner()),prep=await grant(d.u,'cloudflare','prepare',d.project);
 const review=await m.reviewTXT(db,d.u,id(),d.claim,zone,cf,dnsProvider);assert.equal(posts,0);
 await rejected(m.confirmDNS(db,d.u,review.id,cf,deny));const confirm=await grant(d.u,'cloudflare','confirm',d.project);
 await rejected(m.confirmDNS(db,d.u,review.id,cf,dnsProvider));assert.equal(posts,0);
 const dispatch=await grant(d.u,'cloudflare','dispatch',d.project);
 const racing=intercept(db,/UPDATE cloudflare_dns_actions SET state=\?/,()=>revoke(dispatch));await rejected(m.confirmDNS(racing,d.u,review.id,cf,dnsProvider));assert.equal(posts,0);assert.equal((await m.listDNSActions(db,d.u)).actions[0].state,'review');
 const again=await grant(d.u,'cloudflare','dispatch',d.project);const uncertain=await m.confirmDNS(db,d.u,review.id,cf,dnsProvider);assert.equal(uncertain.state,'uncertain');assert.equal(posts,1);
 await Promise.all([revoke(prep),revoke(confirm),revoke(again)]);await m.confirmDNS(db,d.u,review.id,cf,dnsProvider);assert.equal(posts,1);
 const recovery=await m.cloudflareAccess(db,d.u,cf,deny,{recoveryId:review.id});await rejected(recovery.send('/zones/'+zone+'/dns_records','POST',{}));await rejected(recovery.send('/zones/'+'b'.repeat(32)));await rejected(m.cloudflareAccess(db,d.u,cf,deny,{recoveryId:id()}));
 await rejected(m.reviewTXT(db,d.u,id(),d.claim,zone,cf,deny));
 // Real source backup review and uncertain dispatch, then exact read-only recovery after grant loss.
 const u=await owner();await credentials(u);const site=await createFixtureProject(db,u,'Fixture','A harmless site');
 const grants=[];for(const op of ['prepare','confirm','dispatch'])grants.push(await grant(u,'github',op,site.project));
 let commits=0;const ghProvider=async(url,init)=>{if(url.endsWith('/repos/test/backup'))return Response.json({id:17,owner:{login:'test'},name:'backup',private:true,default_branch:'main',permissions:{push:true}});if(url.includes('/git/ref/heads/'))return Response.json({object:{sha:'a'.repeat(40)}});assert.equal(url,'https://api.github.com/graphql');const body=JSON.parse(init.body);if(body.query.startsWith('mutation')){commits++;throw Error('Lost acknowledgement');}return Response.json({data:{repository:{p0:null,p1:null,p2:null,p3:null}}});};
 const backup=await m.reviewBackup(db,undefined,u,{id:id(),versionId:site.version,owner:'test',repo:'backup',repoId:17},gh,ghProvider);
 const outcome=await m.confirmBackup(db,undefined,u,backup.id,gh,ghProvider);assert.equal(outcome.state,'uncertain');assert.equal(commits,1);
 await Promise.all(grants.map(revoke));await m.confirmBackup(db,undefined,u,backup.id,gh,ghProvider);assert.equal(commits,1);
 const access=await m.githubAccess(db,u,gh,deny,{recoveryId:backup.id});
 for(const [path,options] of [['/user/installations',{}],['/repos/other/backup',{}],['/graphql',{method:'POST',body:JSON.stringify({query:'mutation X{noop}',variables:{}})}],['/graphql',{method:'POST',body:JSON.stringify({query:m.backupPathsQuery,variables:m.backupPathsVariables('test','backup','different/path','a'.repeat(40))})}]])await rejected(access.send(path,options));
 assert.equal((await m.listBackups(db,u)).backups.length,1);const other=await owner();await rejected(m.confirmBackup(db,undefined,other,backup.id,gh,deny),404);
 await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(other,site.project).run();await rejected(access.assertCurrent());assert.equal((await m.listBackups(db,u)).backups.length,0);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 console.log(`Feature admission passed: ${checks} refusal cases plus actual HTTP/Chat/OAuth, scope, atomic revocation, provider response, exact review/dispatch and read-only uncertain-recovery checks. No real provider calls.`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}finally{await fixture.close();}
