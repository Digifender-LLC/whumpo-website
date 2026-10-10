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
import {referenceConformance,referenceActionDriver,runActionConformance} from './helpers/connector-conformance.mjs';

// WH-142 slice (B): the contract's action/receipt conformance cases (tests/helpers/connector-conformance.mjs) run
// against the synthetic reference runtime (control) and the real D1-backed GitHub backup (reviewBackup/confirmBackup)
// and Cloudflare DNS (reviewTXT/confirmDNS) handlers, on a disposable current-schema database (SQLite by default,
// local D1 with --d1). Providers are synthetic fakes behind the handlers' existing injected transport seam: no
// network, provider account, real credential or model. The fake GitHub provider records a commit's tree from the
// reviewed receipt row (tests/github-backups.mjs proves that tree independently with git). Known gaps (G-C5, G-C7,
// G-C8, G-C9) are pinned as the handlers' current behaviour and listed in docs/connectors.md; a change in that behaviour
// fails here. Then deliberately broken copies of the handler source must each be caught by their named check.
const root=fileURLToPath(new URL('..',import.meta.url));
const read=file=>readFileSync(join(root,file),'utf8');
const entry=`export {reviewBackup,confirmBackup} from './src/github-backups';
export {reviewTXT,confirmDNS} from './src/cloudflare-dns';
export {seal} from './src/connection-vault';
export {hashToken,newSessionToken} from './src/security';
export {admitWorkspace} from './src/workspace-identity/admission';
export {resolveIdentity} from './src/workspace-identity/authority';
export {connectorCatalog,graphqlDocuments} from './src/connector-catalog/catalog';
export {createReferenceRuntime,digest} from './tools/prototypes/connectors.mjs';`;
// Only the unmutated bundle also carries the website writer used once to create the saved version the backups use.
const fixtureEntry=`export {readChat} from './src/chat';export {createWebsite} from './src/project-specification/store';`;
async function load(overrides={},fixtures=false){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry+(fixtures?'\n'+fixtureEntry:''),resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',external:['cloudflare:*'],plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}

const fixture=await databaseFixture({allowedArguments:['--explain']}),{db}=fixture;
const key=fixtureKeyring('ef'.repeat(32)),ghAccess='ghu_synthetic_conformance',cfAccess='cf_synthetic_conformance';
const github={clientId:'Iv1.conformance',clientSecret:'synthetic-secret',appId:123,slug:'synthetic',key},cloudflare={clientId:'synthetic-client',clientSecret:'synthetic-secret',key};
const hex=n=>Array.from(crypto.getRandomValues(new Uint8Array(n/2)),b=>b.toString(16).padStart(2,'0')).join('');
const later=ms=>new Date(Date.now()+ms).toISOString(),now=()=>new Date().toISOString();

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
// them, so fixtures written with the base bundle's website writer use a base-bundle session for the same owner.
let fixtureModule,otherOwner;
async function newOwner(){const a=await workspaceFixture(db,fixtureModule);await paidPlan(db,a.account,'business');return a;}
async function actors(m,setup){
 const identity=await newOwner();otherOwner??=await newOwner();
 const session=async a=>({user:a.account,scope:await workspaceSession(db,m,{account:a.account,credential:a.credential}).then(s=>s.scope())});
 return {owner:await session(identity),other:await session(otherOwner),fixture:await setup(identity.account,await identity.scope())};
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

async function githubDriver(m){
 const {owner,other,fixture:version}=await actors(m,savedVersion),user=owner.user;
 const repo={id:17,owner:{login:'synthetic-org'},name:'site',private:true,default_branch:'main',permissions:{push:true}};
 const addToken=async ms=>{const id=crypto.randomUUID();await db.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,'active')").bind(id,user,await m.seal(key,`whumpo:github:token:${user}:${id}`,ghAccess),later(ms)).run();return id;};
 const creds=credentials(addToken),connect=token=>db.prepare('INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET active_token_id=excluded.active_token_id').bind(user,'44','synthetic-org',token,now()).run();
 function provider(){
  const p={requests:[],mutations:0,effects:0,mode:{lose:null,reject:false},head:'a'.repeat(40),trees:new Map(),commits:0};holdable(p);
  p.transport=async(url,init={})=>{
   url=String(url);const method=init.method??'GET';p.requests.push({method,url,body:init.body});
   assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer '+ghAccess);
   const u=new URL(url);
   if(method==='GET'&&u.pathname==='/repos/synthetic-org/site')return Response.json(repo);
   if(method==='GET'&&u.pathname==='/repos/synthetic-org/site/git/ref/heads/main')return Response.json({object:{sha:p.head}});
   assert.equal(url,'https://api.github.com/graphql');const payload=JSON.parse(init.body);
   if(payload.query.startsWith('query BackupPaths')){const v=payload.variables,tree=p.trees.get(v.p3.slice(v.p3.indexOf(':')+1));return Response.json({data:{repository:{p0:null,p1:null,p2:null,p3:tree?{__typename:'Tree',oid:tree}:null}}});}
   assert.ok(payload.query.startsWith('mutation BackupCommit'));
   await heldMutation(p);
   if(p.mode.reject)return Response.json({message:'Synthetic definitive rejection'},{status:422});
   const input=payload.variables.input;if(input.expectedHeadOid!==p.head)return Response.json({errors:[{message:'Synthetic expected head mismatch'}]});
   // The synthetic repository records the tree Whumpo reviewed for this mutation ID.
   const b=await db.prepare('SELECT path,tree_sha FROM github_backups WHERE id=?').bind(input.clientMutationId).first();
   p.trees.set(b.path,b.tree_sha);p.effects++;p.head=(++p.commits).toString(16).padStart(40,'b');
   if(p.mode.lose==='after')throw Error('Synthetic reply lost after the provider applied');
   return Response.json({data:{createCommitOnBranch:{commit:{oid:p.head}}}});
  };
  return p;
 }
 const confirm=async(ctx,id,{as}={})=>{const a=as==='other'?other:owner;return m.confirmBackup(a.scope,undefined,a.user,id,github,ctx.p.transport);};
 return {
  providerId:'github',operationId:'backup.commit',capabilities:['prepareReplay'],
  gaps:{price:'G-C5',reviewDigest:'G-C9',rejected:'G-C8',reconciledState:'G-C7',states:'G-C7'},
  stateMap:{pending:'review',expired:'expired',dispatching:'dispatching',uncertain:'uncertain',complete:'applied',failed:'failed'},
  // Each case gets a fresh credential, review ID and synthetic repository; the saved version is shared.
  async setup(options){const token=await creds.fresh(options);await connect(token);return {token,reviewId:crypto.randomUUID(),p:provider()};},
  teardown:restoreClock,provider:ctx=>ctx.p,
  prepare:ctx=>m.reviewBackup(owner.scope,undefined,user,{id:ctx.reviewId,versionId:version,owner:'synthetic-org',repo:'site',repoId:17},github,ctx.p.transport),
  confirm,reconcile:confirm,
  id:v=>v.id,rawState:v=>v.state,price:v=>v.price,reviewDigest:v=>v.reviewDigest,
  async revoke(ctx){creds.consumed();await db.prepare("UPDATE github_token_vault SET state='revoking' WHERE id=?").bind(ctx.token).run();},
  async replace(){const next=await addToken(3600e3);creds.adopt(next);await connect(next);},
  expireReview:()=>shiftClock(11*60e3),expireCredential:()=>shiftClock(6*60e3),
 };
}

async function dnsDriver(m){
 const {owner,other,fixture:claim}=await actors(m,domainClaim),user=owner.user;
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
   if(method==='GET'&&u.pathname===`/client/v4/zones/${zone}`)return Response.json({success:true,result:{id:zone,name:'example.com',status:'active'}});
   assert.equal(u.pathname,`/client/v4/zones/${zone}/dns_records`);
   if(method==='GET'){const result=p.records.filter(r=>r.name===u.searchParams.get('name.exact'));return Response.json({success:true,result,result_info:{total_count:result.length}});}
   await heldMutation(p);
   if(p.mode.reject)return Response.json({success:false,errors:[{code:9000,message:'Synthetic definitive rejection'}]},{status:400});
   const created={...JSON.parse(init.body),id:hex(32)};p.records.push(created);p.effects++;
   if(p.mode.lose==='after')throw Error('Synthetic reply lost after the provider applied');
   return Response.json({success:true,result:created});
  };
  return p;
 }
 const confirm=async(ctx,id,{as}={})=>{const a=as==='other'?other:owner;return m.confirmDNS(a.scope,a.user,id,cloudflare,ctx.p.transport);};
 return {
  providerId:'cloudflare',operationId:'dnsRecord.create',capabilities:['prepareReplay'],
  gaps:{price:'G-C5',reviewDigest:'G-C9',rejected:'G-C8',states:'G-C7'},
  stateMap:{review:'review',sending:'dispatching',uncertain:'uncertain',applied:'applied',unchanged:'unchanged',observed:'observed'},
  // Each case gets a fresh credential, review ID and synthetic zone (pending DNS writes are unique per zone/record).
  async setup(options){const zone=hex(32);return {token:await creds.fresh(options),zone,reviewId:crypto.randomUUID(),p:provider(zone)};},
  teardown:restoreClock,provider:ctx=>ctx.p,
  prepare:ctx=>m.reviewTXT(owner.scope,user,ctx.reviewId,claim,ctx.zone,cloudflare,ctx.p.transport),
  confirm,reconcile:confirm,
  id:v=>v.id,rawState:v=>v.state,price:v=>v.price,reviewDigest:v=>v.reviewDigest,
  async revoke(ctx){creds.consumed();await db.prepare("UPDATE cloudflare_token_vault SET state='revoking' WHERE id=?").bind(ctx.token).run();},
  async replace(ctx){ctx.token=await addToken(3600e3);creds.adopt(ctx.token);},
  expireReview:()=>shiftClock(11*60e3),expireCredential:()=>shiftClock(6*60e3),
 };
}

const drivers={github:githubDriver,cloudflare:dnsDriver};
async function suite(m,only){
 const before=total,options={catalog:m.connectorCatalog,documents:m.graphqlDocuments,test},results={};
 if(!only){
  const {fakeProvider,token}=referenceConformance({m,test});
  results.reference=await runActionConformance('reference',referenceActionDriver({m,fakeProvider,token,catalog:()=>structuredClone(m.connectorCatalog)}),options);
 }
 for(const [provider,make] of Object.entries(drivers))if(!only||only===provider)results[provider]=await runActionConformance(provider,await make(m),options);
 return {checks:total-before,results};
}

try{
 await initializeFixtureKeys(db,key);
 const baseModule=await load({},true);fixtureModule=baseModule;
 const base=await suite(baseModule);
 // The reference runtime is the control: it satisfies every case with no declared gap.
 assert.deepEqual(base.results.reference.gaps,{});assert.deepEqual(base.results.reference.skipped,['prepareReplay']);
 assert.deepEqual(base.results.github.gaps,{price:'G-C5',reviewDigest:'G-C9',rejected:'G-C8',reconciledState:'G-C7',states:'G-C7'});
 assert.deepEqual(base.results.cloudflare.gaps,{price:'G-C5',reviewDigest:'G-C9',rejected:'G-C8',states:'G-C7'});

 // ---------- Mutation check: each broken copy of a real handler must be caught by its named check ----------
 const GH='src/github-backups.ts',DNS='src/cloudflare-dns.ts';
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
 ];
 let killed=0;
 for(const [name,provider,file,find,replace,killedBy] of mutants){
  const text=read(file);
  assert.equal(text.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
  const mutant=await load({[file]:text.replace(find,()=>replace)});
  await assert.rejects(suite(mutant,provider),e=>{
   restoreClock();
   if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}${e.cause?' / '+e.cause.message:''}`);
   assert.ok(e.message.startsWith(`${provider}: ${killedBy}`),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?' / '+e.cause.message:''}`);return true;
  },`mutant survived: ${name}`);killed++;
 }
 assert.equal(killed,mutants.length);
 const r=base.results;
 console.log(`connector-conformance-handlers: ${base.checks} checks passed (reference control with no gaps; real GitHub backup and Cloudflare DNS handlers on ${process.argv.includes('--d1')?'local D1':'SQLite'}); pinned gaps GitHub ${JSON.stringify(r.github.gaps)}, Cloudflare ${JSON.stringify(r.cloudflare.gaps)}; raw states GitHub ${r.github.states.join('/')}, Cloudflare ${r.cloudflare.states.join('/')}; ${killed}/${mutants.length} handler mutants caught. Synthetic providers only; no network, credential or model.`);
}finally{restoreClock();await fixture.close();}
