// Current handlers and schema; synthetic providers only, never real OAuth consent.
import assert from 'node:assert/strict';
Error.stackTraceLimit=0;
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,workspaceSession,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
const modules=await currentFixtureModules(['src/github-connection.ts','src/cloudflare-connection.ts','src/chat-interactions/store.ts','src/chat-interactions/connection-handoff.ts','src/chat-interactions/agent-request.ts','src/chat-interactions/protocol.ts']);
const g=await modules.module('src/github-connection.ts'),cf=await modules.module('src/cloudflare-connection.ts'),forms=await modules.module('src/chat-interactions/store.ts'),h=await modules.module('src/chat-interactions/connection-handoff.ts'),actions=await modules.module('src/chat-interactions/agent-request.ts'),protocol=await modules.module('src/chat-interactions/protocol.ts');
const fixture=await databaseFixture(),{db}=fixture,key=fixtureKeyring(),configs={github:{key,clientId:'synthetic-client',clientSecret:'synthetic-secret',slug:'synthetic',appId:1},cloudflare:{key,clientId:'synthetic-client',clientSecret:'synthetic-secret'}};
const id=()=>crypto.randomUUID(),run=(q,...v)=>db.prepare(q).bind(...v).run(),row=(q,...v)=>db.prepare(q).bind(...v).first();let cases=0,providerCalls=0;
async function test(name,fn){try{await fn();cases++;}catch(error){console.error(name);throw error;}}
async function owner(){const a=await workspaceFixture(db,modules.identity),user=a.account,scope=await a.scope(),project=id();await paidPlan(db,user,'business');await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Synthetic','draft',datetime('now'),datetime('now'))",project,user);return {...a,authority:a,user,scope,project};}
async function card(o,provider,projectId=o.project){const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Connect my account','Review connection',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);const input={originTurnId:turn,projectId,provider},plan=await forms.prepareConnectionIntake(o.scope,o.user,input);await o.scope.batch(plan.statements);const value=await forms.readInteraction(o.scope,o.user,plan.interactionId);return {input,plan,value,handoff:{interactionId:value.envelope.id,definitionDigest:value.envelope.definitionDigest}};}
const dismiss=(o,c)=>forms.mutateInteraction(o.scope,o.user,{version:1,requestId:id(),...c.handoff,expectedAnswerRevision:0,operation:'cancel'});
const state=started=>new URL(started.url).searchParams.get('state');
const provider=async(url,init)=>{providerCalls++;if(String(url).endsWith('/access_token'))return Response.json({access_token:'ghu_PRIVATE_SYNTHETIC',expires_in:3600});if(String(url).endsWith('/oauth2/token'))return Response.json({access_token:'PRIVATE_SYNTHETIC',token_type:'Bearer',expires_in:3600,scope:'zone.read dns.read dns.write'});if(String(url)==='https://api.github.com/user')return Response.json({id:1234,login:'synthetic'});throw Error('Unexpected provider request');};
try{
 await initializeFixtureKeys(db,key);
 await test('strict current body and agent vocabulary',async()=>{
  for(const input of [null,{},[],{handoff:undefined},{handoff:{interactionId:id(),definitionDigest:'bad'}},{handoff:null,url:'https://evil.invalid'}])assert.throws(()=>h.connectionStartInput(input),{status:400});
  assert.equal(h.connectionStartInput({handoff:null}),null);
  for(const projectId of [null,id()])assert(actions.interactionActionRequest({kind:'interaction',operation:'requestConnection',projectId,provider:'github'}));
  for(const extra of [{url:'https://evil.invalid'},{scopes:['admin']},{approve:true},{provider:'other'}])assert(!actions.interactionActionRequest({kind:'interaction',operation:'requestConnection',projectId:null,provider:'github',...extra}));
 });
 for(const p of ['github','cloudflare']){
  const start=p==='github'?g.startGitHub:cf.startCloudflare,finish=p==='github'?g.finishGitHub:cf.finishCloudflare,cancel=p==='github'?g.cancelGitHub:cf.cancelCloudflare;
  await test(p+' issuance and read are inert, exact replay and no secret projection',async()=>{
   const o=await owner(),c=await card(o,p),before=providerCalls;
   const replay=await forms.prepareConnectionIntake(o.scope,o.user,c.input);assert.equal(replay.interactionId,c.plan.interactionId);assert.equal(replay.statements.length,0);
   const read=await h.readConnectionHandoff(o.scope,o.user,p,c.handoff,configs);assert.equal(read.canStart,true);assert.equal(read.status.connected,false);assert.equal(read.status.authorizationPending,false);assert.equal(read.status.recoveryPending,false);
   assert.equal(await row(`SELECT 1 FROM ${p}_oauth_states WHERE user_id=?`,o.user),null);assert.equal(providerCalls,before);assert(!JSON.stringify(read).includes('synthetic-secret'));assert(!JSON.stringify(read).includes('ciphertext'));
   await protocol.requireCurrentClient(c.value.envelope,{versions:[1],fieldTypes:[],bindings:['connection.'+p+'@1']});
   await assert.rejects(forms.prepareConnectionIntake(o.scope,o.user,{...c.input,provider:p==='github'?'cloudflare':'github'}),{status:409});
  });
  await test(p+' exact session-bound return, pending state, cancellation and dismissed origin',async()=>{
   const o=await owner(),c=await card(o,p),begun=await start(o.scope,o.user,configs[p],c.handoff),other=await owner(),second=await workspaceSession(db,modules.identity,o);
   assert.equal(await h.connectionReturnPath(o.scope,o.user,p,state(begun)),'/workspace/?connection='+p+'&interaction='+c.handoff.interactionId);
   for(const who of [other,{user:o.user,scope:await second.scope()}])assert.equal(await h.connectionReturnPath(who.scope,who.user,p,state(begun)),'/workspace/?connection='+p);
   assert.equal((await h.readConnectionHandoff(o.scope,o.user,p,c.handoff,configs)).status.authorizationPending,true);
   await assert.rejects(run(`UPDATE ${p}_oauth_states SET handoff_json='null' WHERE user_id=?`,o.user),/oauth_handoff_immutable/);
   await dismiss(o,c);await assert.rejects(h.readConnectionHandoff(o.scope,o.user,p,c.handoff,configs),{status:409});
   // Hiding controls is not cancellation of already explicitly started consent.
   assert.equal(await h.connectionReturnPath(o.scope,o.user,p,state(begun)),'/workspace/?connection='+p+'&interaction='+c.handoff.interactionId);
   await cancel(o.scope,o.user,state(begun));await assert.rejects(finish(o.scope,o.user,state(begun),'synthetic-code',configs[p],provider),{status:400});assert.equal((p==='github'?(await g.connectionStatus(o.scope,o.user,configs.github)).github:await cf.cloudflareStatus(o.scope,o.user,configs.cloudflare)).authorizationPending,false);
  });
  await test(p+' foreign, changed provider/digest, closed and expired handoffs cannot start',async()=>{
   const o=await owner(),other=await owner(),c=await card(o,p),wrong=await card(o,p==='github'?'cloudflare':'github');
   for(const handoff of [wrong.handoff,{...c.handoff,definitionDigest:'c'.repeat(64)}])await assert.rejects(start(o.scope,o.user,configs[p],handoff),{status:409});
   await assert.rejects(start(other.scope,other.user,configs[p],c.handoff),{status:409});await dismiss(o,c);await assert.rejects(start(o.scope,o.user,configs[p],c.handoff),{status:409});
   assert.equal(await row(`SELECT 1 FROM ${p}_oauth_states WHERE user_id IN (?,?)`,o.user,other.user),null);
  });
  await test(p+' expiry and late ownership loss refuse start',async()=>{
   const o=await owner(),c=await card(o,p);
   const clock={prepare(sql){return db.prepare(sql.startsWith("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') now")?sql.replace("'now'","'now','+8 days'"):sql);},batch:db.batch.bind(db)};
   await assert.rejects(start(await o.authority.scope(clock),o.user,configs[p],c.handoff),{status:409});
   const other=await owner();let raced=0;
   const proxy=interceptDatabase(db,new RegExp('INSERT INTO '+p+'_oauth_states'),async()=>{raced++;await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);});
   await assert.rejects(start(await o.authority.scope(proxy),o.user,configs[p],c.handoff),{status:409});assert.equal(raced,1);assert.equal(await row(`SELECT 1 FROM ${p}_oauth_states WHERE user_id=?`,o.user),null);
  });
  await test(p+' late dismissal rolls back authorization start',async()=>{
   const o=await owner(),c=await card(o,p);let raced=0;
   const proxy=interceptDatabase(db,new RegExp('INSERT INTO '+p+'_oauth_states'),async()=>{raced++;await dismiss(o,c);});const scoped=await o.authority.scope(proxy);
   await assert.rejects(start(scoped,o.user,configs[p],c.handoff),{status:409});assert.equal(raced,1);assert.equal(await row(`SELECT 1 FROM ${p}_oauth_states WHERE user_id=?`,o.user),null);
  });
  await test(p+' current successful consent and replay never re-exchanges',async()=>{
   const o=await owner(),c=await card(o,p,null),begun=await start(o.scope,o.user,configs[p],c.handoff),before=providerCalls;
   await finish(o.scope,o.user,state(begun),'synthetic-code',configs[p],provider);const after=providerCalls;assert(after>before);
   const read=await h.readConnectionHandoff(o.scope,o.user,p,c.handoff,configs);assert.equal(read.status.connected,true);assert.equal(read.status.authorizationPending,false);assert.equal(read.status.recoveryPending,false);assert(!JSON.stringify(read).includes('PRIVATE_SYNTHETIC'));
   await assert.rejects(finish(o.scope,o.user,state(begun),'synthetic-code',configs[p],provider),{status:400});assert.equal(providerCalls,after);
  });
  await test(p+' lost token response stays unknown and blocks new consent',async()=>{
   const o=await owner(),c=await card(o,p),begun=await start(o.scope,o.user,configs[p],c.handoff);let calls=0;
   await assert.rejects(finish(o.scope,o.user,state(begun),'synthetic-code',configs[p],async()=>{calls++;throw Error('Synthetic lost token response');}),{status:503});
   const read=await h.readConnectionHandoff(o.scope,o.user,p,c.handoff,configs);assert.equal(read.status.connected,false);assert.equal(read.status.recoveryPending,true);
   await assert.rejects(start(o.scope,o.user,configs[p],c.handoff),{status:409});assert.equal(calls,1);
  });
 }
 console.log(JSON.stringify({success:true,cases,database:fixture.mode??(process.argv.includes('--d1')?'d1':'sqlite'),syntheticProviderCalls:providerCalls,realProviderCalls:0}));
}finally{await fixture.close();}
