import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

// WH-141 rewiring checks. The GitHub and Cloudflare adapters send only catalog operations built by
// src/connector-catalog/builder.ts. This drives the production githubAccess()/cloudflareAccess() capabilities
// against a disposable current-schema database (SQLite by default, local D1 with --d1) and synthetic recording
// transports: no network, provider account, real credential or model. The expected requests are the exact bytes the
// pre-rewiring adapters sent (recorded from the existing suites on the WH-141 catalog commit 5918c1b). Every check
// also runs against deliberately broken copies of the source (mutants below); each must be caught by its named check.
const root=fileURLToPath(new URL('..',import.meta.url));
const read=file=>readFileSync(join(root,file),'utf8');
const files={gh:'src/github-connection.ts',backups:'src/github-backups.ts',cf:'src/cloudflare-connection.ts',dns:'src/cloudflare-dns.ts',catalog:'src/connector-catalog/catalog.ts',index:'src/index.ts'};
const entry=`export {githubAccess,githubInstallations,ConnectionError} from './src/github-connection';
export {githubRepositories} from './src/github-backups';
export {cloudflareAccess,cloudflareZones} from './src/cloudflare-connection';
export {isConnectionProvider} from './src/connection-handoff-shape';
export {connectionFeature} from './src/feature-admission';
export {seal} from './src/connection-vault';
export {hashToken,newSessionToken} from './src/security';
export {admitWorkspace} from './src/workspace-identity/admission';
export {resolveIdentity} from './src/workspace-identity/authority';
export {backupPathsQuery,backupPathsVariables} from './src/connection-recovery';
export * as catalog from './src/connector-catalog/catalog';
export {buildConnectorRequest} from './src/connector-catalog/builder';`;
async function load(overrides={}){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',external:['cloudflare:*'],plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}

const fixture=await databaseFixture({allowedArguments:['--explain']}),{db}=fixture;
const key=fixtureKeyring('cd'.repeat(32));
const github={clientId:'Iv1.sends',clientSecret:'synthetic-secret',appId:123,slug:'synthetic',key},cloudflare={clientId:'synthetic-client',clientSecret:'synthetic-secret',key};
const zone='0123456789abcdef0123456789abcdef',ghToken='ghu_synthetic_sends',cfToken='cf_synthetic_sends';
const commitDocument='mutation BackupCommit($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}';
const ghHeaders=[['accept','application/vnd.github+json'],['x-github-api-version','2026-03-10'],['user-agent','Whumpo-test'],['content-type','application/json'],['authorization','Bearer '+ghToken]];
const cfHeaders=[['authorization','Bearer '+cfToken],['content-type','application/json']];

let total=0;
async function test(name,fn){try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}}

const base=await load();
await initializeFixtureKeys(db,key);
const account=await workspaceFixture(db,base),user=account.account;await paidPlan(db,user,'business');
const ghTokenId=crypto.randomUUID(),cfTokenId=crypto.randomUUID(),now=new Date().toISOString(),later=new Date(Date.now()+3600000).toISOString();
await db.prepare('INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,?)').bind(ghTokenId,user,await base.seal(key,`whumpo:github:token:${user}:${ghTokenId}`,ghToken),later,'active').run();
await db.prepare('INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,?)').bind(user,'44','synthetic-org',ghTokenId,now).run();
await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,'active')").bind(cfTokenId,user,await base.seal(key,`whumpo:cloudflare:token:${user}:${cfTokenId}`,JSON.stringify({access:cfToken})),later,now).run();

/** A recording transport. `reply(url)` returns the JSON body for each synthetic provider response. */
function recorder(reply=()=>({})){
 const calls=[];
 return {calls,transport:async(url,init)=>{calls.push({url,init});return Response.json(reply(String(url)));}};
}
/** The exact request shape: URL, init key order, method, header entries in order, body, redirect and a timeout signal. */
function shape({url,init}){
 return {url,keys:Object.keys(init),method:init.method,headers:Object.entries(init.headers),body:init.body,redirect:init.redirect,signal:init.signal instanceof AbortSignal};
}
const ghGet=url=>({url,keys:['headers','redirect','signal'],method:undefined,headers:ghHeaders,body:undefined,redirect:'manual',signal:true});
const ghPost=body=>({url:'https://api.github.com/graphql',keys:['method','body','headers','redirect','signal'],method:'POST',headers:ghHeaders,body,redirect:'manual',signal:true});
const cfRequest=(url,method='GET',body=undefined)=>({url,keys:['method','headers','body','redirect','signal'],method,headers:cfHeaders,body,redirect:'manual',signal:true});
const status=async(promise,code)=>assert.rejects(promise,e=>{assert.equal(e.status,code,e.message);return true;});

async function suite(m,source){
 const before=total;
 // Admission is per module instance, so each (possibly mutated) bundle admits the same synthetic session itself.
 const scope=await m.admitWorkspace(db,await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:account.token}));
 const gh=(transport,usage={projectId:null,operation:'read'})=>m.githubAccess(scope,user,github,transport,usage);
 const cf=(transport,usage={projectId:null,operation:'read'})=>m.cloudflareAccess(scope,user,cloudflare,transport,usage);

 // ---------- Request equality with the pre-rewiring adapters ----------
 await test('GitHub sends are byte-identical to the pre-rewiring requests',async()=>{
  const r=recorder(),access=await gh(r.transport);
  const branch='release/2026+hotfix@x',unicode='zweig-\u00fc';
  const paths=m.backupPathsVariables('synthetic-org','site.v2','whumpo/11111111-1111-4111-8111-111111111111/versions/22222222-2222-4222-8222-222222222222','a'.repeat(40));
  const input={branch:{repositoryNameWithOwner:'synthetic-org/site.v2',branchName:branch},expectedHeadOid:'a'.repeat(40),clientMutationId:'33333333-3333-4333-8333-333333333333',message:{headline:'[skip ci] Whumpo source backup x'},fileChanges:{additions:[{path:'whumpo/p/versions/v/README.txt',contents:'c3ludGhldGlj'}]}};
  await access.send('user.get',{});
  await access.send('installations.list',{});
  await access.send('repositories.list',{installation:7,page:3});
  await access.send('repository.get',{owner:'synthetic-org',name:'site.v2'});
  await access.send('branch.head',{owner:'synthetic-org',name:'site.v2',branch});
  await access.send('branch.head',{owner:'synthetic-org',name:'site.v2',branch:unicode});
  await access.send('backup.paths',{},{query:m.backupPathsQuery,variables:paths});
  await access.send('backup.commit',{},{query:commitDocument,variables:{input}});
  assert.deepEqual(r.calls.map(shape),[
   ghGet('https://api.github.com/user'),
   ghGet('https://api.github.com/user/installations?per_page=100'),
   ghGet('https://api.github.com/user/installations/7/repositories?per_page=20&page=3'),
   ghGet('https://api.github.com/repos/synthetic-org/site.v2'),
   ghGet('https://api.github.com/repos/synthetic-org/site.v2/git/ref/heads/release%2F2026%2Bhotfix%40x'),
   ghGet('https://api.github.com/repos/synthetic-org/site.v2/git/ref/heads/zweig-%C3%BC'),
   ghPost(JSON.stringify({query:m.backupPathsQuery,variables:paths})),
   ghPost(JSON.stringify({query:commitDocument,variables:{input}})),
  ]);
 });
 await test('Cloudflare sends are byte-identical to the pre-rewiring requests',async()=>{
  const r=recorder(()=>({success:true,result:[]})),access=await cf(r.transport);
  const record={type:'TXT',name:'_whumpo.www.example.com',content:JSON.stringify('whumpo-verification=x'),ttl:1,comment:'Whumpo proof y'};
  await access.send('zones.list',{page:1});await access.send('zones.list',{page:100});
  await access.send('zone.get',{zone});
  await access.send('dnsRecords.findExact',{zone,name:'_whumpo.www.example.com'});
  await access.send('dnsRecord.create',{zone},record);
  assert.deepEqual(r.calls.map(shape),[
   cfRequest('https://api.cloudflare.com/client/v4/zones?per_page=50&page=1'),
   cfRequest('https://api.cloudflare.com/client/v4/zones?per_page=50&page=100'),
   cfRequest(`https://api.cloudflare.com/client/v4/zones/${zone}`),
   cfRequest(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?name.exact=_whumpo.www.example.com&per_page=100&page=1`),
   cfRequest(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`,'POST',JSON.stringify(record)),
  ]);
 });
 await test('adapter discovery reads send the same requests through their call sites',async()=>{
  const r=recorder(url=>url.includes('/repositories')?{repositories:[]}:url.includes('api.github.com')?{total_count:1,installations:[{id:1,app_id:123,suspended_at:null,account:{login:'synthetic-org'},repository_selection:'selected'}]}:{success:true,result:[],result_info:{total_pages:1}});
  await m.githubInstallations(scope,user,github,r.transport);
  await m.githubRepositories(scope,user,github,1,2,r.transport);
  await m.cloudflareZones(scope,user,cloudflare,3,r.transport);
  assert.deepEqual(r.calls.map(shape),[
   ghGet('https://api.github.com/user/installations?per_page=100'),
   ghGet('https://api.github.com/user/installations?per_page=100'),
   ghGet('https://api.github.com/user/installations/1/repositories?per_page=20&page=2'),
   cfRequest('https://api.cloudflare.com/client/v4/zones?per_page=50&page=3'),
  ]);
 });

 // ---------- No caller URL, host, path, header or undeclared query/body ----------
 await test('send refuses a caller URL, host, path or unknown operation before any provider call',async()=>{
  const g=recorder(),c=recorder(),ga=await gh(g.transport),ca=await cf(c.transport);
  for(const target of ['https://evil.example/x','//evil.example/x','/user','/user/installations?per_page=100','/repos/a/b','api.github.com','repository.delete','constructor'])
   await status(ga.send(target,{}),400);
  for(const target of ['https://evil.example/x','/zones?per_page=50&page=1','/zones/'+zone,'zone.delete','__proto__'])
   await status(ca.send(target,{}),400);
  await status(ga.send('repository.get',{owner:'o',name:'n',url:'https://evil.example'}),400);
  await status(ga.send('user.get',{},{query:commitDocument,variables:{input:{}}}),400);
  await status(ga.send('backup.commit',{},{query:'mutation X{deleteRepository}',variables:{input:{}}}),400);
  await status(ga.send('backup.paths',{},{query:m.backupPathsQuery,variables:{owner:'o',name:'n',p0:'a',p1:'b',p2:'c',p3:'d',extra:'x'}}),400);
  await status(ca.send('dnsRecord.create',{zone},{type:'TXT',name:'x.example.com',content:'v',ttl:1,comment:'m',priority:10}),400);
  await status(ca.send('zone.get',{zone},{headers:{host:'evil.example'}}),400);
  assert.equal(g.calls.length+c.calls.length,0);
 });
 await test('typed parameters cannot change the host or path',async()=>{
  const g=recorder(),c=recorder(),ga=await gh(g.transport),ca=await cf(c.transport);
  for(const params of [{owner:'evil.example/x',name:'site'},{owner:'org',name:'..'},{owner:'org',name:'a/b'},{owner:'org@evil.example',name:'site'},{owner:'org',name:7}])
   await status(ga.send('repository.get',params),400);
  for(const branch of ['..','.','','main\u0000x','x'.repeat(256)])
   await status(ga.send('branch.head',{owner:'org',name:'site',branch}),400);
  for(const params of [{installation:0,page:1},{installation:'1/../../x',page:1},{installation:1,page:1.5}])
   await status(ga.send('repositories.list',params),400);
  for(const z of ['Z'.repeat(32),'../'+zone.slice(3),zone+'/dns_records'])
   await status(ca.send('zone.get',{zone:z}),400);
  for(const name of ['a b','Evil.Example.com','www.example.com&per_page=1000','www.example.com#x','localhost'])
   await status(ca.send('dnsRecords.findExact',{zone,name}),400);
  assert.equal(g.calls.length+c.calls.length,0);
 });
 await test('Cloudflare zones.list keeps its narrower page and account-level read limits',async()=>{
  const c=recorder(()=>({success:true,result:[]})),ca=await cf(c.transport);
  for(const page of [0,101,1000,1.5,'1'])await status(ca.send('zones.list',{page}),400);
  const scoped=await cf(c.transport,{projectId:null,operation:'dispatch'});
  await status(scoped.send('zones.list',{page:1}),400);
  assert.equal(c.calls.length,0);
 });

 // ---------- Catalog-derived identity, byte-identical to the former literals ----------
 await test('connection provider identity is derived from the catalog and byte-identical',()=>{
  const corpus=['github','cloudflare','gmail','google-calendar','outlook-email','microsoft-calendar','hubspot','GitHub','github ',' cloudflare','','constructor','__proto__','toString',null,undefined,1,{},['github'],new String('github')];
  for(const value of corpus)assert.equal(m.isConnectionProvider(value),value==='github'||value==='cloudflare',String(value));
  assert.deepEqual([...m.catalog.connectableProviders],['github','cloudflare']);
  for(const p of ['github','cloudflare']){
   assert.equal(m.connectionFeature(user,p,null,'read').featureId,`connections.${p}`);
   assert.equal(m.catalog.connectorFeatureId(p),`connections.${p}`);
  }
 });
 await test('the vault context pattern accepts exactly the catalog-derived contexts',async()=>{
  for(const p of [...m.catalog.connectorProviders,'slack'])for(const purpose of ['token','pkce','refresh','backup'])for(const [owner,record] of [['owner-a','record-1'],['owner:a','record-1'],['owner-a','x'.repeat(129)]]){
   const context=`whumpo:${p}:${purpose}:${owner}:${record}`,accepted=await m.seal(key,context,'synthetic').then(()=>true,()=>false);
   assert.equal(m.catalog.connectorVaultContextPattern.test(context),accepted,context);
   let built=false;try{built=m.catalog.connectorVaultContext(p,purpose,owner,record)===context;}catch{}
   assert.equal(built,accepted,context);
  }
  // The adapters' own context helpers produce the same `whumpo:<provider>:<purpose>:<owner>:<record>` bytes.
  assert.ok(source.gh.includes('function aad(user:string,id:string,purpose:string){return `whumpo:github:${purpose}:${user}:${id}`;}'));
  assert.ok(source.cf.includes('const aad=(user:string,id:string,purpose:string)=>`whumpo:cloudflare:${purpose}:${user}:${id}`;'));
 });
 await test('planned providers cannot start OAuth, seal credentials or reach a transport',async()=>{
  const planned=m.catalog.connectorProviders.filter(p=>!['github','cloudflare'].includes(p));
  assert.deepEqual(planned,['gmail','google-calendar','outlook-email','microsoft-calendar','hubspot']);
  // OAuth start and callback routes exist only for the two connectable providers.
  const routes=new Set([...source.index.matchAll(/pathname\s*===\s*["']\/api\/connections\/([a-z-]+)\/(?:start|callback)["']/g)].map(x=>x[1]));
  assert.deepEqual([...routes].sort(),['cloudflare','github']);
  for(const p of planned){
   assert.equal(m.isConnectionProvider(p),false,p);
   assert.throws(()=>m.catalog.connectorAuthorization(p),e=>e.code==='PROVIDER_PLANNED');
   await assert.rejects(m.seal(key,`whumpo:${p}:token:${user}:record-1`,'synthetic'));
   const [operationId]=Object.keys(m.catalog.connectorCatalog.providers[p].operations);
   assert.throws(()=>m.buildConnectorRequest({providerId:p,operationId,params:{},authority:'owner-request',grantedScopes:[]}),e=>e.code==='PROVIDER_PLANNED');
  }
  // The adapters build only for their own provider; no other module forms a provider request.
  assert.ok(source.gh.includes("buildConnectorRequest({providerId:'github',operationId,"));
  assert.ok(source.cf.includes("buildConnectorRequest({providerId:'cloudflare',operationId,"));
 });

 // ---------- Static: every call site names a catalog operation; only request() reaches a transport ----------
 await test('adapter call sites name catalog operations and only the request helpers reach a transport',()=>{
  const ops=p=>Object.keys(m.catalog.connectorCatalog.providers[p].operations);
  const sites=[['gh','github',1],['backups','github',5],['cf','cloudflare',1],['dns','cloudflare',3]];
  for(const [file,provider,count] of sites){
   const text=source[file],calls=[...text.matchAll(/\baccess\.send\(\s*([^,)]*)/g)].map(x=>x[1].trim());
   assert.equal(calls.length,count,`${file} sends`);
   for(const arg of calls){const id=/^'([A-Za-z.]+)'$/.exec(arg)?.[1];assert.ok(id&&ops(provider).includes(id),`${file}: ${arg} is not a ${provider} catalog operation`);}
   assert.ok(!/\bfetch\(/.test(text),`${file} calls fetch directly`);
   assert.equal((text.match(/\btransport\(/g)??[]).length,['gh','cf'].includes(file)?1:0,`${file} transport calls`);
  }
  const targets=file=>[...source[file].matchAll(/\brequest\(((?:[^,()]|\([^()]*\))+),\{/g)].map(x=>x[1]);
  assert.deepEqual(targets('gh'),["API+'/applications/'+config.clientId+'/token'","'https://github.com/login/oauth/access_token'","githubRequest('user.get',{}).url","built.url"]);
  assert.deepEqual(targets('cf'),["'https://dash.cloudflare.com/oauth2/revoke'","'https://dash.cloudflare.com/oauth2/token'","built.url"]);
 });
 return total-before;
}

let checks=0,killed=0;
const mutants=[
 ['builder removed from a call site','backups',"access.send('repository.get',{owner,name})","access.send(('/repos/'+owner+'/'+name) as never,{} as never)",'adapter call sites name catalog operations'],
 ['GitHub send accepts a caller path','gh',"try{built=githubRequest(operationId,params,body);}","try{built=String(operationId).startsWith('/')?{kind:'read',method:'GET',url:API+String(operationId),path:String(operationId),body:undefined} as never:githubRequest(operationId,params,body);}",'send refuses a caller URL'],
 ['Cloudflare send accepts a caller URL','cf',"try{built=cloudflareRequest(operationId,params,body);}","try{built=String(operationId).startsWith('https://')?{kind:'read',method:'GET',url:String(operationId),path:'/client/v4/x',body:undefined} as never:cloudflareRequest(operationId,params,body);}",'send refuses a caller URL'],
 ['catalog path parameter widened to free text','catalog',"path:'/repos/{owner}/{name}',params:{owner:'login',name:'repo'}","path:'/repos/{owner}/{name}',params:{owner:'query',name:'repo'}",'typed parameters cannot change the host or path'],
 ['zones.list page limit widened','cf',"&&(page as number)<=100",'','Cloudflare zones.list keeps its narrower page'],
 ['planned provider let through','catalog',"gmail:{readiness:'planned'","gmail:{readiness:'private-test'",'connection provider identity is derived from the catalog'],
 ['redirects followed','gh',"redirect:'manual',signal","redirect:'follow',signal",'GitHub sends are byte-identical'],
 ['header added to Cloudflare sends','cf',"headers:{authorization:'Bearer '+tokens.access,'content-type':'application/json'},body:built.body","headers:{authorization:'Bearer '+tokens.access,'content-type':'application/json','x-forwarded-host':'evil.example'},body:built.body",'Cloudflare sends are byte-identical'],
];
try{
 const texts=Object.fromEntries(Object.entries(files).map(([k,f])=>[k,read(f)]));
 checks=await suite(base,texts);
 for(const [name,file,find,replace,expected] of mutants){
  assert.equal(texts[file].split(find).length,2,`mutant "${name}" must match ${files[file]} exactly once`);
  const mutated={...texts,[file]:texts[file].replace(find,()=>replace)};
  const m=await load({[files[file]]:mutated[file]});
  await assert.rejects(suite(m,mutated),e=>{
   if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}`);
   assert.ok(e.message.startsWith(expected),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?' / '+e.cause.message:''}`);return true;
  },`mutant survived: ${name}`);killed++;
 }
}finally{await fixture.close();}
assert.equal(killed,mutants.length);
console.log(`connection-sends: ${checks} checks passed against the production GitHub/Cloudflare sends (byte-identical requests, no caller URL/host/path/header, typed parameters, catalog-derived identity, planned providers refused); ${killed}/${mutants.length} source mutants caught by their named checks (synthetic transports; no network, provider account or real credential).`);
