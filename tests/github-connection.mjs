import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession,interceptDatabase} from './helpers/workspace-identity.mjs';
const built=await build({stdin:{contents:"export * from './src/github-connection';export {seal,unseal} from './src/connection-vault';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const {startGitHub,cancelGitHub,finishGitHub,disconnectGitHub,connectionStatus,githubInstallations,githubAccess,cleanupGitHub,seal,unseal}=m;
const fixture=await databaseFixture({d1:true}),db=fixture.db,identities=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
const config={clientId:'Iv1.test',clientSecret:'synthetic-secret',appId:123,slug:'whumpo-test',key:fixtureKeyring('ab'.repeat(32))};
async function account(){const a=await workspaceFixture(db,m);identities.set(a.account,a);scopes.set(a.account,await a.scope());await paidPlan(db,a.account,'business');return a.account;}
const denied=async()=>{throw Error('No transport expected');};let calls=0,exchanges=0,revocations=[];
function provider(start,{token='ghu_synthetic',expires=28800,revokeStatus=204,userStatus=200,beforeUser,includeRefresh=false}={}){return async(url,init={})=>{calls++;assert.equal(init.redirect,'manual');assert.ok(init.signal);const parsed=new URL(url);
 if(url==='https://github.com/login/oauth/access_token'){exchanges++;const body=JSON.parse(init.body);assert.equal(body.client_secret,config.clientSecret);assert.equal(body.redirect_uri,'https://whumpo.com/api/connections/github/callback');const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.code_verifier))).toString('base64url');assert.equal(digest,new URL(start.url).searchParams.get('code_challenge'));assert.equal(parsed.search,'');return Response.json({access_token:token,expires_in:expires,...(includeRefresh?{refresh_token:'ghr_synthetic_refresh',refresh_token_expires_in:15897600}:{})});}
 if(url==='https://api.github.com/user'){if(beforeUser)await beforeUser();return Response.json({id:44,login:'synthetic-user'},{status:userStatus});}
 if(url==='https://api.github.com/user/installations?per_page=100')return Response.json({total_count:3,installations:[{id:1,app_id:123,suspended_at:null,account:{login:'synthetic-org'},repository_selection:'selected'},{id:2,app_id:999,account:{login:'other-app'}},{id:3,app_id:123,suspended_at:'yesterday',account:{login:'suspended'}}]});
 if(url==='https://api.github.com/applications/Iv1.test/token'){assert.equal(init.method,'DELETE');assert.ok(init.headers.authorization.startsWith('Basic '));revocations.push(JSON.parse(init.body).access_token);return new Response(null,{status:revokeStatus});}throw Error('Unexpected URL '+url);
 };}
async function start(user){return startGitHub(scope(user),user,config);}
async function finish(user,s,transport,admitted=scope(user)){return finishGitHub(admitted,user,new URL(s.url).searchParams.get('state'),'test-code',config,transport);}
try{
 await initializeFixtureKeys(db,config.key);
 let user=await account();const other=await account();
 assert.equal((await connectionStatus(scope(user),user,undefined)).github.enabled,false);await assert.rejects(()=>startGitHub(scope(user),user,undefined));
 const ciphertext=await seal(config.key,'whumpo:github:token:user-one:record-one','secret');assert.ok(!ciphertext.includes('secret'));assert.equal(await unseal(config.key,'whumpo:github:token:user-one:record-one',ciphertext),'secret');await assert.rejects(()=>unseal(config.key,'whumpo:github:token:user-two:record-one',ciphertext));await assert.rejects(()=>unseal(fixtureKeyring('cd'.repeat(32)),'whumpo:github:token:user-one:record-one',ciphertext));
 const s=await start(user);assert.equal(new URL(s.url).origin,'https://github.com');assert.equal(new URL(s.url).searchParams.get('code_challenge_method'),'S256');assert.equal(new URL(s.url).searchParams.get('scope'),null);
 await assert.rejects(()=>finish(other,s,denied));const differentSession=await workspaceSession(db,m,identities.get(user));const differentScope=await differentSession.scope();await assert.rejects(()=>finish(user,s,denied,differentScope));
 await finish(user,s,provider(s,{includeRefresh:true}));let status=await connectionStatus(scope(user),user,config);assert.equal(status.github.connected,true);assert.equal(status.github.login,'synthetic-user');assert.ok(!JSON.stringify(status).includes('ghu_'));assert.equal((await connectionStatus(scope(other),other,config)).github.connected,false);
 const vault=await db.prepare('SELECT * FROM github_token_vault WHERE user_id=?').bind(user).first();assert.ok(!vault.ciphertext.includes('ghu_synthetic'));const refresh=await db.prepare('SELECT ciphertext FROM github_refresh_custody WHERE token_id=?').bind(vault.id).first();assert.ok(refresh);assert.ok(!refresh.ciphertext.includes('ghr_synthetic_refresh'));assert.equal(await unseal(config.key,`whumpo:github:refresh:${user}:${vault.id}`,refresh.ciphertext),'ghr_synthetic_refresh');
 const priorExchanges=exchanges;await assert.rejects(()=>finish(user,s,denied));assert.equal(exchanges,priorExchanges);
 const installations=await githubInstallations(scope(user),user,config,provider(s));assert.deepEqual(installations.installations,[{id:1,account:'synthetic-org',repositorySelection:'selected'}]);await assert.rejects(()=>githubInstallations(scope(other),other,config,denied));
 await assert.rejects(()=>db.prepare('INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,?)').bind(other,'99','other',vault.id,new Date().toISOString()).run());
 await disconnectGitHub(scope(user),user,config,provider(s,{revokeStatus:503}));status=await connectionStatus(scope(user),user,config);assert.equal(status.github.connected,false);assert.equal(status.github.revocationPending,true);await assert.rejects(()=>githubInstallations(scope(user),user,config,denied));
 await cleanupGitHub(db,config,provider(s));assert.equal((await connectionStatus(scope(user),user,config)).github.revocationPending,true);assert.ok(revocations.includes('ghu_synthetic'));assert.ok(await db.prepare('SELECT 1 FROM github_refresh_custody WHERE token_id=?').bind(vault.id).first());
 // Remaining access-token-only journeys use another account; the real refresh
 // obligation above cannot be purged as fixture setup or by token expiration.
 user=await account();
 const old=await start(user);const fresh=await start(user);await assert.rejects(()=>finish(user,old,denied));await finish(user,fresh,provider(fresh,{token:'ghu_fresh'}));
 const reconnect=await start(user);await finish(user,reconnect,provider(reconnect,{token:'ghu_reconnect'}));assert.ok(revocations.includes('ghu_fresh'));assert.equal((await connectionStatus(scope(user),user,config)).github.connected,true);
 const racing=await start(user);await assert.rejects(()=>finish(user,racing,provider(racing,{token:'ghu_racing',beforeUser:()=>disconnectGitHub(scope(user),user,config,provider(racing))})));assert.equal((await connectionStatus(scope(user),user,config)).github.connected,false);assert.ok(revocations.includes('ghu_racing'));
 const cancelled=await start(user);await cancelGitHub(scope(user),user,new URL(cancelled.url).searchParams.get('state'));await assert.rejects(()=>finish(user,cancelled,denied));
 const expired=await start(user);await db.prepare("UPDATE github_oauth_states SET expires_at='2000-01-01' WHERE user_id=?").bind(user).run();await assert.rejects(()=>finish(user,expired,denied));
 for(const options of [{token:'gho_wrong_app'},{token:'ghu_nonexpiring',expires:undefined},{token:'ghu_failed_user',userStatus:401}]){const flow=await start(user);const actual={...options};if(options.token==='ghu_nonexpiring')actual.expires=0;await assert.rejects(()=>finish(user,flow,provider(flow,actual)));assert.equal((await connectionStatus(scope(user),user,config)).github.connected,false);assert.ok(revocations.includes(options.token));}
 const redirectUser=await account(),redirect=await start(redirectUser);await assert.rejects(()=>finish(redirectUser,redirect,async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}})));await assert.rejects(()=>finish(redirectUser,redirect,denied));
 await assert.rejects(start(redirectUser),{status:409});
 const oversizedUser=await account(),oversized=await start(oversizedUser);await assert.rejects(()=>finish(oversizedUser,oversized,async()=>new Response('x'.repeat(524289))));
 const acknowledged=await start(user);let lost=false;
 const lossy=await identities.get(user).scope(interceptDatabase(db,/INSERT INTO github_connections/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost commit acknowledgement');}}));
 const beforeLost=exchanges;await finishGitHub(lossy,user,new URL(acknowledged.url).searchParams.get('state'),'test-code',config,provider(acknowledged,{token:'ghu_acknowledged'}));assert.equal(lost,true);assert.equal(exchanges,beforeLost+1);assert.equal((await connectionStatus(scope(user),user,config)).github.connected,true);
 // Provider replies cannot outlive the exact local authorization that sent them.
 let cancelledBody=false;
 await assert.rejects(githubInstallations(scope(user),user,config,async()=>{await disconnectGitHub(scope(user),user,undefined);return new Response(new ReadableStream({cancel(){cancelledBody=true;}}));}),e=>e.status===401);assert.equal(cancelledBody,true);
 const bodyFlow=await start(user);await finish(user,bodyFlow,provider(bodyFlow,{token:'ghu_body_race'}));
 let chunks=0;const encoder=new TextEncoder();
 await assert.rejects(githubInstallations(scope(user),user,config,async()=>new Response(new ReadableStream({async pull(controller){
  if(chunks++===0){controller.enqueue(encoder.encode('{"total_count":1,"installations":['));return;}
  await disconnectGitHub(scope(user),user,undefined);controller.enqueue(encoder.encode('{"id":1,"app_id":123,"account":{"login":"private-stale-org"}}]}'));controller.close();
 }}))),e=>e.status===401);
 const replacementFlow=await start(user);await finish(user,replacementFlow,provider(replacementFlow,{token:'ghu_before_replace'}));
 await assert.rejects(githubInstallations(scope(user),user,config,async()=>{const newer=await start(user);await finish(user,newer,provider(newer,{token:'ghu_after_replace'}));return Response.json({total_count:1,installations:[{id:1,app_id:123,account:{login:'stale-replaced-org'}}]});}),e=>e.status===401);assert.equal((await connectionStatus(scope(user),user,config)).github.connected,true);
 const staleAccess=await githubAccess(scope(user),user,config,denied,{projectId:null,operation:'read'});await disconnectGitHub(scope(user),user,undefined);await assert.rejects(staleAccess.assertCurrent(),e=>e.status===401);await assert.rejects(staleAccess.send('/user/installations?per_page=100'),e=>e.status===401);
 const writeFlow=await start(user);await finish(user,writeFlow,provider(writeFlow,{token:'ghu_write_race'}));let writes=0;
 const writing=await githubAccess(scope(user),user,config,async()=>{writes++;await disconnectGitHub(scope(user),user,undefined);return Response.json({data:{alreadyAccepted:true}});},{projectId:null,operation:'dispatch'});await assert.rejects(writing.send('/graphql',{method:'POST',body:'{}'}),e=>e.status===401);assert.equal(writes,1,'No automatic retry after a possibly accepted write');
 const final=await start(user);await finish(user,final,provider(final,{token:'ghu_expiring'}));await assert.rejects(db.prepare("UPDATE github_token_vault SET expires_at='2000-01-01' WHERE user_id=?").bind(user).run(),/github_vault_immutable/);await db.prepare('DELETE FROM github_token_vault WHERE user_id=?').bind(user).run();const expiredId=crypto.randomUUID();await db.prepare("INSERT INTO github_token_vault VALUES(?,?,?,'2000-01-01','active')").bind(expiredId,user,await seal(config.key,`whumpo:github:token:${user}:${expiredId}`,'ghu_expired_fixture')).run();await db.prepare('UPDATE github_connections SET active_token_id=? WHERE user_id=?').bind(expiredId,user).run();assert.equal((await connectionStatus(scope(user),user,config)).github.connected,false);await assert.rejects(()=>githubInstallations(scope(user),user,config,denied));await cleanupGitHub(db,config,denied);assert.equal((await db.prepare('SELECT COUNT(*) n FROM github_token_vault WHERE user_id=?').bind(user).first()).n,0);
 console.log('GitHub connection checks passed: PKCE, one-time session state, encrypted user-bound tokens, owner isolation, installation filtering, replacement, cancellation race, immediate disconnect, queued revocation, expiry and bounded provider failures. No real GitHub credentials were used.');
}finally{await fixture.close();}
