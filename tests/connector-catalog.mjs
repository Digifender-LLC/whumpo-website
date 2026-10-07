import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {connectorCatalog as frozen,buildRequest,validateCatalog} from '../tools/prototypes/connectors.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
const built=await build({stdin:{contents:"export * from './src/connector-catalog';export * from './src/connector-admission';export {isConnectionProvider} from './src/connection-handoff-shape';export {seal} from './src/connection-vault';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const {connectorCatalog:catalog,buildConnectorRequest:request,connectorOperationUse:use}=m;
let checks=0;
const check=(name,fn)=>{try{fn();checks++;}catch(cause){throw Error(name,{cause});}};
const refuse=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code);return true;});
check('source catalog exactly matches frozen declarations',()=>{assert.deepEqual(catalog,frozen);assert.equal(validateCatalog(catalog),true);});
check('HubSpot local-only revocation never embeds a credential in its endpoint',()=>{assert.equal(catalog.providers.hubspot.authorization.revoke,null);assert.equal(catalog.providers.hubspot.authorization.revocation,'local-only-owner-removal');assert.equal(catalog.providers.hubspot.readiness,'planned');});
check('catalog declarations and nested operation authority cannot mutate',()=>{assert.throws(()=>catalog.providers.github.operations['backup.commit'].authority.push('approved-rule'));assert.throws(()=>catalog.providers.github.origins.push('https://evil.test'));});
const id='00000000-0000-4000-8000-000000000001',head='a'.repeat(40),path='whumpo/'+id+'/versions/'+id;
const paths={query:m.graphqlDocuments.BackupPaths,variables:{owner:'owner',name:'website',p0:head+':whumpo',p1:head+':whumpo/'+id,p2:head+':whumpo/'+id+'/versions',p3:head+':'+path}};
const commit={query:m.graphqlDocuments.BackupCommit,variables:{input:{branch:{repositoryNameWithOwner:'owner/website',branchName:'main'},expectedHeadOid:head,clientMutationId:id,message:{headline:'[skip ci] Whumpo source backup '+id},fileChanges:{additions:[{path:path+'/README.txt',contents:'dGVzdA=='}]}}}};
const dns={type:'TXT',name:'_whumpo.example.com',content:'"whumpo-verification=fixture"',ttl:1,comment:'Whumpo proof '+id};
const requests=[
 ['github','installations.list',{}],['github','repositories.list',{installation:7,page:2}],['github','repository.get',{owner:'owner',name:'website'}],
 ['github','branch.head',{owner:'owner',name:'website',branch:'feature/test'}],['github','backup.paths',{},paths],['github','backup.commit',{},commit],
 ['cloudflare','zones.list',{page:2}],['cloudflare','zone.get',{zone:'a'.repeat(32)}],['cloudflare','dnsRecords.findExact',{zone:'a'.repeat(32),name:'_whumpo.example.com'}],['cloudflare','dnsRecord.create',{zone:'a'.repeat(32)},dns],
];
for(const [provider,operation,params,body] of requests)check(provider+'.'+operation+' matches reference URL and fixed body',()=>assert.deepEqual(request(provider,operation,params,body),buildRequest(frozen,provider,operation,params,body)));
for(const provider of Object.keys(catalog.providers))check(provider+' provider and vault readiness',()=>{
 assert.equal(m.isConnectorProvider(provider),true);
 const active=catalog.providers[provider].readiness!=='planned';assert.equal(m.isConnectionProvider(provider),active);
 for(const purpose of ['token','pkce','refresh'])assert.equal(m.connectorVaultContext(`whumpo:${provider}:${purpose}:owner:record`),active&&(purpose!=='refresh'||provider==='github'));
 if(!active)refuse(()=>request(provider,Object.keys(catalog.providers[provider].operations)[0],{}),'PROVIDER_NOT_READY');
});
for(const provider of ['gmail','google-calendar','outlook-email','microsoft-calendar','hubspot']){
 await assert.rejects(()=>m.seal(fixtureKeyring(),`whumpo:${provider}:token:owner:record`,'synthetic'),{code:'ciphertext'});checks++;
}
for(const unknown of ['https://api.github.com','../github','__proto__','constructor','toString'])check('unknown provider '+unknown,()=>{assert.equal(m.isConnectorProvider(unknown),false);refuse(()=>request(unknown,'installations.list',{}),'PROVIDER_NOT_READY');});
for(const id of ['/user','/repos/owner/repo','https://evil.test','constructor','__proto__','repository.delete'])check('no path or unknown operation '+id,()=>refuse(()=>request('github',id,{}),'UNKNOWN_OPERATION'));
for(const [provider,operation,params,body] of [
 ['github','repository.get',{owner:'owner',name:'website',url:'https://evil.test'}],
 ['github','installations.list',{page:1}],['github','installations.list',{},{}],
 ['github','repository.get',{owner:'owner',name:'../secret'}],['github','branch.head',{owner:'owner',name:'repo',branch:'../main'}],
 ['github','repositories.list',{installation:1,page:51}],['cloudflare','zones.list',{page:101}],
 ['cloudflare','dnsRecords.findExact',{zone:'a'.repeat(32),name:'name.example&match=all'}],
 ['cloudflare','dnsRecord.create',{zone:'a'.repeat(32)},{...dns,tags:['undeclared']}],
 ['cloudflare','dnsRecord.create',{zone:'a'.repeat(32)},{...dns,type:'A'}],
 ['cloudflare','dnsRecord.create',{zone:'a'.repeat(32)},{...dns,proxied:true}],
 ['github','backup.paths',{}, {...paths,query:'query { viewer { login } }'}],
 ['github','backup.paths',{}, {...paths,variables:{...paths.variables,url:'https://evil.test'}}],
 ['github','backup.commit',{}, {...commit,variables:{input:{...commit.variables.input,fileChanges:{...commit.variables.input.fileChanges,deletions:[{path:'README.md'}]}}}}],
 ['github','backup.commit',{}, {...commit,variables:{input:{...commit.variables.input,fileChanges:{additions:[{path:'README.md',contents:'dGVzdA=='}]}}}}],
])check('refuse widened or invalid '+provider+'.'+operation,()=>assert.throws(()=>request(provider,operation,params,body)));
check('discovery cannot borrow a project review',()=>refuse(()=>use('cloudflare','zones.list',{projectId:id,operation:'prepare'}),'DISCOVERY_ONLY'));
check('action admission derives dispatch from operation',()=>assert.equal(use('github','backup.commit',{projectId:id,operation:'confirm'}),'dispatch'));
check('read retains prepare admission',()=>assert.equal(use('github','repository.get',{projectId:id,operation:'prepare'}),'prepare'));
check('reconciliation cannot dispatch',()=>refuse(()=>use('github','backup.commit',{recoveryId:id}),'RECOVERY_READ_ONLY'));
check('new mutation cannot borrow discovery admission',()=>refuse(()=>use('cloudflare','dnsRecord.create',{projectId:id,operation:'read'}),'REVIEW_REQUIRED'));
check('new mutation needs project',()=>refuse(()=>use('github','backup.commit',{projectId:null,operation:'dispatch'}),'REVIEW_REQUIRED'));
check('reconciliation read has no new-work entitlement',()=>assert.equal(use('github','backup.paths',{recoveryId:id}),null));
console.log(`Connector source catalog: ${checks} frozen-contract, exact request/body, planned-provider, vault and operation-admission checks passed.`);
