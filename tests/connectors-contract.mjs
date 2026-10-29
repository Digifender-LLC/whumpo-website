import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {referenceConformance} from './helpers/connector-conformance.mjs';

// WH-056 / WH-140 / WH-141 offline connector conformance harness, run against the source module
// src/connector-catalog/{catalog,builder}.ts. Synthetic providers and invented identifiers only: no database, network,
// OAuth client, credential, model or provider account. It proves the frozen catalog, the typed request builder, exact
// agreement with the GitHub/Cloudflare adapters (which now send only catalog operations through the builder; their
// request bytes are checked by tests/connection-sends.mjs), and the synthetic reference runtime in
// tools/prototypes/connectors.mjs (bundled with the same source). runConformance() lives in
// tests/helpers/connector-conformance.mjs; the D1-backed GitHub/Cloudflare action handlers are checked against its action
// cases by tests/connector-conformance-handlers.mjs (WH-142). Every suite check also runs against deliberately broken copies of the
// source (mutants below), each of which must be caught by the check written for that property.
const root=fileURLToPath(new URL('..',import.meta.url));
const read=file=>readFileSync(join(root,file),'utf8');
const moduleFiles=['src/connector-catalog/catalog.ts','src/connector-catalog/builder.ts'];
const entry="export * from './src/connector-catalog/catalog';export * from './src/connector-catalog/builder';export {createReferenceRuntime,digest} from './tools/prototypes/connectors.mjs';";
async function load(overrides={}){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
// Existing production pure functions, bundled once and never mutated.
const existing=await build({stdin:{contents:"export {backupPathsQuery,backupPathsVariables,backupRecoveryRead,dnsRecoveryRead} from './src/connection-recovery';export {seal,unseal} from './src/connection-vault';export {launchFeatureCatalogue,connectionProviders} from './src/plan-features';export {isConnectionProvider} from './src/connection-handoff-shape';export {connectionFeature} from './src/feature-admission';export {featureOperations} from './src/feature-inclusion';",resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'neutral',write:false,logLevel:'silent',external:['cloudflare:*']});
const src=await import('data:text/javascript;base64,'+Buffer.from(existing.outputFiles[0].text).toString('base64'));

let total=0,suiteCount=0;
async function test(name,fn){try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}}
const rejects=async(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code);return true;});
const throws=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code);return true;});
const owner=(ownerId='owner-a')=>({kind:'owner',ownerId});
const zone='0123456789abcdef0123456789abcdef',strip=p=>p.replace(/^\/client\/v4/,'');
const keyring=JSON.stringify({version:2,active:'fixture-current',keys:[{id:'fixture-current',secret:'ab'.repeat(32)}]});
const userId='11111111-1111-4111-8111-111111111111';

async function suite(m){
 const before=total;
 const clone=()=>structuredClone(m.connectorCatalog);
 // Synthetic fixture only: raises planned declarations to `synthetic-conformant` so the reference runtime can exercise
 // them with fake providers. The real catalog keeps them planned and refused.
 const synthetic=()=>{const c=clone();for(const e of Object.values(c.providers))if(e.readiness==='planned')e.readiness='synthetic-conformant';return c;};
 const liveCatalog=()=>{const c=clone();for(const e of Object.values(c.providers))e.readiness='live-accepted';return c;};
 const scopes=(provider,catalog=m.connectorCatalog)=>[...catalog.providers[provider].scopes];
 /** Owner-request request with every catalog scope granted, unless overridden. */
 const req=(providerId,operationId,params,body,{builder=m.buildConnectorRequest,authority='owner-request',grantedScopes=scopes(providerId)}={})=>builder({providerId,operationId,params,authority,grantedScopes,...(body===undefined?{}:{body})});

 // ---------- Frozen catalog ----------
 await test('frozen catalog is valid and covers exactly the seven selected providers',()=>{
  assert.equal(m.validateCatalog(m.connectorCatalog),true);
  assert.deepEqual(Object.keys(m.connectorCatalog.providers).sort(),[...m.connectorProviders].sort());
  assert.ok(Object.isFrozen(m.connectorCatalog.providers.github.operations['backup.commit'].price),'the server catalog is deeply frozen');
 });
 await test('catalog providers and readiness match the launch feature catalogue',()=>{
  const features=new Map(src.launchFeatureCatalogue.features.map(f=>[f.id,f]));
  for(const [p,e] of Object.entries(m.connectorCatalog.providers)){
   const f=features.get(e.featureId);assert.ok(f,e.featureId);assert.equal(f.connection,p);
   assert.equal(f.implementation==='private-test'?'private-test':'planned',e.readiness);
  }
  assert.deepEqual(src.connectionProviders.map(p=>p.id).sort(),[...m.connectorProviders].sort());
 });
 await test('every planned provider is planned, and no provider claims live acceptance',()=>{
  for(const e of Object.values(m.connectorCatalog.providers))assert.notEqual(e.readiness,'live-accepted');
  assert.deepEqual(Object.entries(m.connectorCatalog.providers).filter(([,e])=>e.readiness==='planned').map(([p])=>p),['gmail','google-calendar','outlook-email','microsoft-calendar','hubspot']);
 });
 await test('operation data classes are current lifecycle classes or the reserved/proposed connector classes',()=>{
  const classes=new Map(JSON.parse(read('docs/data-lifecycle.json')).classes.map(c=>[c.id,c.storageStatus]));
  for(const [p,e] of Object.entries(m.connectorCatalog.providers))for(const [id,op] of Object.entries(e.operations)){
   if(op.dataClass==='connector-receipts'){assert.equal(classes.get('connector-receipts'),'current','WH-143 registers the class with its tables');continue;}
   assert.ok(classes.has(op.dataClass),`${p}.${id}`);
   assert.equal(classes.get(op.dataClass),e.readiness==='planned'?'planned':'current',`${p}.${id}`);
  }
 });
 const invalid=(name,mutate,code)=>test(name,()=>{const c=clone();mutate(c);throws(()=>m.validateCatalog(c),code);});
 await invalid('future contract version',c=>c.contractVersion=2,'UNSUPPORTED_VERSION');
 await invalid('unknown provider',c=>c.providers.slack=c.providers.gmail,'UNKNOWN_PROVIDER');
 await invalid('plain-HTTP origin',c=>c.providers.github.origins.push('http://api.github.com'),'HOST_NOT_ALLOWED');
 await invalid('origin with port',c=>c.providers.github.origins.push('https://api.github.com:8443'),'HOST_NOT_ALLOWED');
 await invalid('origin with userinfo',c=>c.providers.github.origins.push('https://user@api.github.com'),'HOST_NOT_ALLOWED');
 await invalid('IP-literal origin',c=>c.providers.github.origins.push('https://140.82.112.5'),'HOST_NOT_ALLOWED');
 await invalid('wildcard origin',c=>c.providers.gmail.origins.push('https://*.googleapis.com'),'HOST_NOT_ALLOWED');
 await invalid('operation host outside provider origins',c=>c.providers.gmail.operations['message.get'].origin='https://www.googleapis.com','HOST_NOT_ALLOWED');
 await invalid('path traversal in template',c=>c.providers.cloudflare.operations['zone.get'].path='/client/v4/../zones/{zone}','INVALID_PATH');
 await invalid('absolute URL as path',c=>c.providers.cloudflare.operations['zone.get'].path='//evil.example/{zone}','INVALID_PATH');
 await invalid('query embedded in path',c=>c.providers.cloudflare.operations['zone.get'].path='/client/v4/zones/{zone}?x=1','INVALID_PATH');
 await invalid('caller-supplied URL field',c=>c.providers.github.operations['repository.get'].url='https://evil.example','UNKNOWN_FIELD');
 await invalid('undeclared parameter in template',c=>c.providers.github.operations['repository.get'].path='/repos/{owner}/{name}/{extra}','PARAM_MISMATCH');
 await invalid('free-form URL parameter type',c=>c.providers.github.operations['repository.get'].params.owner='url','INVALID_PARAM_TYPE');
 await invalid('operation scope not requested by provider',c=>c.providers.cloudflare.operations['zone.get'].scopes=['account.write'],'SCOPE_NOT_DECLARED');
 await invalid('rule authority on a read',c=>c.providers.gmail.operations['messages.search'].authority=['owner-request','approved-rule'],'RULE_READ_FORBIDDEN');
 await invalid('rule-only operation without owner request',c=>c.providers.hubspot.operations['contact.create'].authority=['approved-rule'],'INVALID_AUTHORITY');
 await invalid('action without reconciliation reads',c=>c.providers.cloudflare.operations['dnsRecord.create'].reconcile=[],'INVALID_ACTION_CONTRACT');
 await invalid('action without idempotency',c=>c.providers.cloudflare.operations['dnsRecord.create'].idempotency=null,'INVALID_ACTION_CONTRACT');
 await invalid('reconciliation through another action',c=>c.providers.github.operations['backup.commit'].reconcile=['backup.commit'],'INVALID_RECONCILE');
 await invalid('missing price',c=>delete c.providers.github.operations['backup.commit'].price,'MISSING_FIELD');
 await invalid('nonzero price disguised as plan inclusion',c=>c.providers.github.operations['backup.commit'].price={customerUnits:5,basis:'plan-inclusion'},'INVALID_PRICE');
 await invalid('model-context destination with owner-control consent',c=>c.providers.gmail.operations['messages.search'].consent='owner-control','CONSENT_TOO_WEAK');
 await invalid('unbounded response',c=>c.providers.gmail.operations['message.get'].bounds.maxBytes=50*1048576,'INVALID_BOUNDS');
 await invalid('access lifetime above eight hours',c=>c.providers.gmail.authorization.maxAccessSeconds=86400,'INVALID_LIFETIME');
 await invalid('revocation endpoint with query',c=>c.providers.cloudflare.authorization.revoke='https://dash.cloudflare.com/oauth2/revoke?next=x','HOST_NOT_ALLOWED');
 await invalid('local-only revocation claiming an endpoint',c=>c.providers['outlook-email'].authorization.revoke='https://graph.microsoft.com/x','INVALID_REVOCATION');

 // ---------- Request construction: no caller URL, typed parameters only ----------
 await test('built requests use exact origin, manual redirects and encoded typed parameters',()=>{
  const r=req('github','branch.head',{owner:'synthetic-org',name:'site',branch:'feature/x'});
  assert.equal(r.url,'https://api.github.com/repos/synthetic-org/site/git/ref/heads/feature%2Fx');assert.equal(r.redirect,'manual');assert.equal(r.method,'GET');
  assert.equal(r.body,undefined);assert.ok(Object.isFrozen(r));assert.equal(r.feature,'read');
 });
 await test('planned providers cannot start OAuth, seal credentials or build a request',()=>{
  for(const p of ['gmail','google-calendar','outlook-email','microsoft-calendar','hubspot']){
   const [operationId]=Object.keys(m.connectorCatalog.providers[p].operations);
   throws(()=>req(p,operationId,{}),'PROVIDER_PLANNED');
   throws(()=>m.connectorAuthorization(p),'PROVIDER_PLANNED');
   throws(()=>m.connectorVaultContext(p,'token','owner-a','record-1'),'PROVIDER_PLANNED');
  }
  throws(()=>req('slack','messages.search',{},undefined,{grantedScopes:[]}),'UNKNOWN_PROVIDER');
  throws(()=>m.connectorAuthorization('slack'),'UNKNOWN_PROVIDER');
 });
 await test('OAuth descriptors and vault contexts come from the catalog for available providers only',()=>{
  assert.deepEqual(m.connectorAuthorization('github').scopes,['metadata:read','contents:write']);
  assert.equal(m.connectorAuthorization('cloudflare').authorize,'https://dash.cloudflare.com/oauth2/auth');
  assert.equal(m.connectorVaultContext('github','refresh','owner-a','record-1'),'whumpo:github:refresh:owner-a:record-1');
  throws(()=>m.connectorVaultContext('cloudflare','refresh','owner-a','record-1'),'VAULT_PURPOSE_NOT_ALLOWED');
  throws(()=>m.connectorVaultContext('github','token','owner:a','record-1'),'INVALID_VAULT_CONTEXT');
 });
 await test('planned providers never reach a transport through the reference runtime',async()=>{
  const calls=[];const rt=m.createReferenceRuntime({catalog:clone(),transport:async r=>{calls.push(r);return {status:200,json:{}};}});
  throws(()=>rt.connect('owner-a','gmail',{access_token:'synthetic-access',token_type:'Bearer',expires_in:3600}),'PROVIDER_PLANNED');
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'x'}),'NOT_CONNECTED');
  assert.equal(calls.length,0);
 });
 await test('request input has no URL, host, path, header or query field',()=>{
  for(const key of ['url','host','path','headers','query','origin','method'])
   throws(()=>m.buildConnectorRequest({providerId:'github',operationId:'repository.get',params:{owner:'org',name:'site'},authority:'owner-request',grantedScopes:scopes('github'),[key]:'https://evil.example/x'}),'UNKNOWN_FIELD');
 });
 for(const [name,params,code] of [
  ['host injection in owner',{owner:'evil.example/x',name:'site'},'INVALID_PARAM'],
  ['traversal in name',{owner:'org',name:'..'},'INVALID_PARAM'],
  ['extra parameter',{owner:'org',name:'site',url:'https://evil.example'},'UNKNOWN_FIELD'],
  ['missing parameter',{owner:'org'},'MISSING_FIELD'],
 ])await test(`request refuses ${name}`,()=>throws(()=>req('github','repository.get',params),code));
 await test('branch parameters accept exactly what the backup adapter accepts as a default branch',()=>{
  for(const branch of ['main','release/2026+hotfix@x','zweig-ü','a..b','b'.repeat(255)])
   assert.equal(req('github','branch.head',{owner:'org',name:'site',branch}).path,'/repos/org/site/git/ref/heads/'+encodeURIComponent(branch));
  for(const branch of ['','b'.repeat(256),'main\u0000x','main\nx','main\u007f',7])throws(()=>req('github','branch.head',{owner:'org',name:'site',branch}),'INVALID_PARAM');
 });
 await test('encoded parameters cannot change the path',()=>{
  // A dot-segment branch is a valid string but would be resolved away by the URL parser.
  for(const branch of ['.','..'])throws(()=>req('github','branch.head',{owner:'org',name:'site',branch}),'INVALID_PATH');
  const c=clone();c.providers.github.operations['repository.get'].params.name='query';
  const loose=m.createRequestBuilder(c);
  assert.equal(req('github','repository.get',{owner:'org',name:'a b'},undefined,{builder:loose}).path,'/repos/org/a%20b');
  throws(()=>req('github','repository.get',{owner:'org',name:'..'},undefined,{builder:loose}),'INVALID_PATH');
 });
 await test('builder enforces authority classes',()=>{
  throws(()=>req('github','repository.get',{owner:'org',name:'site'},undefined,{authority:'maintainer'}),'INVALID_AUTHORITY');
  throws(()=>req('cloudflare','zones.list',{page:1},undefined,{authority:'approved-rule'}),'RULE_READ_FORBIDDEN');
  const live=m.createRequestBuilder(liveCatalog()),synth=m.createRequestBuilder(synthetic());
  throws(()=>req('gmail','message.send',{},{raw:'c3ludGhldGlj'},{builder:live,authority:'approved-rule',grantedScopes:scopes('gmail')}),'OWNER_REQUEST_ONLY');
  throws(()=>req('hubspot','contact.create',{},{properties:{email:'lead@example.test'}},{builder:synth,authority:'approved-rule',grantedScopes:scopes('hubspot')}),'ADAPTER_NOT_ACCEPTED');
  assert.equal(req('hubspot','contact.create',{},{properties:{email:'lead@example.test'}},{builder:live,authority:'approved-rule',grantedScopes:scopes('hubspot')}).feature,'dispatch');
 });
 await test('builder checks the scope subset',()=>{
  throws(()=>req('cloudflare','zones.list',{page:1},undefined,{grantedScopes:['zone.read','dns.read','dns.write','account.write']}),'SCOPE_WIDENED');
  throws(()=>req('cloudflare','dnsRecords.findExact',{zone,name:'www.example.com'},undefined,{grantedScopes:['zone.read']}),'INSUFFICIENT_SCOPE');
  assert.equal(req('cloudflare','zones.list',{page:1},undefined,{grantedScopes:['zone.read']}).method,'GET');
 });
 await test('GraphQL operations accept only the registered document',()=>{
  throws(()=>req('github','backup.paths',{},{query:'mutation{deleteRepository}',variables:{}}),'BODY_NOT_ALLOWED');
  throws(()=>req('github','backup.paths',{},{query:m.graphqlDocuments.BackupCommit,variables:{}}),'BODY_NOT_ALLOWED');
  const variables=src.backupPathsVariables('org','site','whumpo/a/versions/b','a'.repeat(40));
  throws(()=>req('github','backup.paths',{},{query:m.graphqlDocuments.BackupPaths,variables:{...variables,extra:'x'}}),'UNKNOWN_FIELD');
  throws(()=>req('github','backup.paths',{},{query:m.graphqlDocuments.BackupPaths,variables:{...variables,p0:{}}}),'BODY_NOT_ALLOWED');
  throws(()=>req('github','backup.commit',{},{query:m.graphqlDocuments.BackupCommit,variables:{input:'x'}}),'BODY_NOT_ALLOWED');
 });
 await test('JSON bodies are closed to declared fields',()=>throws(()=>req('cloudflare','dnsRecord.create',{zone},{type:'TXT',name:'x.example',content:'v',ttl:1,comment:'m',priority:1}),'BODY_NOT_ALLOWED'));
 await test('JSON bodies are bounded',()=>throws(()=>req('cloudflare','dnsRecord.create',{zone},{type:'TXT',name:'x.example',content:'v'.repeat(262145),ttl:1,comment:'m'}),'TOO_LARGE'));
 await test('unknown operation and reads with bodies are refused',()=>{
  throws(()=>req('github','repository.delete',{}),'UNKNOWN_OPERATION');
  throws(()=>req('github','installations.list',{},{x:1}),'BODY_NOT_ALLOWED');
 });
 await test('the builder refuses unpriced or unreconcilable catalogs',()=>{
  const unpriced=clone();delete unpriced.providers.cloudflare.operations['dnsRecord.create'].price;
  throws(()=>m.createRequestBuilder(unpriced),'MISSING_FIELD');
  const unreconcilable=clone();unreconcilable.providers.cloudflare.operations['dnsRecord.create'].reconcile=[];
  throws(()=>m.createRequestBuilder(unreconcilable),'INVALID_ACTION_CONTRACT');
 });

 // ---------- Existing GitHub/Cloudflare code agrees with the catalog ----------
 const gh=read('src/github-connection.ts'),backups=read('src/github-backups.ts'),cf=read('src/cloudflare-connection.ts'),dns=read('src/cloudflare-dns.ts');
 await test('GitHub BackupPaths document is the exact recovery query in source',()=>assert.equal(m.graphqlDocuments.BackupPaths,src.backupPathsQuery));
 await test('GitHub BackupCommit document is the exact mutation the backup code sends',()=>assert.ok(backups.includes(`const query='${m.graphqlDocuments.BackupCommit}';`)));
 await test('current adapter hosts, OAuth endpoints and scopes equal the catalog',()=>{
  const g=m.connectorCatalog.providers.github,c=m.connectorCatalog.providers.cloudflare;
  assert.deepEqual(g.origins,['https://api.github.com']);assert.ok(gh.includes(`const API='${g.origins[0]}';`));
  assert.ok(gh.includes(`new URL('${g.authorization.authorize}')`)&&gh.includes(`request('${g.authorization.token}'`));
  assert.equal(g.authorization.revoke,'https://api.github.com/applications/{clientId}/token');assert.ok(gh.includes("request(API+'/applications/'+config.clientId+'/token'"));
  assert.ok(cf.includes(`const scopes=${JSON.stringify(c.scopes).replaceAll('"',"'")};`));
  assert.ok(cf.includes(`new URL('${c.authorization.authorize}')`)&&cf.includes(`request('${c.authorization.token}'`)&&cf.includes(`'${c.authorization.revoke}'`));
  // Cloudflare API requests are catalog-built under the fixed /client/v4 prefix; recovery strips exactly that prefix.
  assert.ok(cf.includes("const apiPrefix='/client/v4';")&&cf.includes('request(built.url,')&&cf.includes('built.path.slice(apiPrefix.length)'));
  for(const op of Object.values(c.operations))assert.ok(op.origin===c.origins[0]&&op.path.startsWith('/client/v4/'));
  for(const op of [...Object.values(g.operations),...Object.values(c.operations)])assert.ok(src.featureOperations.includes(op.feature));
 });
 await test('the GitHub adapters send exactly the catalog GitHub operations',()=>{
  assert.deepEqual(Object.keys(m.connectorCatalog.providers.github.operations),['user.get','installations.list','repositories.list','repository.get','branch.head','backup.paths','backup.commit']);
  assert.equal(req('github','user.get',{}).url,'https://api.github.com/user');assert.ok(gh.includes("request(githubRequest('user.get',{}).url,{headers:"));
  assert.ok(gh.includes("access.send('installations.list',{})"));
  assert.ok(backups.includes("access.send('repositories.list',{installation,page})"));
  assert.equal(req('github','repositories.list',{installation:7,page:3}).path,'/user/installations/7/repositories?per_page=20&page=3');
  assert.ok(backups.includes("access.send('repository.get',{owner,name})")&&backups.includes("access.send('branch.head',{owner:repo.owner,name:repo.name,branch:repo.branch})"));
  for(const op of ['backup.paths','backup.commit'])assert.equal(req('github',op,{},{query:m.graphqlDocuments[op==='backup.paths'?'BackupPaths':'BackupCommit'],variables:op==='backup.paths'?src.backupPathsVariables('o','n','a/b/c/d','a'.repeat(40)):{input:{}}}).path,'/graphql');
  assert.ok(backups.includes("access.send('backup.paths',{},{query:backupPathsQuery,")&&backups.includes("access.send('backup.commit',{},{query,variables:{input}})"));
  assert.ok(gh.includes("buildConnectorRequest({providerId:'github',operationId,params,authority:'owner-request',grantedScopes,"));
 });
 await test('the Cloudflare adapters send exactly the catalog Cloudflare operations',()=>{
  assert.deepEqual(Object.keys(m.connectorCatalog.providers.cloudflare.operations),['zones.list','zone.get','dnsRecords.findExact','dnsRecord.create']);
  assert.ok(cf.includes("access.send('zones.list',{page})")&&dns.includes("access.send('zone.get',{zone:id})"));
  assert.ok(dns.includes("access.send('dnsRecords.findExact',{zone:zoneId,name})")&&dns.includes("access.send('dnsRecord.create',{zone:a.zone_id},{type:"));
  assert.ok(cf.includes("buildConnectorRequest({providerId:'cloudflare',operationId,params,authority:'owner-request',grantedScopes:scopes,"));
  // The former path regex guard is gone; the zone list keeps its narrower page and use limits.
  assert.ok(!/\/\^\\\/zones/.test(cf)&&cf.includes("&&(page as number)<=100"));
  for(const page of [1,50,100])assert.equal(strip(req('cloudflare','zones.list',{page}).path),'/zones?per_page=50&page='+page);
  const create=req('cloudflare','dnsRecord.create',{zone},{type:'TXT',name:'x.example.com',content:'"v"',ttl:1,comment:'m'});
  assert.equal(create.method,'POST');assert.equal(strip(create.path),'/zones/'+zone+'/dns_records');
 });
 await test('Cloudflare dnsRecoveryRead admits exactly the catalog reconcile reads',()=>{
  const a={zone_id:zone,record_name:'_whumpo.www.example.com'};
  for(const op of m.connectorCatalog.providers.cloudflare.operations['dnsRecord.create'].reconcile){
   const params=op==='zone.get'?{zone}:{zone,name:a.record_name};
   assert.equal(src.dnsRecoveryRead(a,strip(req('cloudflare',op,params).path),'GET',undefined),true,op);
  }
  const create=req('cloudflare','dnsRecord.create',{zone},{type:'TXT',name:a.record_name,content:'"x"',ttl:1,comment:'m'});
  assert.equal(src.dnsRecoveryRead(a,strip(create.path),'POST',JSON.parse(create.body)),false);
  assert.equal(src.dnsRecoveryRead(a,strip(req('cloudflare','zone.get',{zone:'f'.repeat(32)}).path),'GET',undefined),false);
  assert.equal(src.dnsRecoveryRead(a,strip(req('cloudflare','zones.list',{page:1}).path),'GET',undefined),false);
 });
 await test('GitHub backupRecoveryRead admits exactly the catalog reconcile reads',()=>{
  const b={repo_owner:'synthetic-org',repo_name:'site',branch:'main',path:'whumpo/11111111-1111-4111-8111-111111111111/versions/22222222-2222-4222-8222-222222222222'},head='a'.repeat(40);
  const repo=req('github','repository.get',{owner:b.repo_owner,name:b.repo_name});
  const ref=req('github','branch.head',{owner:b.repo_owner,name:b.repo_name,branch:b.branch});
  const paths=req('github','backup.paths',{},{query:m.graphqlDocuments.BackupPaths,variables:src.backupPathsVariables(b.repo_owner,b.repo_name,b.path,head)});
  assert.equal(src.backupRecoveryRead(b,repo.path,{method:'GET'}),true);
  assert.equal(src.backupRecoveryRead(b,ref.path,{method:'GET'}),true);
  assert.equal(src.backupRecoveryRead(b,paths.path,{method:'POST',body:paths.body}),true);
  const commit=req('github','backup.commit',{},{query:m.graphqlDocuments.BackupCommit,variables:{input:{}}});
  assert.equal(src.backupRecoveryRead(b,commit.path,{method:'POST',body:commit.body}),false);
  assert.deepEqual(m.connectorCatalog.providers.github.operations['backup.commit'].reconcile,['repository.get','branch.head','backup.paths']);
 });
 await test('existing vault binds ciphertext to provider, purpose, owner and record',async()=>{
  const sealed=await src.seal(keyring,'whumpo:github:token:owner-a:record-1','synthetic-token');
  assert.equal(await src.unseal(keyring,'whumpo:github:token:owner-a:record-1',sealed),'synthetic-token');
  for(const context of ['whumpo:cloudflare:token:owner-a:record-1','whumpo:github:token:owner-b:record-1','whumpo:github:pkce:owner-a:record-1','whumpo:github:token:owner-a:record-2'])
   await assert.rejects(()=>src.unseal(keyring,context,sealed));
 });
 await test('gap G-C3/G-C4: current vault contexts and handoff providers admit only GitHub and Cloudflare',async()=>{
  await assert.rejects(()=>src.seal(keyring,'whumpo:gmail:token:owner-a:record-1','synthetic-token'));
  assert.deepEqual(m.connectorProviders.filter(p=>src.isConnectionProvider(p)),['github','cloudflare']);
 });
 await test('catalog-derived providers, feature ids and vault contexts agree with the existing code',async()=>{
  assert.deepEqual([...m.connectableProviders],m.connectorProviders.filter(p=>src.isConnectionProvider(p)));
  for(const p of m.connectorProviders)assert.equal(m.isConnectableProvider(p),src.isConnectionProvider(p),p);
  assert.equal(m.isConnectableProvider('github '),false);
  for(const p of m.connectableProviders)assert.equal(m.connectorFeatureId(p),src.connectionFeature(userId,p,null,'read').featureId);
  for(const p of m.connectorProviders)for(const purpose of ['token','pkce','refresh','backup']){
   const context=`whumpo:${p}:${purpose}:owner-a:record-1`,accepted=await src.seal(keyring,context,'synthetic-token').then(()=>true,()=>false);
   assert.equal(m.connectorVaultContextPattern.test(context),accepted,context);
   if(!m.isConnectableProvider(p))continue;
   let built=false;try{built=m.connectorVaultContext(p,purpose,'owner-a','record-1')===context;}catch{}
   assert.equal(built,accepted,context);
  }
 });

 // ---------- Reusable runtime conformance suite ----------
 const {fakeProvider,runConformance,token,gmailScopes,trainingRoute,approvedRoute}=referenceConformance({m,test});

 const clockBase=Date.parse('2026-10-04T00:00:00Z');
 function referenceFactory(catalog=synthetic,routes=trainingRoute){
  return ()=>{const clock={t:clockBase},{s,transport}=fakeProvider();return {rt:m.createReferenceRuntime({catalog:catalog(),transport,now:()=>clock.t,routes}),s,clock};};
 }
 await runConformance('reference',referenceFactory());

 // Reference-only cases that need a live-accepted synthetic catalog or eligibility changes.
 await test('approved deterministic rule: exact destination, template and limit; requires an accepted adapter',async()=>{
  const contact={properties:{email:'lead@example.test',marker:'m-r'}},approval={operationId:'contact.create',destinationDigest:m.digest({}),bodyTemplateDigest:m.digest(contact),maxPerPeriod:1};
  const notAccepted=referenceFactory()();notAccepted.rt.connect('owner-a','hubspot',token(undefined,{refresh_token:'r',expires_in:1800}));
  await rejects(()=>notAccepted.rt.prepareAction({kind:'rule',ownerId:'owner-a',ruleId:'rule-1',ruleRevision:3,jobDigest:'j',approval},'hubspot','contact.create',{},contact),'ADAPTER_NOT_ACCEPTED');
  const {rt,s}=referenceFactory(liveCatalog)();rt.connect('owner-a','hubspot',token(undefined,{refresh_token:'r',expires_in:1800}));
  const r=principal=>({kind:'rule',ownerId:'owner-a',ruleId:'rule-1',ruleRevision:3,jobDigest:'j',...principal});
  await rejects(()=>rt.prepareAction(r({approval}),'hubspot','contact.create',{},{properties:{email:'other@example.test',marker:'m-r'}}),'RULE_DESTINATION_MISMATCH');
  await rejects(()=>rt.prepareAction(r({}),'hubspot','contact.create',{},contact),'RULE_APPROVAL_REQUIRED');
  const p=await rt.prepareAction(r({approval}),'hubspot','contact.create',{},contact);
  assert.equal((await rt.confirmAction(r({approval}),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price})).state,'applied');
  assert.equal(rt.receipt(p.receiptId).authority,'approved-rule');assert.equal(s.effects.length,1);
  await rejects(()=>rt.prepareAction(r({approval}),'hubspot','contact.create',{},contact),'RULE_LIMIT');
 });
 await test('inclusion, configuration, consent and readiness are reported and enforced separately',async()=>{
  const {rt,s}=referenceFactory()();rt.connect('owner-a','cloudflare',token());
  assert.deepEqual(rt.status('owner-a','cloudflare'),{inclusion:'included',configuration:'configured',consent:'active',readiness:'private-test'});
  const p=await rt.prepareAction(owner(),'cloudflare','dnsRecord.create',{zone},{type:'TXT',name:'_whumpo.www.example.com',content:'"v"',ttl:1,comment:'m-2'});
  s.mode.lose='after';await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price});s.mode.lose=null;
  rt.setInclusion('owner-a','cloudflare',false);
  assert.deepEqual(rt.status('owner-a','cloudflare'),{inclusion:'not-included',configuration:'configured',consent:'active',readiness:'private-test'});
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'NOT_INCLUDED');
  // Loss of eligibility keeps reconciliation of an existing effect and disconnect available.
  assert.equal((await rt.reconcile(owner(),p.receiptId,()=>({operationId:'dnsRecords.findExact',params:{zone,name:'_whumpo.www.example.com'},matches:j=>j.items.some(i=>i.marker==='m-2')}))).state,'observed');
  assert.equal((await rt.disconnect('owner-a','cloudflare')).state,'revoked');
  rt.setInclusion('owner-a','cloudflare',true);rt.setConfigured('cloudflare',false);
  assert.equal(rt.status('owner-a','cloudflare').configuration,'unconfigured');
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'NOT_CONFIGURED');
 });
 await test('an approved non-training route admits model-context consent; output stays untrusted',async()=>{
  const {rt}=referenceFactory(synthetic,approvedRoute)();rt.connect('owner-a','gmail',token(gmailScopes,{refresh_token:'r'}));
  const c=rt.proposeLookup(owner(),'gmail','message.get',{id:'abc'},'model-context');rt.confirmLookup(owner(),c.consentId);
  const r=await rt.read(owner(),'gmail','message.get',{id:'abc'},{consentId:c.consentId,destination:'model-context'});
  assert.equal(r.provenance,'untrusted-external');assert.equal(r.destination,'model-context');
 });
 return total-before;
}

suiteCount=await suite(await load());

// ---------- Static checks, run once ----------
await test('the module is pure; only the platform Worker reaches it',async()=>{
 const allowed={'src/connector-catalog/catalog.ts':[],'src/connector-catalog/builder.ts':['./catalog']};
 for(const file of moduleFiles){
  const text=read(file);
  const specifiers=[...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
  assert.deepEqual(specifiers,allowed[file],`${file} imports ${specifiers}`);
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env|D1Database|\.prepare\(|\benv\.[A-Z_]+|\bunseal\(|\bseal\(/.test(text),file);
 }
 // The platform Worker sends GitHub/Cloudflare requests through the builder. The sites, apps and runtime Workers never
 // load the catalog (feature admission and the vault, which the apps Worker reaches, import catalog types only).
 for(const [worker,reach] of [['src/index.ts',moduleFiles],['src/site-host.ts',[]],['src/app-host.ts',[]],['src/runtime/worker.ts',[]]]){
  const out=await build({entryPoints:[join(root,worker)],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent',external:['cloudflare:*','*.wasm']});
  const inputs=Object.keys(out.metafile.inputs);assert.ok(inputs.length>5,worker);
  assert.deepEqual(inputs.filter(p=>/connector-catalog|prototypes\//.test(p)).sort(),[...reach].sort(),`${worker} connector catalog reach`);
 }
});

// ---------- Mutation check: each deliberately broken copy of the source must fail the suite ----------
const C='src/connector-catalog/catalog.ts',B='src/connector-catalog/builder.ts';
const mutants=[
 ['plain-HTTP origin accepted',C,"return u.protocol==='https:'&&u.origin===value","return u.origin===value"],
 ['IP-literal origin accepted',C,"&&!/^[0-9.]+$|^\\[/.test(u.hostname)",''],
 ['operation host not pinned to provider origins',C,"check(entry.origins.includes(o.origin),'HOST_NOT_ALLOWED',p);",''],
 ['dot segments allowed in a path template',C,"!/[?#\\\\%]|\\.\\.|:\\/\\//.test(o.path)","!/[?#\\\\%]|:\\/\\//.test(o.path)"],
 ['undeclared template parameter accepted',C,"&&names.every(n=>Object.hasOwn(o.params,n))",''],
 ['operation scope outside the provider set',C,"&&o.scopes.every((s:unknown)=>entry.scopes.includes(s)),'SCOPE_NOT_DECLARED'",",'SCOPE_NOT_DECLARED'"],
 ['rule authority allowed on a read',C,"check(o.kind==='action'||!o.authority.includes('approved-rule'),'RULE_READ_FORBIDDEN',p);",''],
 ['action without reconciliation accepted',C,"&&o.reconcile.length>=1,'INVALID_ACTION_CONTRACT'",",'INVALID_ACTION_CONTRACT'"],
 ['reconciliation through an action accepted',C,"&&entry.operations[r]?.kind==='read'",''],
 ['unpriced operation accepted',C,"shape(op,operationKeys,p);","shape(op,operationKeys.filter(k=>k!=='price'),p,['price']);"],
 ['nonzero price disguised as plan inclusion',C,"&&(price.customerUnits===0)===(price.basis==='plan-inclusion')",''],
 ['model context without request-bound consent',C,"check(o.consent==='request-bound'||!o.destinations.includes('model-context'),'CONSENT_TOO_WEAK',p);",''],
 ['unbounded response accepted',C,"&&bounds.maxBytes<=1048576",''],
 ['long access lifetime accepted',C,"&&a.maxAccessSeconds<=28800",''],
 ['endpoint query accepted',C,"return exactOrigin(u.origin)&&!u.search&&!u.hash;","return exactOrigin(u.origin);"],
 ['future contract version accepted',C,"check(catalog.contractVersion===contractVersion,'UNSUPPORTED_VERSION','catalog');",''],
 ['planned provider available',C,"check(entry.readiness!=='planned','PROVIDER_PLANNED',providerId);",''],
 ['planned provider connectable',C,"return !!e&&e.readiness!=='planned';","return !!e;"],
 ['branch parameter admits control characters',C,"v.length<=255&&!/[\\u0000-\\u001f\\u007f]/.test(v)","v.length<=255"],
 ['branch parameter unbounded',C,"v.length>=1&&v.length<=255&&","v.length>=1&&"],
 ['refresh custody for a no-refresh provider',C,"purpose!=='refresh'||entry.authorization.refresh!=='none'","true"],
 ['caller URL or path field accepted',B,"shape(input,inputKeys,'request',['body']);","shape(input,inputKeys,'request',['body','url','host','path','headers','query','origin','method']);"],
 ['rule may read',B,"check(authority!=='approved-rule'||op.kind==='action','RULE_READ_FORBIDDEN',operationId);",''],
 ['owner-request-only operation accepts a rule',B,"check(op.authority.includes(authority as AuthorityClass),'OWNER_REQUEST_ONLY',operationId);",''],
 ['rule without live acceptance',B,"check(authority!=='approved-rule'||entry.readiness==='live-accepted','ADAPTER_NOT_ACCEPTED',providerId);",''],
 ['widened granted scopes accepted',B,"&&entry.scopes.includes(scope)),'SCOPE_WIDENED'","),'SCOPE_WIDENED'"],
 ['missing operation scope accepted',B,"check(op.scopes.every(scope=>granted.includes(scope)),'INSUFFICIENT_SCOPE',operationId);",''],
 ['untyped parameter accepted',B,"for(const [name,type] of Object.entries(op.params))check(paramTypes[type](params[name]),'INVALID_PARAM',name);",''],
 ['GraphQL document not pinned',B,"check(body.query===graphqlDocuments[op.body.document],'BODY_NOT_ALLOWED','body.query');",''],
 ['GraphQL variables open',B,"shape(body.variables,Object.keys(declared),'body.variables');","if(!plain(body.variables))return '';"],
 ['JSON body fields open',B,"&&Object.keys(body).every(key=>fields.includes(key))",''],
 ['JSON body unbounded',B,"check(encoder.encode(text).byteLength<=op.bounds.maxBytes,'TOO_LARGE','body');",''],
 ['body accepted on a bodiless operation',B,"check(body===undefined,'BODY_NOT_ALLOWED','body');",''],
 ['URL reinterpretation unchecked',B,"check(url.pathname===path&&url.search===search,'INVALID_PATH',operationId);",''],
 ['redirects followed',B,"redirect:'manual',operation:op","redirect:'follow',operation:op"],
 ['builder skips catalog validation',B,"export function createRequestBuilder(catalog:unknown){\n validateCatalog(catalog);","export function createRequestBuilder(catalog:unknown){"],
];
// Each mutant must be caught by the check written for that property, not by an unrelated failure.
const killedBy={
 'plain-HTTP origin accepted':'plain-HTTP origin','IP-literal origin accepted':'IP-literal origin',
 'operation host not pinned to provider origins':'operation host outside provider origins','dot segments allowed in a path template':'path traversal in template',
 'undeclared template parameter accepted':'undeclared parameter in template','operation scope outside the provider set':'operation scope not requested by provider',
 'rule authority allowed on a read':'rule authority on a read','action without reconciliation accepted':'action without reconciliation reads',
 'reconciliation through an action accepted':'reconciliation through another action','unpriced operation accepted':'missing price',
 'nonzero price disguised as plan inclusion':'nonzero price disguised as plan inclusion','model context without request-bound consent':'model-context destination with owner-control consent',
 'unbounded response accepted':'unbounded response','long access lifetime accepted':'access lifetime above eight hours',
 'endpoint query accepted':'revocation endpoint with query','future contract version accepted':'future contract version',
 'planned provider available':'planned providers cannot start OAuth, seal credentials or build a request',
 'planned provider connectable':'catalog-derived providers, feature ids and vault contexts agree with the existing code',
 'branch parameter admits control characters':'branch parameters accept exactly what the backup adapter accepts','branch parameter unbounded':'branch parameters accept exactly what the backup adapter accepts',
 'refresh custody for a no-refresh provider':'OAuth descriptors and vault contexts come from the catalog for available providers only',
 'caller URL or path field accepted':'request input has no URL, host, path, header or query field',
 'rule may read':'builder enforces authority classes','owner-request-only operation accepts a rule':'builder enforces authority classes','rule without live acceptance':'builder enforces authority classes',
 'widened granted scopes accepted':'builder checks the scope subset','missing operation scope accepted':'builder checks the scope subset',
 'untyped parameter accepted':'request refuses host injection in owner','GraphQL document not pinned':'GraphQL operations accept only the registered document',
 'GraphQL variables open':'GraphQL operations accept only the registered document','JSON body fields open':'JSON bodies are closed to declared fields',
 'JSON body unbounded':'JSON bodies are bounded','body accepted on a bodiless operation':'unknown operation and reads with bodies are refused',
 'URL reinterpretation unchecked':'encoded parameters cannot change the path','redirects followed':'built requests use exact origin, manual redirects and encoded typed parameters',
 'builder skips catalog validation':'the builder refuses unpriced or unreconcilable catalogs',
};
let killed=0;
for(const [name,file,find,replace] of mutants){
 const text=read(file);
 assert.equal(text.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
 const mutant=await load({[file]:text.replace(find,()=>replace)}).catch(error=>{throw new Error(`mutant "${name}" does not bundle`,{cause:error});});
 await assert.rejects(suite(mutant),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?' / '+e.cause.message:''}`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
console.log(`connectors-contract: ${suiteCount} source checks and 1 static check passed against src/connector-catalog with the synthetic reference runtime; ${killed}/${mutants.length} source mutants caught (synthetic providers; no database, network, credential or model).`);
