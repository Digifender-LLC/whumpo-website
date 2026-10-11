import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sqliteD1} from './sqlite-d1.mjs';
import {fixtureKeyring,initializeFixtureKeys,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';

// WH-203 ProviderRevoker adapters and connection-state mapping (src/email-change/provider-revokers.ts and
// connection-holds.ts), driven through the source revocation steps (revocation.ts) by a storage-only driver. Every
// provider is a synthetic transport; every credential is a SYNTHETIC-<KIND>-<NNNN> canary. No network, no provider
// account, no real credential, no model. The agreement checks run the EXISTING cleaners (cleanupGitHub,
// cleanupCloudflare) on the current schema in an in-memory SQLite database through their own injected transport, and
// compare their requests and receipt decisions with the adapters'. This proves the adapters and the mapping, not D1
// atomicity or the WH-201 wiring (WH-201/204). Every suite check also runs against deliberately broken copies of the
// two new files (mutants below).
const root=fileURLToPath(new URL('..',import.meta.url));
const read=file=>readFileSync(join(root,file),'utf8');
const PR='src/email-change/provider-revokers.ts',CH='src/email-change/connection-holds.ts';
const entry="export * from './src/email-change/revocation';export * from './src/email-change/provider-revokers';export * from './src/email-change/connection-holds';export {EmailChangeError} from './src/email-change/policy';";
async function bundleSource(overrides={}){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',plugins:[plugin]});
 return out.outputFiles[0].text;
}
const importText=text=>import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const settle=promise=>promise.then(value=>({value}),error=>({error}));
const unwrap=async promise=>{const r=await promise;if(r.error)throw r.error;return r.value;};

const CLIENT='Iv1.synthetic',CF_CLIENT='synthetic-client',SECRET='SYNTHETIC-SECRET-0001';
const GH_ACCESS='SYNTHETIC-GHACCESS-0001',GH_ACCESS_B='SYNTHETIC-GHACCESS-0002',GH_REFRESH='SYNTHETIC-GHREFRESH-0001';
const CF_ACCESS='SYNTHETIC-CFACCESS-0001',CF_REFRESH='SYNTHETIC-CFREFRESH-0001';
const canaries=[SECRET,GH_ACCESS,GH_ACCESS_B,GH_REFRESH,CF_ACCESS,CF_REFRESH,btoa(CLIENT+':'+SECRET),btoa(CF_CLIENT+':'+SECRET)];
const NOW=Date.UTC(2026,9,9),DAY=864e5;
const UUID=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

/** A synthetic provider: records every call and answers from a script (a reply, an Error to throw, or a function). */
function provider(script){
 const calls=[];
 const transport=async(url,init)=>{
  calls.push({url,init});
  const next=typeof script==='function'?script(url,init,calls.length):Array.isArray(script)?script[calls.length-1]:script;
  if(next instanceof Error)throw next;
  return next;
 };
 return {calls,transport};
}
/** The Response fields the adapters read (a plain object, so redirected and opaque replies can be scripted). */
const reply=(status,extra={})=>({status,redirected:false,type:'basic',body:{cancel:async()=>{}},...extra});

/** Storage-only driver: keeps the records the source returns under revision guards and the synthetic ciphertext the
 * caller holds; it makes no revocation decision. */
function store(m,connections){
 const s={rows:{},ciphertexts:{}};
 connections.forEach((c,i)=>{s.rows[c.connectionId]=c;s.ciphertexts[c.connectionId]=`SYNTHETIC-CIPHERTEXT-${String(i+1).padStart(4,'0')}`;});
 const put=next=>{assert.equal(s.rows[next.connectionId].revision,next.revision-1,'revision guard');s.rows[next.connectionId]=next;if(!next.credentialHeld)delete s.ciphertexts[next.connectionId];};
 const putIfNext=next=>{if(next.revision===s.rows[next.connectionId].revision+1)put(next);};
 return {s,
  queue(id){putIfNext(m.disableForReview(s.rows[id]));return s.rows[id].revocation.state;},
  async dispatch(id,revoker,{interrupt=false}={}){
   const step=await m.dispatchRevocation({connection:s.rows[id],revoker,now:NOW,claim:c=>{put(c);if(interrupt)throw new Error('INTERRUPTED');return true;}});
   putIfNext(step.connection);return step.outcome;
  },
  reconcile(id,evidence){put(m.reconcileRevocation({connection:s.rows[id],evidence,now:NOW}));return s.rows[id].revocation.state;},
  erase(id){putIfNext(m.eraseConnectionCredential(s.rows[id]));return s.ciphertexts[id]===undefined;},
  state:id=>({access:s.rows[id].access,credentialHeld:s.rows[id].credentialHeld,revocation:s.rows[id].revocation.state}),
 };
}

async function suite(m){
 let count=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const refuses=(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code,e.message);return true;});
 const ghHeld=(over={})=>({clientId:CLIENT,accessToken:GH_ACCESS,refreshHeld:false,accessRevoked:false,grantPending:false,...over});
 const github=(script,held=ghHeld(),events=[])=>{const p=provider(script);return {...p,events,revoker:m.createGitHubRevoker({clientId:CLIENT,clientSecret:SECRET,transport:p.transport,open:()=>typeof held==='function'?held():held,observe:e=>events.push(e)})};};
 const cloudflare=(script,held={access:CF_ACCESS},events=[])=>{const p=provider(script);return {...p,events,revoker:m.createCloudflareRevoker({clientId:CF_CLIENT,clientSecret:SECRET,transport:p.transport,open:()=>typeof held==='function'?held():held,observe:e=>events.push(e)})};};
 const ghRows=(tokens,over={})=>({connection:null,custody:[],claims:[],grants:[],tokens,...over});
 /** A queued GitHub and Cloudflare connection, mapped from current vault rows and disabled by a review. */
 function queued(){
  const gh=m.githubConnectionHolds({accountId:'owner-a',now:NOW,rows:ghRows([{id:UUID(1),user_id:'owner-a',expires_at:'2026-10-10T00:00:00.000Z',state:'active'}],{connection:{user_id:'owner-a',active_token_id:UUID(1)}})});
  const cf=m.cloudflareConnectionHolds({accountId:'owner-a',now:NOW,tokens:[{id:UUID(2),user_id:'owner-a',expires_at:'2026-10-10T00:00:00.000Z',state:'active',revoke_after:null}]});
  const st=store(m,[...gh,...cf]);
  for(const id of [`gh-${UUID(1)}`,`cf-${UUID(2)}`])assert.equal(st.queue(id),'queued');
  return st;
 }

 await test('GitHub receipt rule: only an exact non-redirected 204 to the single-token deletion is a receipt',async()=>{
  const ok=github(reply(204));
  assert.equal(await ok.revoker.revoke({provider:'github',connectionId:'gh-1'}),'revoked');
  assert.equal(ok.calls.length,1);
  const [{url,init}]=ok.calls;
  assert.equal(url,`https://api.github.com/applications/${CLIENT}/token`);
  assert.deepEqual([init.method,init.redirect,init.signal instanceof AbortSignal],['DELETE','manual',true]);
  assert.equal(init.headers.authorization,'Basic '+btoa(CLIENT+':'+SECRET));
  assert.deepEqual(JSON.parse(init.body),{access_token:GH_ACCESS});
  for(const r of [reply(200),reply(202),reply(404),reply(422),reply(500),reply(204,{redirected:true}),reply(0,{type:'opaqueredirect'}),null,{}]){
   const p=github(r);assert.equal(await p.revoker.revoke({provider:'github',connectionId:'gh-1'}),'unknown',JSON.stringify(r?.status));assert.equal(p.calls.length,1);
  }
  // Nothing is sent for another provider, another app client or an unreadable credential.
  for(const [request,held,outcome] of [[{provider:'cloudflare',connectionId:'cf-1'},ghHeld(),'unrecognized'],[{provider:'github',connectionId:'gh-1'},ghHeld({clientId:'Iv1.other'}),'not-revoked'],
   [{provider:'github',connectionId:'gh-1'},()=>{throw new Error('unseal failed');},'not-revoked'],[{provider:'github',connectionId:'gh-1'},null,'not-revoked']]){
   const p=github(reply(204),held);assert.equal(await p.revoker.revoke(request),outcome);assert.equal(p.calls.length,0);
  }
  // Through the dispatcher: the receipt erases the credential in the same write.
  const st=queued(),gh=github(reply(204)),id=`gh-${UUID(1)}`;
  assert.equal(await st.dispatch(id,gh.revoker),'revoked');
  assert.deepEqual(st.state(id),{access:'disabled',credentialHeld:false,revocation:'revoked'});
  assert.equal(st.s.rows[id].revocation.receipt.evidence,'direct');
 });
 await test('GitHub single-token 204 never settles a retained refresh credential or the grant',async()=>{
  const st=queued(),id=`gh-${UUID(1)}`,gh=github(reply(204),ghHeld({refreshHeld:true}));
  assert.equal(await st.dispatch(id,gh.revoker),'unknown');
  assert.deepEqual(st.state(id),{access:'disabled',credentialHeld:true,revocation:'uncertain'});
  assert.deepEqual(gh.calls.map(c=>new URL(c.url).pathname),[`/applications/${CLIENT}/token`],'the app-wide grant deletion is never sent');
  assert.equal(gh.events.at(-1).outcome,'access-revoked-refresh-held');
  await refuses(()=>st.erase(id),'RECONCILIATION_HOLD');
  assert.ok(m.closureHolds(Object.values(st.s.rows)).includes(id));
  // Already-observed access revocation, a pending reviewed grant deletion, or unknown custody: nothing is sent and nothing settles.
  for(const [held,outcome] of [[ghHeld({refreshHeld:true,accessRevoked:true}),'refresh-held'],[ghHeld({grantPending:true}),'grant-pending'],[ghHeld({refreshHeld:true,grantPending:true}),'grant-pending']]){
   const p=github(reply(204),held);assert.equal(await p.revoker.revoke({provider:'github',connectionId:id}),outcome);assert.equal(p.calls.length,0);
  }
  const unknownCustody=github(reply(204),ghHeld({refreshHeld:undefined}));
  assert.notEqual(await unknownCustody.revoker.revoke({provider:'github',connectionId:id}),'revoked');
 });
 await test('Cloudflare receipt rule: an exact 200 for every known token',async()=>{
  const one=cloudflare(reply(200));
  assert.equal(await one.revoker.revoke({provider:'cloudflare',connectionId:'cf-1'}),'revoked');
  const [{url,init}]=one.calls;
  assert.equal(url,'https://dash.cloudflare.com/oauth2/revoke');
  assert.deepEqual([init.method,init.redirect,init.signal instanceof AbortSignal,init.headers['content-type']],['POST','manual',true,'application/x-www-form-urlencoded']);
  assert.equal(init.headers.authorization,'Basic '+btoa(encodeURIComponent(CF_CLIENT)+':'+encodeURIComponent(SECRET)));
  assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)),{token:CF_ACCESS,token_type_hint:'access_token'});
  const both=cloudflare([reply(200),reply(200)],{access:CF_ACCESS,refresh:CF_REFRESH});
  assert.equal(await both.revoker.revoke({provider:'cloudflare',connectionId:'cf-1'}),'revoked');
  assert.deepEqual(both.calls.map(c=>Object.fromEntries(new URLSearchParams(c.init.body))),[{token:CF_ACCESS,token_type_hint:'access_token'},{token:CF_REFRESH,token_type_hint:'refresh_token'}]);
  for(const script of [[reply(200),reply(400)],[reply(400),reply(200)],[reply(204),reply(200)],[reply(200),reply(200,{redirected:true})],[reply(503),reply(503)]]){
   const p=cloudflare(script,{access:CF_ACCESS,refresh:CF_REFRESH});
   assert.equal(await p.revoker.revoke({provider:'cloudflare',connectionId:'cf-1'}),'unknown',script.map(r=>r.status).join());
   assert.equal(p.calls.length,2,'every known token is sent once');
  }
  // A transport loss stops the attempt, as the existing cleaner does.
  const lost=cloudflare([new Error('lost')],{access:CF_ACCESS,refresh:CF_REFRESH});
  assert.equal(await lost.revoker.revoke({provider:'cloudflare',connectionId:'cf-1'}),'unknown');assert.equal(lost.calls.length,1);
  for(const [request,held,outcome] of [[{provider:'github',connectionId:'gh-1'},{access:CF_ACCESS},'unrecognized'],[{provider:'cloudflare',connectionId:'cf-1'},null,'not-revoked'],[{provider:'cloudflare',connectionId:'cf-1'},{access:''},'not-revoked']]){
   const p=cloudflare(reply(200),held);assert.equal(await p.revoker.revoke(request),outcome);assert.equal(p.calls.length,0);
  }
 });
 await test('unknown outcomes are held as uncertain and never resent',async()=>{
  const timeout=()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});
  for(const [ghScript,cfScript] of [[timeout(),timeout()],[new Error('lost'),new Error('lost')],[reply(500),reply(500)],[reply(204,{redirected:true}),reply(200,{redirected:true})]]){
   const st=queued(),gh=github(ghScript),cf=cloudflare(cfScript);
   for(const [id,p] of [[`gh-${UUID(1)}`,gh],[`cf-${UUID(2)}`,cf]]){
    assert.equal(await st.dispatch(id,p.revoker),'unknown');
    assert.deepEqual(st.state(id),{access:'disabled',credentialHeld:true,revocation:'uncertain'});
    assert.equal(await st.dispatch(id,p.revoker),'not-queued');
    assert.equal(st.queue(id),'uncertain','a second review leaves the hold');
    assert.equal(await st.dispatch(id,p.revoker),'not-queued');
    assert.equal(p.calls.length,1,'never resent');
   }
  }
  // An attempt interrupted after its claim: no call, then uncertain without a call.
  const st=queued(),gh=github(reply(204)),id=`gh-${UUID(1)}`;
  await assert.rejects(st.dispatch(id,gh.revoker,{interrupt:true}),/INTERRUPTED/);
  assert.equal(await st.dispatch(id,gh.revoker),'unknown');assert.equal(gh.calls.length,0);
  assert.deepEqual(st.state(id),{access:'disabled',credentialHeld:true,revocation:'uncertain'});
  // Nothing sent (unreadable credential) is a definitive no-op: the same retired credential stays queued.
  const st2=queued(),none=github(reply(204),null);
  assert.equal(await st2.dispatch(id,none.revoker),'retry');assert.deepEqual([st2.state(id).revocation,none.calls.length],['queued',0]);
 });
 await test('reconciliation is read-only and accepts only the exact saved grant receipt',async()=>{
  const st=queued(),id=`gh-${UUID(1)}`,gh=github(reply(204),ghHeld({refreshHeld:true}));
  await st.dispatch(id,gh.revoker);
  const grant=(over={})=>({user_id:'owner-a',client_id:CLIENT,token_ids:JSON.stringify([UUID(1),UUID(9)]),state:'revoked',http_status:204,...over});
  for(const grants of [[],[grant({token_ids:JSON.stringify([UUID(9)])})],[grant({client_id:'Iv1.other'})],[grant({user_id:'owner-b'})],[grant({state:'uncertain',http_status:null})],
   [grant({state:'cancelled',http_status:null})],[grant({state:'review',http_status:null})],[grant({http_status:null})],[grant({token_ids:'not json'})]])
   assert.equal(m.githubReconcileEvidence({userId:'owner-a',clientId:CLIENT,tokenId:UUID(1),grants}),null,JSON.stringify(grants));
  const evidence=m.githubReconcileEvidence({userId:'owner-a',clientId:CLIENT,tokenId:UUID(1),grants:[grant({state:'cancelled',http_status:null}),grant()]});
  assert.deepEqual(evidence,{authenticated:true,result:'revoked'});
  assert.equal(st.reconcile(id,evidence),'revoked');
  assert.equal(st.s.rows[id].revocation.receipt.evidence,'reconciled');
  assert.equal(gh.calls.length,1,'reconciliation calls no provider');
 });
 await test('a credential is erased only with an exact receipt',async()=>{
  const st=queued(),gid=`gh-${UUID(1)}`,cid=`cf-${UUID(2)}`;
  for(const id of [gid,cid])await refuses(()=>st.erase(id),'RECONCILIATION_HOLD');
  assert.equal(await st.dispatch(gid,github(reply(404)).revoker),'unknown');
  assert.equal(await st.dispatch(cid,cloudflare([reply(200),reply(400)],{access:CF_ACCESS,refresh:CF_REFRESH}).revoker),'unknown');
  for(const id of [gid,cid]){await refuses(()=>st.erase(id),'RECONCILIATION_HOLD');assert.ok(st.s.ciphertexts[id]);}
  for(let i=0;i<m.revocationBounds.reconcileReads;i++)st.reconcile(cid,{authenticated:true,result:'not-found'});
  assert.equal(st.state(cid).revocation,'unresolved');await refuses(()=>st.erase(cid),'RECONCILIATION_HOLD');
  assert.deepEqual(m.closureHolds(Object.values(st.s.rows)),[cid,gid].sort());
  const fresh=queued();
  assert.equal(await fresh.dispatch(cid,cloudflare([reply(200),reply(200)],{access:CF_ACCESS,refresh:CF_REFRESH}).revoker),'revoked');
  assert.equal(fresh.s.ciphertexts[cid],undefined);assert.ok(fresh.erase(cid));
  assert.deepEqual(m.closureHolds(Object.values(fresh.s.rows)),[gid],'only the still-queued GitHub credential holds closure');
 });
 await test('existing connection states map onto revocation holds',async()=>{
  const t=(n,state,over={})=>({id:UUID(n),user_id:'owner-a',expires_at:'2026-10-10T00:00:00.000Z',state,...over});
  const future='2026-10-09T00:01:00.000Z',past='2026-10-08T23:59:00.000Z';
  const rows=ghRows([t(1,'active'),t(2,'active'),t(3,'active',{expires_at:past}),t(4,'revoking'),t(5,'revoking'),t(6,'revoking'),t(7,'revoking'),t(8,'revoking'),t(9,'revoking'),t(10,'revoking')],{
   connection:{user_id:'owner-a',active_token_id:UUID(1)},
   custody:[{token_id:UUID(5),user_id:'owner-a',client_id:CLIENT,access_revoked_at:'2026-10-08T00:00:00.000Z'},{token_id:UUID(6),user_id:'owner-a',client_id:CLIENT,access_revoked_at:null}],
   claims:[{token_id:UUID(6),expires_at:future},{token_id:UUID(4),expires_at:past}],
   grants:[{user_id:'owner-a',token_ids:JSON.stringify([UUID(7)]),state:'uncertain',settled_at:null},{user_id:'owner-a',token_ids:JSON.stringify([UUID(8)]),state:'dispatching',settled_at:null},
    {user_id:'owner-a',token_ids:JSON.stringify([UUID(9)]),state:'revoked',settled_at:'2026-10-08T00:00:00.000Z'},{user_id:'owner-a',token_ids:JSON.stringify([UUID(10),UUID(2)]),state:'cancelled',settled_at:null}]});
  const gh=m.githubConnectionHolds({accountId:'owner-a',rows,now:NOW});
  assert.deepEqual(gh.map(c=>[c.connectionId.slice(-2),c.access,c.revocation.state,c.credentialHeld]),[
   ['01','active','none',true],['02','disabled','none',true],['03','disabled','none',true],['04','disabled','queued',true],['05','disabled','uncertain',true],
   ['06','disabled','dispatching',true],['07','disabled','uncertain',true],['08','disabled','dispatching',true],['09','disabled','revoked',true],['10','disabled','queued',true]]);
  assert.equal(gh[8].revocation.receipt.evidence,'reconciled');assert.ok(m.eraseConnectionCredential(gh[8]).credentialHeld===false);
  assert.deepEqual(m.closureHolds(gh).map(x=>x.slice(-2)),['04','05','06','07','08','10']);
  for(const c of gh)assert.match(c.connectionId,/^[A-Za-z0-9-]{1,64}$/);
  const cf=m.cloudflareConnectionHolds({accountId:'owner-a',now:NOW,tokens:[t(1,'active',{revoke_after:null}),t(2,'active',{expires_at:past,revoke_after:null}),t(3,'staged',{revoke_after:null}),t(4,'revoking',{revoke_after:future}),t(5,'revoking',{revoke_after:past}),t(6,'revoking',{revoke_after:null})]});
  assert.deepEqual(cf.map(c=>[c.connectionId.slice(0,3)+c.connectionId.slice(-2),c.access,c.revocation.state]),[['cf-01','active','none'],['cf-02','disabled','none'],['cf-03','disabled','none'],['cf-04','disabled','dispatching'],['cf-05','disabled','queued'],['cf-06','disabled','queued']]);
  await refuses(()=>m.githubConnectionHolds({accountId:'owner-a',now:NOW,rows:ghRows([t(1,'staged')])}),'UNKNOWN_STATE');
  await refuses(()=>m.githubConnectionHolds({accountId:'owner-a',now:NOW,rows:ghRows([t(1,'revoking')],{grants:[{user_id:'owner-a',token_ids:'[]',state:'expired',settled_at:null}]})}),'UNKNOWN_STATE');
  await refuses(()=>m.cloudflareConnectionHolds({accountId:'owner-a',now:NOW,tokens:[t(1,'revoked',{revoke_after:null})]}),'UNKNOWN_STATE');
  await refuses(()=>m.githubConnectionHolds({accountId:'owner-a',now:NOW,rows:ghRows([t(1,'active',{user_id:'owner-b'})])}),'FOREIGN_ROW');
  await refuses(()=>m.cloudflareConnectionHolds({accountId:'owner-a',now:NOW,tokens:[t(1,'active',{user_id:'owner-b',revoke_after:null})]}),'FOREIGN_ROW');
 });
 await test('closure blockers cover holds, live credentials and unresolved exchanges',async()=>{
  const live=m.cloudflareConnectionHolds({accountId:'owner-a',now:NOW,tokens:[{id:UUID(1),user_id:'owner-a',expires_at:'2026-10-10T00:00:00.000Z',state:'active',revoke_after:null}]});
  assert.deepEqual(m.connectionClosureBlockers({accountId:'owner-a',connections:live,exchanges:[]}),{holds:[],live:[`cf-${UUID(1)}`],exchanges:[],blocked:true});
  assert.deepEqual(m.connectionClosureBlockers({accountId:'owner-a',connections:[],exchanges:[{token_id:UUID(3),user_id:'owner-a',provider:'github'},{token_id:UUID(4),user_id:'owner-b',provider:'github'}]}),
   {holds:[],live:[],exchanges:[`exchange-github-${UUID(3)}`],blocked:true});
  assert.deepEqual(m.connectionClosureBlockers({accountId:'owner-a',connections:[],exchanges:[]}),{holds:[],live:[],exchanges:[],blocked:false});
  const zero=Object.fromEntries(m.closureInventoryConnectionMetrics.map(k=>[k,0]));
  assert.deepEqual(m.closureInventoryConnectionHolds(zero),[]);
  for(const name of ['githubCredentials','cloudflareCredentials','githubRefreshCustody','githubGrantUncertain','unresolvedConnectionExchanges'])
   assert.deepEqual(m.closureInventoryConnectionHolds({...zero,[name]:2}),[name]);
  await refuses(()=>m.closureInventoryConnectionHolds({...zero,githubCredentials:null}),'UNKNOWN_STATE');
 });
 await test('no secret in any receipt, event, error or stored record',async()=>{
  const events=[],errors=[];
  const st=queued(),gid=`gh-${UUID(1)}`,cid=`cf-${UUID(2)}`;
  const gh=github(reply(204),ghHeld({refreshHeld:true}),events),cf=cloudflare([reply(200),reply(500)],{access:CF_ACCESS,refresh:CF_REFRESH},events);
  await st.dispatch(gid,gh.revoker);await st.dispatch(cid,cf.revoker);
  const ok=queued(),cf2=cloudflare([reply(200),reply(200)],{access:CF_ACCESS,refresh:CF_REFRESH},events);await ok.dispatch(cid,cf2.revoker);
  await github(new Error(`lost ${GH_ACCESS}`),ghHeld(),events).revoker.revoke({provider:'github',connectionId:gid});
  for(const make of [()=>m.createGitHubRevoker({clientId:'bad client',clientSecret:SECRET,transport:async()=>reply(204),open:()=>null}),()=>m.createCloudflareRevoker({clientId:CF_CLIENT,clientSecret:'',transport:async()=>reply(200),open:()=>null}),
   ()=>m.createCloudflareRevoker({clientId:'bad client',clientSecret:SECRET,transport:async()=>reply(200),open:()=>null})])
   assert.throws(make,e=>{errors.push(String(e?.message),String(e?.stack));return true;});
  assert.ok(events.length>=4);
  for(const e of events)assert.deepEqual(Object.keys(e).sort(),['calls','connectionId','outcome','provider']);
  const text=JSON.stringify([events,errors,st.s.rows,ok.s.rows,m.adapterOutcomes]);
  for(const secret of canaries)assert.ok(!text.includes(secret),'secret material in an adapter record');
 });
 return count;
}

// ---------- Mutation check: each deliberately broken copy of the new files must fail the suite ----------
const mutants=[
 ['GitHub accepts any 2xx',PR,"if(!exact(reply,204))return report(connectionId,[{hint:'access_token',status}],'unknown');","if(!(status!==null&&status>=200&&status<300))return report(connectionId,[{hint:'access_token',status}],'unknown');"],
 ['redirected reply accepted as a receipt',PR,"reply.status===status&&reply.redirected!==true&&reply.type!=='opaqueredirect'","reply.status===status"],
 ['GitHub app-wide grant deletion sent',PR,"'https://api.github.com/applications/'+clientId+'/token'","'https://api.github.com/applications/'+clientId+'/grant'"],
 ['GitHub credential of another app client sent',PR,"||held.clientId!==clientId)return report","||false)return report"],
 ['single-token 204 settles a retained refresh credential',PR,"held.refreshHeld===false?'revoked':'access-revoked-refresh-held'","'revoked'"],
 ['observed access revocation treated as settled',PR,"if(held.accessRevoked===true)return report(connectionId,[],'refresh-held');","if(held.accessRevoked===true)return report(connectionId,[],'revoked');"],
 ['GitHub sends during a pending grant deletion',PR,"if(held.grantPending===true)return report(connectionId,[],'grant-pending');",''],
 ['GitHub transport loss reported as nothing sent',PR,"}catch{return report(connectionId,[{hint:'access_token',status:null}],'unknown');}","}catch{return report(connectionId,[{hint:'access_token',status:null}],'not-revoked');}"],
 ['Cloudflare partial token set accepted',PR,"if(!exact(reply,200))complete=false;","complete=exact(reply,200);"],
 ['Cloudflare accepts 204',PR,"if(!exact(reply,200))complete=false;","if(!exact(reply,200)&&!exact(reply,204))complete=false;"],
 ['Cloudflare refresh token not revoked',PR,"[held.refresh,'refresh_token']","[null,'refresh_token']"],
 ['configuration error reveals the client secret',PR,"throw new Error(`${provider} revoker is not configured`);","throw new Error(`${provider} revoker is not configured: ${String(clientSecret)}`);"],
 ['reconciliation accepts a receipt for another token',PR,"&&Array.isArray(ids)&&ids.includes(tokenId))","&&Array.isArray(ids))"],
 ['reconciliation accepts an unsettled grant',PR,"if(grant.state==='revoked'&&grant.http_status===204&&","if("],
 ['observed access revocation mapped as queued',CH,"if(custody.access_revoked_at!==null)return held(accountId,connectionId,'github','disabled','uncertain');",''],
 ['uncertain grant deletion not mapped as a hold',CH,"if(grants.some(g=>g.state==='uncertain'))return held(accountId,connectionId,'github','disabled','uncertain');",''],
 ['cancelled grant review treated as a receipt',CH,"const settled=grants.find(g=>g.state==='revoked');","const settled=grants.find(g=>g.state==='revoked'||g.state==='cancelled');"],
 ['unknown vault state accepted',CH,"check((githubCredentialStates as readonly string[]).includes(token.state),'UNKNOWN_STATE',token.state);",''],
 ['foreign vault row mapped',CH,"check(token.user_id===accountId,'FOREIGN_ROW','github_token_vault');",''],
 ['Cloudflare revoke lease not mapped as in flight',CH,"token.revoke_after!==null&&token.revoke_after>at?'dispatching':'queued'","'queued'"],
 ['live credential does not block closure',CH,"blocked:holds.length+live.length+unresolved.length>0","blocked:holds.length+unresolved.length>0"],
 ['unresolved exchange does not block closure',CH,",'githubGrantUncertain','unresolvedConnectionExchanges']",",'githubGrantUncertain']"],
];
const killedBy={
 'GitHub accepts any 2xx':'GitHub receipt rule','redirected reply accepted as a receipt':'GitHub receipt rule','GitHub app-wide grant deletion sent':'GitHub receipt rule',
 'GitHub credential of another app client sent':'GitHub receipt rule',
 'single-token 204 settles a retained refresh credential':'GitHub single-token 204','observed access revocation treated as settled':'GitHub single-token 204',
 'GitHub sends during a pending grant deletion':'GitHub single-token 204',
 'GitHub transport loss reported as nothing sent':'unknown outcomes are held',
 'Cloudflare partial token set accepted':'Cloudflare receipt rule','Cloudflare accepts 204':'Cloudflare receipt rule','Cloudflare refresh token not revoked':'Cloudflare receipt rule',
 'configuration error reveals the client secret':'no secret in any receipt',
 'reconciliation accepts a receipt for another token':'reconciliation is read-only','reconciliation accepts an unsettled grant':'reconciliation is read-only',
 'observed access revocation mapped as queued':'existing connection states map','uncertain grant deletion not mapped as a hold':'existing connection states map',
 'cancelled grant review treated as a receipt':'existing connection states map','unknown vault state accepted':'existing connection states map',
 'foreign vault row mapped':'existing connection states map','Cloudflare revoke lease not mapped as in flight':'existing connection states map',
 'live credential does not block closure':'closure blockers','unresolved exchange does not block closure':'closure blockers',
};

const source=await importText(await bundleSource());
const prepared=mutants.map(([name,file,find,replace])=>{
 assert.ok(file===PR||file===CH,`mutant "${name}" targets ${file}, outside the new files`);
 const text=read(file);
 assert.equal(text.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
 return settle(bundleSource({[file]:text.replace(find,()=>replace)}));
});
const existingBuild=settle(build({stdin:{contents:"export {cleanupGitHub} from './src/github-connection';export {cleanupCloudflare} from './src/cloudflare-connection';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'}));
const suiteCount=await suite(source);
let total=suiteCount;
const checkOnce=async(name,fn)=>{try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}};

// ---------- Agreement with the existing cleaners on the current schema (SQLite, synthetic transport) ----------
const existing=await importText((await unwrap(existingBuild)).outputFiles[0].text);
const keyring=fixtureKeyring('cd'.repeat(32));
const ghConfig={clientId:CLIENT,clientSecret:SECRET,appId:123,slug:'fixture',key:keyring},cfConfig={clientId:CF_CLIENT,clientSecret:SECRET,key:keyring};
const fixture=await sqliteD1(),{sql,db}=fixture;
try{
 await initializeFixtureKeys(db,keyring);
 const policy=sql.prepare('SELECT active_key,revision FROM connection_key_policy').get();
 sql.exec("INSERT INTO users(id,email,created_at) VALUES ('owner-a','a@example.invalid','2026-10-09'),('owner-b','b@example.invalid','2026-10-09')");
 const ghVault=async(user,id,token,state='revoking')=>sql.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)").run(id,user,await fixtureCiphertext(keyring,`whumpo:github:token:${user}:${id}`,token),state);
 const cfVault=async(user,id,tokens,state='revoking')=>sql.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES (?,?,?,'2099-01-01T00:00:00.000Z','2026-10-09T00:00:00.000Z',?)").run(id,user,await fixtureCiphertext(keyring,`whumpo:cloudflare:token:${user}:${id}`,JSON.stringify(tokens)),state);
 async function custody(user,id,token,refresh){
  sql.prepare("INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state) VALUES (?,?,'github',?,?,?,?,'dispatched')").run(id,user,CLIENT,'f'.repeat(63)+id.slice(-1),policy.active_key,policy.revision);
  await ghVault(user,id,token);
  sql.prepare('INSERT INTO github_refresh_custody(token_id,user_id,client_id,github_user_id,ciphertext,expires_at,access_revoked_at) VALUES (?,?,?,NULL,?,NULL,NULL)').run(id,user,CLIENT,await fixtureCiphertext(keyring,`whumpo:github:refresh:${user}:${id}`,refresh));
  sql.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=?').run(id);
 }
 const gone=(table,id)=>!sql.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id);
 const strip=({url,init})=>({url,method:init.method,redirect:init.redirect,headers:Object.fromEntries(Object.entries(init.headers).map(([k,v])=>[k.toLowerCase(),v])),body:String(init.body),signal:init.signal instanceof AbortSignal});

 await checkOnce('the GitHub adapter sends the existing cleaner\'s exact request and agrees on its receipt',async()=>{
  for(const [n,status,settles] of [[1,204,true],[2,200,false],[3,404,false],[4,500,false]]){
   const id=UUID(100+n);await ghVault('owner-a',id,GH_ACCESS);
   const old=provider(new Response(null,{status}));await existing.cleanupGitHub(db,ghConfig,old.transport,'owner-a');
   const adapter=provider(new Response(null,{status}));
   const outcome=await source.createGitHubRevoker({clientId:CLIENT,clientSecret:SECRET,transport:adapter.transport,open:()=>({clientId:CLIENT,accessToken:GH_ACCESS,refreshHeld:false,accessRevoked:false,grantPending:false})}).revoke({provider:'github',connectionId:`gh-${id}`});
   assert.equal(old.calls.length,1);assert.deepEqual(strip(adapter.calls[0]),strip(old.calls[0]));
   assert.equal(gone('github_token_vault',id),settles,`existing cleaner, status ${status}`);assert.equal(outcome==='revoked',settles,`adapter, status ${status}`);
   if(!settles)sql.prepare('DELETE FROM github_token_vault WHERE id=?').run(id);
  }
  // Refresh custody: the existing cleaner records only access_revoked_at and keeps the credential; the adapter holds.
  const id=UUID(110);await custody('owner-a',id,GH_ACCESS_B,GH_REFRESH);
  const old=provider(new Response(null,{status:204}));await existing.cleanupGitHub(db,ghConfig,old.transport,'owner-a');
  assert.equal(old.calls.length,1);assert.equal(gone('github_token_vault',id),false);
  assert.ok(sql.prepare('SELECT access_revoked_at FROM github_refresh_custody WHERE token_id=?').get(id).access_revoked_at);
  const adapter=provider(new Response(null,{status:204}));
  assert.equal(await source.createGitHubRevoker({clientId:CLIENT,clientSecret:SECRET,transport:adapter.transport,open:()=>({clientId:CLIENT,accessToken:GH_ACCESS_B,refreshHeld:true,accessRevoked:false,grantPending:false})}).revoke({provider:'github',connectionId:`gh-${id}`}),'access-revoked-refresh-held');
  assert.deepEqual(strip(adapter.calls[0]),strip(old.calls[0]));
  // A second existing pass skips the observed access revocation, as the adapter does.
  const again=provider(new Response(null,{status:204}));await existing.cleanupGitHub(db,ghConfig,again.transport,'owner-a');assert.equal(again.calls.length,0);
 });
 await checkOnce('the Cloudflare adapter sends the existing cleaner\'s exact requests and agrees on its receipt',async()=>{
  for(const [n,statuses,settles] of [[1,[200,200],true],[2,[200,400],false],[3,[204,200],false]]){
   const id=UUID(200+n);await cfVault('owner-a',id,{access:CF_ACCESS,refresh:CF_REFRESH});
   const old=provider(statuses.map(s=>new Response(null,{status:s})));await existing.cleanupCloudflare(db,cfConfig,old.transport,'owner-a');
   const adapter=provider(statuses.map(s=>new Response(null,{status:s})));
   const outcome=await source.createCloudflareRevoker({clientId:CF_CLIENT,clientSecret:SECRET,transport:adapter.transport,open:()=>({access:CF_ACCESS,refresh:CF_REFRESH})}).revoke({provider:'cloudflare',connectionId:`cf-${id}`});
   assert.equal(old.calls.length,2);assert.deepEqual(adapter.calls.map(strip),old.calls.map(strip));
   assert.equal(gone('cloudflare_token_vault',id),settles,`existing cleaner, ${statuses}`);assert.equal(outcome==='revoked',settles,`adapter, ${statuses}`);
   if(!settles)sql.prepare('DELETE FROM cloudflare_token_vault WHERE id=?').run(id);
  }
 });
 await checkOnce('the mapping reads current-schema rows and agrees with the account-closure inventory',async()=>{
  await ghVault('owner-b',UUID(301),GH_ACCESS,'active');await ghVault('owner-b',UUID(302),GH_ACCESS,'revoking');
  sql.prepare("INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES ('owner-b','44','fixture',?,'2026-10-09')").run(UUID(301));
  await cfVault('owner-b',UUID(303),{access:CF_ACCESS},'revoking');await cfVault('owner-b',UUID(304),{access:CF_ACCESS},'staged');
  const all=(q,...p)=>sql.prepare(q).all(...p);
  const rows={connection:sql.prepare('SELECT * FROM github_connections WHERE user_id=?').get('owner-b')??null,tokens:all('SELECT * FROM github_token_vault WHERE user_id=? ORDER BY id','owner-b'),
   custody:all('SELECT * FROM github_refresh_custody WHERE user_id=?','owner-b'),claims:all('SELECT c.* FROM github_revocation_claims c JOIN github_token_vault t ON t.id=c.token_id WHERE t.user_id=?','owner-b'),
   grants:all('SELECT * FROM github_grant_revocations WHERE user_id=?','owner-b')};
  const connections=[...source.githubConnectionHolds({accountId:'owner-b',rows,now:Date.now()}),
   ...source.cloudflareConnectionHolds({accountId:'owner-b',now:Date.now(),tokens:all('SELECT * FROM cloudflare_token_vault WHERE user_id=? ORDER BY id','owner-b')})];
  const blockers=source.connectionClosureBlockers({accountId:'owner-b',connections,exchanges:all('SELECT * FROM connection_oauth_exchanges WHERE user_id=?','owner-b')});
  assert.deepEqual(blockers,{holds:[`cf-${UUID(303)}`,`gh-${UUID(302)}`],live:[`cf-${UUID(304)}`,`gh-${UUID(301)}`],exchanges:[],blocked:true});
  sql.exec('PRAGMA query_only=ON');
  const {counts}=await accountClosureInventory(db,'owner-b');
  sql.exec('PRAGMA query_only=OFF');
  assert.equal(blockers.holds.length,counts.githubPendingRevocations+counts.cloudflarePendingRevocations);
  assert.equal(blockers.holds.length+blockers.live.length,counts.githubCredentials+counts.cloudflareCredentials);
  assert.deepEqual(source.closureInventoryConnectionHolds(counts),['githubCredentials','cloudflareCredentials']);
  assert.deepEqual(Object.keys(counts).filter(k=>source.closureInventoryConnectionMetrics.includes(k)).sort(),[...source.closureInventoryConnectionMetrics].sort());
 });
}finally{fixture.close();}
await checkOnce('the mapped states are exactly the current schema states',()=>{
 const schema=read('schema/platform.sql');
 const states=table=>{const body=schema.slice(schema.indexOf(`CREATE TABLE ${table} (`));const m=body.slice(0,body.indexOf(';')).match(/state TEXT NOT NULL[^,]*CHECK\(state IN \(([^)]*)\)\)/);return m[1].split(',').map(s=>s.trim().replace(/^'|'$/g,''));};
 assert.deepEqual(states('github_token_vault'),[...source.githubCredentialStates]);
 assert.deepEqual(states('github_grant_revocations'),[...source.githubGrantStates]);
 assert.deepEqual(states('cloudflare_token_vault'),[...source.cloudflareCredentialStates]);
});
await checkOnce('the adapters import only the source module and call nothing directly',()=>{
 for(const file of [PR,CH]){
  const text=read(file),specifiers=[...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
  assert.ok(specifiers.every(s=>['./policy','./revocation'].includes(s)),`${file} imports ${specifiers}`);
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env|D1Database|\.prepare\(|\benv\.[A-Z_]+|console\./.test(text),file);
 }
 // The Worker import-graph check for the whole src/email-change directory is tests/email-change-contract.mjs, which lists these files.
 assert.match(read('tests/email-change-contract.mjs'),/'src\/email-change\/provider-revokers\.ts','src\/email-change\/connection-holds\.ts'/);
});

let killed=0;
for(const [index,[name]] of mutants.entries()){
 const m=await importText(await unwrap(prepared[index]));
 await assert.rejects(suite(m),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message} [${e.cause?.name}: ${String(e.cause?.message).split('\n')[0]}]`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?` (${e.cause.message})`:''}`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
assert.deepEqual(Object.keys(killedBy).sort(),mutants.map(([name])=>name).sort());
console.log(`email-change-revokers: ${suiteCount} checks and ${total-suiteCount} agreement/static checks passed (existing cleaners on the current schema in SQLite); ${killed}/${mutants.length} mutants caught in provider-revokers.ts and connection-holds.ts (synthetic transports and SYNTHETIC canaries; no network, provider account, credential or model).`);
