import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {secretCustody,publicVariableNames,validateSecretCustody,secretBindingReadback} from '../tools/secret-custody.mjs';
import {assertArtifactPath,assertArtifactConfiguration} from '../tools/artifact-protection.mjs';
import {copyTree,fileInventory} from '../tools/release-manifest.mjs';
import {archivedConfig,prepareRelease} from '../tools/prepare-release.mjs';
import {deployPlatform} from '../tools/deploy-platform.mjs';

const report=await validateSecretCustody();assert.equal(report.secrets.length,10);assert.equal(report.backupCustodyVerified,false);assert.equal(report.retirementAllowed,false);
const canary='PRIVATE_CUSTODY_VALUE_CANARY';let refused=0;
function reject(fn){assert.throws(fn,e=>!e.message.includes(canary));refused++;}
for(const secret of secretCustody){
 const bindings=[{type:'secret_text',name:secret.name,text:canary,value:canary}],readback=secretBindingReadback(bindings);
 assert.ok(readback.secrets.find(x=>x.name===secret.name).configured);assert.ok(!JSON.stringify(readback).includes(canary));assert.equal(readback.backupCustodyVerified,false);
 reject(()=>secretBindingReadback([{type:'plain_text',name:secret.name,text:canary}]));
 reject(()=>secretBindingReadback([...bindings,...bindings]));
 reject(()=>assertArtifactConfiguration({vars:{[secret.name]:canary}}));
}
reject(()=>secretBindingReadback([{type:'secret_text',name:'UNCLASSIFIED_SECRET',text:canary}]));
reject(()=>assertArtifactConfiguration({vars:{UNCLASSIFIED_CONFIG:canary}}));
for(const vars of [null,[],{ENVIRONMENT:{secret:canary}}])reject(()=>assertArtifactConfiguration({vars}));
for(const field of ['env','define','unsafe','secrets','secrets_store_secrets'])reject(()=>assertArtifactConfiguration({[field]:canary}));
assertArtifactConfiguration({vars:Object.fromEntries(publicVariableNames.map(name=>[name,'public']))});
for(const path of ['src/.secrets/hidden.txt','src/.env','frontend/.env.test','public/.dev.vars','web/provider.key','dist/credentials.json','src/secrets.test.json','web/auth.json','tools/state.db','public/data.sqlite3','public/data.sqlite-shm','src/private.pem','src/.git/config','src/node_modules/private','../private','src/../private','/src/secret','src\\secret'])reject(()=>assertArtifactPath(path));
for(const path of ['src/secrets.d.ts','tools/secret-custody.mjs','dist/assets/icon.png','public/.well-known/assetlinks.json'])assertArtifactPath(path);

// Undeclared readers: a Worker source file that reads a secret from env but is not a declared reader fails closed;
// type-only pass-through mentions are not reads. (Regression: whumpo-apps' app-gateway read TURNSTILE_SECRET undeclared.)
assert.ok(secretCustody.find(s=>s.name==='TURNSTILE_SECRET').readers.includes('src/app-gateway.ts'));
const copy=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-custody-readers-');
try{
 for(const path of ['docs/data-lifecycle.json','src/secrets.d.ts',...new Set(secretCustody.flatMap(s=>s.readers))]){await mkdir(join(copy,path,'..'),{recursive:true});await writeFile(join(copy,path),await readFile(path,'utf8'));}
 await validateSecretCustody(copy);
 await mkdir(join(copy,'src/extra'),{recursive:true});
 await writeFile(join(copy,'src/extra/host.ts'),"type E=Pick<Env,'TURNSTILE_SECRET'>;export const pass=(env:E)=>env;");await validateSecretCustody(copy);
 for(const read of ["env.TURNSTILE_SECRET","env['AI_API_KEY']","env[ `STRIPE_TEST_KEY` ]"]){
  await writeFile(join(copy,'src/extra/reader.ts'),`export const leak=(env:any)=>${read};`);
  await assert.rejects(()=>validateSecretCustody(copy),/does not match current source/);refused++;
 }
}finally{await rm(copy,{recursive:true,force:true});}

const root=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-custody-');
try{
 await mkdir(join(root,'source'));await writeFile(join(root,'source/normal.ts'),'export const answer=42;');
 for(const name of ['provider.key','credentials.json','.env.test','state.sqlite','private.whumpo-key-backup','private.whumpo-restore-inventory','private.whumpo-restore-inventory-journal']){
  await writeFile(join(root,'source',name),canary);
  await assert.rejects(()=>copyTree(join(root,'source'),join(root,'target')),e=>!e.message.includes(canary));refused++;
  await rm(join(root,'source',name));
 }
 const files=await copyTree(join(root,'source'),join(root,'target'));assert.equal(files.length,1);assert.equal((await fileInventory(join(root,'target'))).length,1);
 assert.equal(await readFile(join(root,'target/normal.ts'),'utf8'),'export const answer=42;');
 const config={name:'whumpo-platform',workers_dev:false,preview_urls:false,vars:{ENVIRONMENT:'test',AI_API_KEY:canary}};
 reject(()=>archivedConfig('platform',config,'index.js',[]));
 let touched=0;
 await assert.rejects(()=>prepareRelease(root,{configs:{runtime:config},observe:()=>{touched++;throw Error();}},{}),/Private material/);assert.equal(touched,0);
 await assert.rejects(()=>deployPlatform({verify:async()=>{touched++;throw Error();},config,api:()=>{touched++;throw Error();}}),/Private material/);assert.equal(touched,0);
}finally{await rm(root,{recursive:true,force:true});}
console.log(`Secret/artifact custody passed: nine declared secrets, current reader/class references, undeclared env readers refused, binding-name projection, ${refused} refusals, private file/config rejection before archive/deploy. No real keys, backup recovery or retirement approval.`);
