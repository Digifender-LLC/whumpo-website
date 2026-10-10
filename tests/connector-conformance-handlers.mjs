import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {createFixtureWebsite} from './current-site-fixture.mjs';
import {referenceConformance,referenceActionDriver,runActionConformance,commonReceiptStates} from './helpers/connector-conformance.mjs';

// WH-142: the contract's action/receipt conformance cases (tests/helpers/connector-conformance.mjs) run against the
// synthetic reference runtime (control) and the real D1-backed GitHub backup (reviewBackup/confirmBackup) and Cloudflare
// DNS (reviewTXT/confirmDNS) handlers, on a disposable current-schema database (SQLite by default, local D1 with --d1).
// Providers are synthetic fakes behind the handlers' existing injected transport seam: no network, provider account, real
// credential or model. The fake GitHub provider records a commit's tree from the reviewed receipt row
// (tests/github-backups.mjs proves that tree independently with git). The handlers now bind the catalog price and a
// derived review digest (G-C5, G-C9) and expose the common receipt view (G-C7; GitHub has no `observed` state and says so).
// The one remaining pinned gap is G-C8 (docs/connectors.md); a change in that behaviour fails here. Catalog changes between
// review and confirmation are simulated by bundling the same handlers over an edited catalog against the same database,
// as a deploy between the two requests would. Then deliberately broken copies of the source must each be caught by their
// named check.
const root=fileURLToPath(new URL('..',import.meta.url));
const read=file=>readFileSync(join(root,file),'utf8');
const entry=`export {reviewBackup,confirmBackup,listBackups} from './src/github-backups';
export {reviewTXT,confirmDNS,listDNSActions} from './src/cloudflare-dns';
export {connectorReceiptView,receiptStateMaps,operationDigest} from './src/connector-receipts';
export {sendChat,readChat} from './src/chat';
export {seal} from './src/connection-vault';
export {hashToken,newSessionToken} from './src/security';
export {admitWorkspace} from './src/workspace-identity/admission';
export {resolveIdentity} from './src/workspace-identity/authority';
export {connectorCatalog,graphqlDocuments} from './src/connector-catalog/catalog';
export {createReferenceRuntime,digest} from './tools/prototypes/connectors.mjs';`;
// Only the unmutated bundle also carries the website writer used once to create the saved version the backups use.
const fixtureEntry=`export {createWebsite} from './src/project-specification/store';`;
async function load(overrides={},fixtures=false){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry+(fixtures?'\n'+fixtureEntry:''),resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',external:['cloudflare:*'],plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
// Catalog edits standing in for a deploy between review and confirmation: a new price for every operation, or a changed
// action declaration (a response bound) with the same price.
const CATALOG='src/connector-catalog/catalog.ts';
const catalogEdits={
 priced:[["const included:Price={customerUnits:0,basis:'plan-inclusion'};","const included:Price={customerUnits:3,basis:'quoted'};"]],
 changed:[["reconcile:['repository.get','branch.head','backup.paths'],bounds:{maxBytes:524288,maxItems:1}","reconcile:['repository.get','branch.head','backup.paths'],bounds:{maxBytes:524287,maxItems:1}"],["reconcile:['zone.get','dnsRecords.findExact'],bounds:{maxBytes:262144,maxItems:1}","reconcile:['zone.get','dnsRecords.findExact'],bounds:{maxBytes:262143,maxItems:1}"]],
};
async function alternates(overrides){
 const result={};
 for(const [name,edits] of Object.entries(catalogEdits)){let text=read(CATALOG);for(const [find,replace] of edits){assert.equal(text.split(find).length,2,`catalog edit ${name} must match once`);text=text.replace(find,()=>replace);}result[name]=await load({...overrides,[CATALOG]:text});}
 return result;
}

const fixture=await databaseFixture({allowedArguments:['--explain']}),{db}=fixture;
const key=fixtureKeyring('ef'.repeat(32)),ghAccess='ghu_synthetic_conformance',cfAccess='cf_synthetic_conformance';
const github={clientId:'Iv1.conformance',clientSecret:'synthetic-secret',appId:123,slug:'synthetic',key},cloudflare={clientId:'synthetic-client',clientSecret:'synthetic-secret',key};
// Every synthetic provider response carries this unreviewed field; no review, receipt or status may repeat it.
const providerCanary='SYNTHETIC-PROVIDER-PAYLOAD-0142';
const hex=n=>Array.from(crypto.getRandomValues(new Uint8Array(n/2)),b=>b.toString(16).padStart(2,'0')).join('');
const later=ms=>new Date(Date.now()+ms).toISOString(),now=()=>new Date().toISOString();
const identityMap=Object.fromEntries(commonReceiptStates.map(s=>[s,s]));
const echoOf=v=>({reviewDigest:v.receipt.reviewDigest,acceptedPrice:v.receipt.price});
const included={customerUnits:0,basis:'plan-inclusion'},quoted={customerUnits:3,basis:'quoted'};
const includedLine='Authority: owner request · Price: included in your plan; no per-use charge';

// Review and credential expiry are JavaScript-clock checks in both handlers; a shifted clock reaches them without
// editing immutable rows. Restored after every case.
const RealDate=Date;
function shiftClock(ms){class Shifted extends RealDate{constructor(...a){if(a.length)super(...a);else super(RealDate.now()+ms);}static now(){return RealDate.now()+ms;}}globalThis.Date=Shifted;}
const restoreClock=()=>{globalThis.Date=RealDate;};

let total=0;
async function test(name,fn){try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}}

// Each bundle (base or mutant) gets one fresh owner per provider: the schema caps users (50), credentials per owner (10),
// projects and domain claims, so cases share an owner, its saved version or domain claim, and a credential until a case
// revokes, shortens or replaces it. A second owner is shared. Admission capabilities are private to the bundle that issued
// them, so fixtures written with the base bundle's website writer use a base-bundle session for the same owner, and the
// catalog-edit bundles get their own session for the same owner.
let fixtureModule,otherOwner;
async function newOwner(){const a=await workspaceFixture(db,fixtureModule);await paidPlan(db,a.account,'business');return a;}
async function actors(m,setup){
 const identity=await newOwner();otherOwner??=await newOwner();
 const session=async(a,mod=m)=>({user:a.account,scope:await workspaceSession(db,mod,{account:a.account,credential:a.credential}).then(s=>s.scope())});
 return {owner:await session(identity),other:await session(otherOwner),sessionFor:mod=>session(identity,mod),fixture:await setup(identity.account,await identity.scope())};
}
async function project(user,name){const id=crypto.randomUUID();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'Conformance fixture','draft',?,?)").bind(id,user,name,now(),now()).run();return id;}
const savedVersion=async(user,scope)=>createFixtureWebsite(scope,user,await project(user,'Synthetic backup'),{name:'Synthetic backup',headline:'Synthetic backup',description:'Conformance fixture',theme:'clay',aboutTitle:'About us',aboutText:'Conformance fixture',sections:[],photos:[]},fixtureModule);
async function domainClaim(user){const claim=crypto.randomUUID();await db.prepare('INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(claim,await project(user,'Synthetic DNS'),'www.example.com',hex(64),later(86400e3),now()).run();return claim;}
/** Reuses the current credential unless the previous case consumed it (revoked, short-lived or replaced). */
function credentials(add){
 let current=null;
 return {async fresh({shortCredential}={}){if(shortCredential||!current){current=null;const token=await add(shortCredential?5*60e3:3600e3);if(!shortCredential)current=token;return token;}return current;},consumed(){current=null;},adopt(token){current=token;}};
}
function holdable(p){p.held=null;p.hold=()=>{let release,arrived;const reached=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);p.held={arrived,gate};return {reached,release};};}
async function heldMutation(p){p.mutations++;if(p.held){const h=p.held;p.held=null;h.arrived();await h.gate;}if(p.mode.lose==='before')throw Error('Synthetic connection reset before the provider accepted');}
/** Sends one guided Chat command through the bundle's real sendChat and returns its saved reply. */
async function chat(mod,actor,content,options,id=crypto.randomUUID()){
 const state=await mod.readChat(actor.scope,actor.user),result=await mod.sendChat(actor.scope,actor.user,{id,content,revision:state.state.revision},undefined,options);
 assert.equal(result.status,200,JSON.stringify(result));return (await mod.readChat(actor.scope,actor.user)).turns.find(t=>t.id===id).assistant_text;
}
const refusedWith=(promise,status,pattern)=>assert.rejects(promise,e=>{assert.equal(e.status,status,e.message);assert.match(e.message,pattern);return true;});

/** WH-142 named checks beyond the shared action cases, for one real driver. `h` exposes the driver's closures. */
async function receiptChecks(label,m,alt,h){
 const t=(name,fn)=>test(`${label}: ${name}`,async()=>{const ctx=await h.driver.setup({});try{await fn(ctx,h.driver.provider(ctx));}finally{await h.driver.teardown(ctx);}});
 const priced=await h.sessionFor(alt.priced),changed=await h.sessionFor(alt.changed);
 await test(`${label}: the receipt view maps every stored state to its documented common state and rewrites no row`,async()=>{
  const map=m.receiptStateMaps[h.driver.providerId],future=later(60e3),past='2000-01-01T00:00:00.000Z';
  assert.deepEqual({...map},h.documented.states);
  for(const [recorded,state] of Object.entries(h.documented.states)){
   const v=m.connectorReceiptView(h.driver.providerId,{state:recorded,expiresAt:future});
   assert.deepEqual({state:v.state,recordedState:v.recordedState,authority:v.authority,price:v.price,evidence:v.evidence,operationId:v.operationId},{state,recordedState:recorded,authority:'owner-request',price:included,evidence:h.documented.evidence[recorded]??null,operationId:h.driver.operationId});
  }
  assert.equal(m.connectorReceiptView(h.driver.providerId,{state:h.documented.review,expiresAt:past}).state,'expired');
  for(const missing of h.documented.unrecorded)assert.throws(()=>m.connectorReceiptView(h.driver.providerId,{state:missing,expiresAt:future}));
  // Reading the view (JSON list and Chat status) leaves every stored row byte-identical.
  const rows=()=>db.prepare(`SELECT * FROM ${h.table} WHERE user_id=? ORDER BY id`).bind(h.user).all().then(r=>r.results);
  const before=await rows();assert.ok(before.length>=5);
  const listed=await h.list(m);await chat(m,h.owner,h.statusCommand,h.chatOptions({transport:async()=>{throw Error('Status must not call the provider');}}));
  assert.deepEqual(await rows(),before);
  for(const row of before){const v=listed.find(x=>x.id===row.id);const expected=map[row.state]==='review'&&row.expires_at<=now()?'expired':map[row.state];assert.equal(v.receipt.state,expected);assert.equal(v.receipt.recordedState,row.state);}
 });
 await t('a catalog price change between review and confirmation refuses with a fresh-review error and never dispatches',async(ctx,p)=>{
  const v=await h.prepare(ctx),n=p.requests.length;assert.deepEqual(v.receipt.price,included);
  await refusedWith(h.confirm(alt.priced,priced,ctx,v.id,echoOf(v)),409,/Prepare a fresh review/);
  assert.equal(p.requests.length,n);assert.equal(p.mutations,0);
  assert.equal((await h.confirm(m,h.owner,ctx,v.id,echoOf(v))).receipt.state,'applied');assert.equal(p.mutations,1);
 });
 await t('a changed operation declaration with the same price makes the review stale',async(ctx,p)=>{
  const v=await h.prepare(ctx),n=p.requests.length;
  await refusedWith(h.confirm(alt.changed,changed,ctx,v.id,echoOf(v)),409,/Prepare a fresh review/);
  assert.equal(p.requests.length,n);assert.equal(p.mutations,0);
 });
 await t('a quoted price is stated in the review, never dispatched without a billing path and never restates settled receipts',async(ctx,p)=>{
  const v=await h.prepare(ctx,alt.priced,priced);assert.deepEqual(v.receipt.price,quoted);assert.equal(v.receipt.priceText,'3 customer units per use (quoted)');
  const n=p.requests.length;await refusedWith(h.confirm(alt.priced,priced,ctx,v.id,echoOf(v)),409,/cannot charge yet\. Nothing was sent\./);
  assert.equal(p.requests.length,n);assert.equal(p.mutations,0);
  // Receipts settled under the plan-inclusion price keep it after the catalog change; open reviews state the new price.
  const listed=await h.list(alt.priced,priced);assert.ok(listed.some(x=>x.receipt.state==='applied'));
  for(const x of listed)assert.deepEqual(x.receipt.price,['review','expired'].includes(x.receipt.state)?quoted:included,x.receipt.state);
 });
 await t('a review digest from another review is refused',async(ctx,p)=>{
  const a=await h.prepare(ctx),b=await h.prepare(ctx,m,h.owner,crypto.randomUUID());assert.notEqual(a.receipt.reviewDigest,b.receipt.reviewDigest);
  await refusedWith(h.confirm(m,h.owner,ctx,b.id,echoOf(a)),409,/Prepare a fresh review/);assert.equal(p.mutations,0);
  assert.equal((await h.confirm(m,h.owner,ctx,b.id,echoOf(b))).receipt.state,'applied');assert.equal(p.mutations,1);
 });
 await t('review, receipt and status responses carry no credential, token or provider payload',async(ctx,p)=>{
  const review=await h.prepare(ctx),done=await h.confirm(m,h.owner,ctx,review.id,echoOf(review)),listed=await h.list(m),status=await chat(m,h.owner,h.statusCommand,h.chatOptions(ctx));
  const vault=await db.prepare(`SELECT ciphertext FROM ${h.vault} WHERE id=?`).bind(ctx.token).first();
  const surface=JSON.stringify([review,done,listed])+'\n'+status;
  for(const canary of [h.access,'synthetic-secret','ef'.repeat(32),ctx.token,String(vault.ciphertext).slice(0,32),providerCanary,'Bearer'])assert.ok(!surface.includes(canary),`response leaked ${canary}`);
  assert.equal(review.receipt.authority,'owner-request');assert.deepEqual(done.receipt.price,included);
  assert.ok(status.includes(`Receipt state: applied · ${includedLine}`));assert.equal(p.mutations,1);
 });
 await t('a Chat confirmation is bound to the review text the owner saw',async(ctx,p)=>{
  const shown=await chat(m,h.owner,h.reviewCommand(ctx),h.chatOptions(ctx),ctx.reviewId);
  assert.match(shown,new RegExp(`^Receipt state: review · ${includedLine}$`,'m'));assert.match(shown,/^Review digest: [0-9a-f]{64}$/m);
  // After a catalog declaration change, the saved review no longer matches, whatever the current derivation says.
  assert.match(await chat(alt.changed,changed,h.confirmCommand+' '+ctx.reviewId,h.chatOptions(ctx)),/price or reviewed terms changed\. Prepare a fresh review/);assert.equal(p.mutations,0);
  assert.match(await chat(m,h.owner,h.confirmCommand+' '+ctx.reviewId,h.chatOptions(ctx)),/^Receipt state: applied/m);assert.equal(p.mutations,1);
 });
}

async function githubDriver(m,alt){
 const {owner,other,sessionFor,fixture:version}=await actors(m,savedVersion),user=owner.user;
 const repo={id:17,owner:{login:'synthetic-org'},name:'site',private:true,default_branch:'main',permissions:{push:true},description:providerCanary};
 const addToken=async ms=>{const id=crypto.randomUUID();await db.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,'active')").bind(id,user,await m.seal(key,`whumpo:github:token:${user}:${id}`,ghAccess),later(ms)).run();return id;};
 const creds=credentials(addToken),connect=token=>db.prepare('INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET active_token_id=excluded.active_token_id').bind(user,'44','synthetic-org',token,now()).run();
 function provider(){
  const p={requests:[],mutations:0,effects:0,mode:{lose:null,reject:false},head:'a'.repeat(40),trees:new Map(),commits:0};holdable(p);
  p.transport=async(url,init={})=>{
   url=String(url);const method=init.method??'GET';p.requests.push({method,url,body:init.body});
   assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer '+ghAccess);
   const u=new URL(url);
   if(method==='GET'&&u.pathname==='/repos/synthetic-org/site')return Response.json(repo);
   if(method==='GET'&&u.pathname==='/repos/synthetic-org/site/git/ref/heads/main')return Response.json({object:{sha:p.head},note:providerCanary});
   assert.equal(url,'https://api.github.com/graphql');const payload=JSON.parse(init.body);
   if(payload.query.startsWith('query BackupPaths')){const v=payload.variables,tree=p.trees.get(v.p3.slice(v.p3.indexOf(':')+1));return Response.json({data:{repository:{p0:null,p1:null,p2:null,p3:tree?{__typename:'Tree',oid:tree,note:providerCanary}:null}}});}
   assert.ok(payload.query.startsWith('mutation BackupCommit'));
   await heldMutation(p);
   if(p.mode.reject)return Response.json({message:'Synthetic definitive rejection'},{status:422});
   const input=payload.variables.input;if(input.expectedHeadOid!==p.head)return Response.json({errors:[{message:'Synthetic expected head mismatch'}]});
   // The synthetic repository records the tree Whumpo reviewed for this mutation ID.
   const b=await db.prepare('SELECT path,tree_sha FROM github_backups WHERE id=?').bind(input.clientMutationId).first();
   p.trees.set(b.path,b.tree_sha);p.effects++;p.head=(++p.commits).toString(16).padStart(40,'b');
   if(p.mode.lose==='after')throw Error('Synthetic reply lost after the provider applied');
   return Response.json({data:{createCommitOnBranch:{commit:{oid:p.head,message:providerCanary}}}});
  };
  return p;
 }
 // The owner's echo defaults to the reviewed digest and price shown by this case's review.
 const echo=(ctx,{acceptedPrice,reviewDigest}={})=>({reviewDigest:reviewDigest??ctx.echo?.reviewDigest,acceptedPrice:acceptedPrice===null?undefined:acceptedPrice??ctx.echo?.acceptedPrice});
 const confirm=async(ctx,id,options={})=>{const a=options.as==='other'?other:owner;return m.confirmBackup(a.scope,undefined,a.user,id,github,ctx.p.transport,echo(ctx,options));};
 const prepare=async(ctx,mod=m,actor=owner,id=ctx.reviewId)=>{const v=await mod.reviewBackup(actor.scope,undefined,user,{id,versionId:version,owner:'synthetic-org',repo:'site',repoId:17},github,ctx.p.transport);if(id===ctx.reviewId&&v.receipt.reviewDigest)ctx.echo=echoOf(v);return v;};
 const driver={
  providerId:'github',operationId:'backup.commit',capabilities:['prepareReplay'],
  // G-C5/G-C7/G-C9 closed; G-C8 stays pinned. GitHub records no `observed` state (honest mapping, not a gap).
  gaps:{rejected:'G-C8'},observedState:false,stateMap:identityMap,
  // Each case gets a fresh credential, review ID and synthetic repository; the saved version is shared.
  async setup(options){const token=await creds.fresh(options);await connect(token);return {token,reviewId:crypto.randomUUID(),p:provider()};},
  teardown:restoreClock,provider:ctx=>ctx.p,
  prepare:ctx=>prepare(ctx),confirm,reconcile:confirm,
  id:v=>v.id,rawState:v=>v.receipt.state,price:v=>v.receipt.price,reviewDigest:v=>v.receipt.reviewDigest,evidence:v=>v.receipt.evidence,
  async revoke(ctx){creds.consumed();await db.prepare("UPDATE github_token_vault SET state='revoking' WHERE id=?").bind(ctx.token).run();},
  async replace(){const next=await addToken(3600e3);creds.adopt(next);await connect(next);},
  expireReview:()=>shiftClock(11*60e3),expireCredential:()=>shiftClock(6*60e3),
 };
 driver.extra=()=>receiptChecks('github',m,alt,{driver,owner,user,sessionFor,table:'github_backups',vault:'github_token_vault',access:ghAccess,
  documented:{states:{pending:'review',dispatching:'dispatching',uncertain:'uncertain',complete:'applied',failed:'failed'},evidence:{complete:'verified-readback'},review:'pending',unrecorded:['observed','unchanged','review','sending']},
  prepare,confirm:(mod,actor,ctx,id,e)=>mod.confirmBackup(actor.scope,undefined,user,id,github,ctx.p.transport,e),list:async(mod,actor=owner)=>(await mod.listBackups(actor.scope,user)).backups,
  statusCommand:'/backups',confirmCommand:'/confirm-backup',reviewCommand:()=>`/review-backup ${version} synthetic-org/site 17`,chatOptions:ctx=>({github,githubTransport:ctx.p?.transport??ctx.transport})});
 return driver;
}

async function dnsDriver(m,alt){
 const {owner,other,sessionFor,fixture:claim}=await actors(m,domainClaim),user=owner.user;
 const addToken=async ms=>{
  // One active Cloudflare credential per owner, as the connection flow keeps it.
  await db.prepare("UPDATE cloudflare_token_vault SET state='revoking' WHERE user_id=? AND state='active'").bind(user).run();
  const id=crypto.randomUUID();await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,'active')").bind(id,user,await m.seal(key,`whumpo:cloudflare:token:${user}:${id}`,JSON.stringify({access:cfAccess})),later(ms),now()).run();return id;
 },creds=credentials(addToken);
 function provider(zone){
  const p={requests:[],mutations:0,effects:0,mode:{lose:null,reject:false},records:[]};holdable(p);
  p.transport=async(url,init={})=>{
   url=String(url);const method=init.method??'GET';p.requests.push({method,url,body:init.body});
   assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer '+cfAccess);
   const u=new URL(url);assert.equal(u.origin,'https://api.cloudflare.com');
   if(method==='GET'&&u.pathname===`/client/v4/zones/${zone}`)return Response.json({success:true,result:{id:zone,name:'example.com',status:'active',owner:providerCanary}});
   assert.equal(u.pathname,`/client/v4/zones/${zone}/dns_records`);
   if(method==='GET'){const result=p.records.filter(r=>r.name===u.searchParams.get('name.exact'));return Response.json({success:true,result,result_info:{total_count:result.length}});}
   await heldMutation(p);
   if(p.mode.reject)return Response.json({success:false,errors:[{code:9000,message:'Synthetic definitive rejection'}]},{status:400});
   const created={...JSON.parse(init.body),id:hex(32),meta:{note:providerCanary}};p.records.push(created);p.effects++;
   if(p.mode.lose==='after')throw Error('Synthetic reply lost after the provider applied');
   return Response.json({success:true,result:created});
  };
  return p;
 }
 const echo=(ctx,{acceptedPrice,reviewDigest}={})=>({reviewDigest:reviewDigest??ctx.echo?.reviewDigest,acceptedPrice:acceptedPrice===null?undefined:acceptedPrice??ctx.echo?.acceptedPrice});
 const confirm=async(ctx,id,options={})=>{const a=options.as==='other'?other:owner;return m.confirmDNS(a.scope,a.user,id,cloudflare,ctx.p.transport,false,echo(ctx,options));};
 const prepare=async(ctx,mod=m,actor=owner,id=ctx.reviewId)=>{const v=await mod.reviewTXT(actor.scope,user,id,claim,ctx.zone,cloudflare,ctx.p.transport);if(id===ctx.reviewId&&v.receipt.reviewDigest)ctx.echo=echoOf(v);return v;};
 const driver={
  providerId:'cloudflare',operationId:'dnsRecord.create',capabilities:['prepareReplay'],
  gaps:{rejected:'G-C8'},stateMap:identityMap,
  // Each case gets a fresh credential, review ID and synthetic zone (pending DNS writes are unique per zone/record).
  async setup(options){const zone=hex(32);return {token:await creds.fresh(options),zone,reviewId:crypto.randomUUID(),p:provider(zone)};},
  teardown:restoreClock,provider:ctx=>ctx.p,
  prepare:ctx=>prepare(ctx),confirm,reconcile:confirm,
  id:v=>v.id,rawState:v=>v.receipt.state,price:v=>v.receipt.price,reviewDigest:v=>v.receipt.reviewDigest,evidence:v=>v.receipt.evidence,
  async revoke(ctx){creds.consumed();await db.prepare("UPDATE cloudflare_token_vault SET state='revoking' WHERE id=?").bind(ctx.token).run();},
  async replace(ctx){ctx.token=await addToken(3600e3);creds.adopt(ctx.token);},
  expireReview:()=>shiftClock(11*60e3),expireCredential:()=>shiftClock(6*60e3),
 };
 driver.extra=()=>receiptChecks('cloudflare',m,alt,{driver,owner,user,sessionFor,table:'cloudflare_dns_actions',vault:'cloudflare_token_vault',access:cfAccess,
  documented:{states:{review:'review',sending:'dispatching',uncertain:'uncertain',applied:'applied',unchanged:'unchanged',observed:'observed'},evidence:{applied:'provider-acknowledged',unchanged:'existing-record',observed:'readback-after-uncertain'},review:'review',unrecorded:['pending','complete','dispatching','failed']},
  prepare,confirm:(mod,actor,ctx,id,e)=>mod.confirmDNS(actor.scope,user,id,cloudflare,ctx.p.transport,false,e),list:async(mod,actor=owner)=>(await mod.listDNSActions(actor.scope,user)).actions,
  statusCommand:'/dns',confirmCommand:'/confirm-dns',reviewCommand:ctx=>`/review-dns ${claim} ${ctx.zone}`,chatOptions:ctx=>({config:cloudflare,transport:ctx.p?.transport??ctx.transport})});
 return driver;
}

const drivers={github:githubDriver,cloudflare:dnsDriver};
async function suite(m,only,overrides={}){
 const before=total,options={catalog:m.connectorCatalog,documents:m.graphqlDocuments,test},results={},alt=await alternates(overrides);
 if(!only){
  const {fakeProvider,token}=referenceConformance({m,test});
  results.reference=await runActionConformance('reference',referenceActionDriver({m,fakeProvider,token,catalog:()=>structuredClone(m.connectorCatalog)}),options);
 }
 for(const [provider,make] of Object.entries(drivers))if(!only||only===provider){const driver=await make(m,alt);results[provider]=await runActionConformance(provider,driver,options);await driver.extra();}
 return {checks:total-before,results};
}

try{
 await initializeFixtureKeys(db,key);
 const baseModule=await load({},true);fixtureModule=baseModule;
 const base=await suite(baseModule);
 // The reference runtime is the control: it satisfies every case with no declared gap.
 assert.deepEqual(base.results.reference.gaps,{});assert.deepEqual(base.results.reference.skipped,['prepareReplay']);
 // WH-142: G-C5, G-C7 and G-C9 are closed for both handlers; only G-C8 (cautious 4xx handling) stays pinned.
 assert.deepEqual(base.results.github.gaps,{rejected:'G-C8'});
 assert.deepEqual(base.results.cloudflare.gaps,{rejected:'G-C8'});
 for(const provider of ['github','cloudflare'])assert.deepEqual(base.results[provider].states.filter(s=>!commonReceiptStates.includes(s)),[]);
 // The derived operation digest is the reference runtime's digest of the same catalog declaration.
 for(const [provider,operation] of [['github','backup.commit'],['cloudflare','dnsRecord.create']])assert.equal(await baseModule.operationDigest(provider),baseModule.digest(baseModule.connectorCatalog.providers[provider].operations[operation]));

 // ---------- Mutation check: each broken copy of the source must be caught by its named check ----------
 const GH='src/github-backups.ts',DNS='src/cloudflare-dns.ts',RC='src/connector-receipts.ts',BC='src/backup-chat.ts',DC='src/dns-chat.ts';
 const mutants=[
  ['GitHub claim without the pending compare-and-swap','github',GH,"WHERE id=? AND user_id=? AND state='pending' AND expires_at>?","WHERE id=? AND user_id=? AND expires_at>?",'concurrent duplicate confirmations dispatch once'],
  ['GitHub unknown outcome released back to review','github',GH,"UPDATE github_backups SET state='uncertain',detail='The GitHub outcome needs checking.","UPDATE github_backups SET state='pending',detail='The GitHub outcome needs checking.",'a reply lost after the provider applied stays held'],
  ['GitHub expired review not refused','github',GH,"if(b.state==='pending'&&b.expires_at<=new Date().toISOString())throw new ConnectionError(409,'This backup review expired. Prepare a fresh review.');",'','an expired review is refused with no dispatch'],
  ['GitHub review not bound to its credential','github',GH,"||b.state==='pending'&&access.tokenId!==b.token_id",'','a review bound to replaced access is stale'],
  ['DNS claim without the review-state compare-and-swap','cloudflare',DNS,"WHERE id=? AND user_id=? AND state='review' AND ${gate.sql}","WHERE id=? AND user_id=? AND ${gate.sql}",'concurrent duplicate confirmations dispatch once'],
  ['DNS unknown outcome released back to review','cloudflare',DNS,"SET state='uncertain',detail='The DNS request outcome is uncertain.","SET state='review',detail='The DNS request outcome is uncertain.",'a reply lost after the provider applied stays held'],
  ['DNS expired review not refused','cloudflare',DNS,"a.expires_at<=stamp()||",'','an expired review is refused with no dispatch'],
  ['DNS review not bound to its credential','cloudflare',DNS,"a.state==='review'?a.token_id:undefined",'undefined','a review bound to replaced access is stale'],
  ['GitHub reconciliation settles without observing the copy','github',GH,"const head=await branchHead(access,repo);if(await remoteCopy(access,repo,b,head))return completeBackup(db,userId,b,head);","const head=await branchHead(access,repo);if(await remoteCopy(access,repo,b,head)||true)return completeBackup(db,userId,b,head);",'a delayed provider acknowledgement and a concurrent check settle once'],
  ['DNS reconciliation settles without observing the record','cloudflare',DNS,"const match=found.records.filter(r=>matches(r)&&r.comment===marker);","const match=[{id:'0'.repeat(32)}];",'a delayed provider acknowledgement and a concurrent check settle once'],
  // WH-142 price binding, review digest and receipt view.
  ['GitHub confirmation without the review binding','github',GH,"  if(problem)throw new ConnectionError(","  if(false)throw new ConnectionError(",'the review states the catalog price and confirmation must echo it'],
  ['DNS confirmation without the review binding','cloudflare',DNS,"  if(problem)throw new DomainError(","  if(false)throw new DomainError(",'the review states the catalog price and confirmation must echo it'],
  ['Accepted price not compared','github',RC,"return echo.reviewDigest===expected.reviewDigest&&canonicalJSON(p)===canonicalJSON(expected.price)?null:'stale';","return echo.reviewDigest===expected.reviewDigest?null:'stale';",'the review states the catalog price and confirmation must echo it'],
  ['Review digest not compared','cloudflare',RC,"return echo.reviewDigest===expected.reviewDigest&&canonicalJSON(p)===canonicalJSON(expected.price)?null:'stale';","return canonicalJSON(p)===canonicalJSON(expected.price)?null:'stale';",'the review carries a digest and confirmation must echo it exactly'],
  ['Review digest omits the catalog declaration','github',RC,"operationId:receiptActions[provider],operationDigest:opDigest,requestDigest,","operationId:receiptActions[provider],requestDigest,",'a changed operation declaration with the same price makes the review stale'],
  ['Review digest omits the reviewed request','cloudflare',RC,"operationId:receiptActions[provider],operationDigest:opDigest,requestDigest,","operationId:receiptActions[provider],operationDigest:opDigest,",'a review digest from another review is refused'],
  ['GitHub quoted price dispatched without a billing path','github',GH,"  if(chargeable(bound.price))throw","  if(false)throw",'a quoted price is stated in the review, never dispatched'],
  ['DNS quoted price dispatched without a billing path','cloudflare',DNS,"  if(chargeable(bound.price))throw","  if(false)throw",'a quoted price is stated in the review, never dispatched'],
  ['Settled receipt restated at the current catalog price','cloudflare',RC,"price=mapped==='review'?actionPrice(provider):{...settledPrice};","price=actionPrice(provider);",'a quoted price is stated in the review, never dispatched without a billing path and never restates settled receipts'],
  ['GitHub completion claimed as observed','github',RC,"complete:'applied',failed:'failed'","complete:'observed',failed:'failed'",'confirmation applies once'],
  ['Receipt view exposes stored state names','github',RC,"?'expired':mapped,price=mapped==='review'","?'expired':row.state as ConnectorReceiptState,price=mapped==='review'",'an exact review is prepared without dispatch'],
  ['Expired review shown as open','cloudflare',RC,"mapped==='review'&&row.expiresAt<=now?'expired':mapped","mapped",'the receipt view maps every stored state'],
  ['GitHub receipt leaks the credential ID','github',GH,",receipt:connectorReceiptView('github',",",tokenId:b.token_id,receipt:connectorReceiptView('github',",'review, receipt and status responses carry no credential'],
  ['DNS receipt leaks the credential ID','cloudflare',DNS,",receipt:connectorReceiptView('cloudflare',",",tokenId:a.token_id,receipt:connectorReceiptView('cloudflare',",'review, receipt and status responses carry no credential'],
  ['GitHub Chat confirmation re-derives the binding','github',BC,"const echo=verb==='/confirm-backup'?reviewEchoFromText(","const echo=verb==='/confirm-backup'?(await listBackups(db,user)).backups.filter(b=>b.id===args[0]).map(b=>({reviewDigest:b.receipt.reviewDigest,acceptedPrice:b.receipt.price}))[0]??reviewEchoFromText(",'a Chat confirmation is bound to the review text the owner saw'],
  ['DNS Chat confirmation re-derives the binding','cloudflare',DC,"const echo=verb==='/confirm-dns'?reviewEchoFromText(","const echo=verb==='/confirm-dns'?(await listDNSActions(db,user)).actions.filter(a=>a.id===args[0]).map(a=>({reviewDigest:a.receipt.reviewDigest,acceptedPrice:a.receipt.price}))[0]??reviewEchoFromText(",'a Chat confirmation is bound to the review text the owner saw'],
 ];
 let killed=0;
 for(const [name,provider,file,find,replace,killedBy] of mutants){
  const text=read(file);
  assert.equal(text.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
  const overrides={[file]:text.replace(find,()=>replace)},mutant=await load(overrides);
  await assert.rejects(suite(mutant,provider,overrides),e=>{
   restoreClock();
   if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}${e.cause?' / '+e.cause.message:''}`);
   assert.ok(e.message.startsWith(`${provider}: ${killedBy}`),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?' / '+e.cause.message:''}`);return true;
  },`mutant survived: ${name}`);killed++;
 }
 assert.equal(killed,mutants.length);
 const r=base.results;
 console.log(`connector-conformance-handlers: ${base.checks} checks passed (reference control with no gaps; real GitHub backup and Cloudflare DNS handlers on ${process.argv.includes('--d1')?'local D1':'SQLite'}); price binding, review digest and common receipt view verified; pinned gaps GitHub ${JSON.stringify(r.github.gaps)}, Cloudflare ${JSON.stringify(r.cloudflare.gaps)}; common states GitHub ${r.github.states.join('/')}, Cloudflare ${r.cloudflare.states.join('/')}; ${killed}/${mutants.length} source mutants caught. Synthetic providers only; no network, credential or model.`);
}finally{restoreClock();await fixture.close();}
