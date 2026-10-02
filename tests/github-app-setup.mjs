import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {githubAppSecrets,verifyGitHubApp,requireFreshGitHubSetup} from '../tools/configure-github-app.mjs';
const input={appId:'123',slug:'whumpo-test',clientId:'Iv1.fixture',clientSecret:'synthetic-secret'};
const secrets=githubAppSecrets(input);
assert.ok(!Object.hasOwn(secrets,'CONNECTION_ENCRYPTION_KEYRING'));
const app={id:123,slug:'whumpo-test',external_url:'https://whumpo.com',permissions:{contents:'write',metadata:'read'},events:[]};
verifyGitHubApp(app,secrets);
for(const change of [{id:124},{slug:'other'},{external_url:'https://old.invalid'},{client_id:'different'},{events:['push']},{permissions:{...app.permissions,workflows:'write'}},{permissions:{contents:'read',metadata:'read'}}])assert.throws(()=>verifyGitHubApp({...app,...change},secrets));
for(const change of [{appId:'1e2'},{appId:0},{appId:'9007199254740992'},{slug:'../../repo'},{clientSecret:'secret\nline'},{operatorToken:'never-install'}])assert.throws(()=>githubAppSecrets({...input,...change}));
const github={retainedCredentials:0,pendingRevocations:0,missing:Object.keys(secrets)};
requireFreshGitHubSetup({providers:{github}});
for(const change of [{retainedCredentials:1},{pendingRevocations:1},{missing:[...github.missing,'CONNECTION_ENCRYPTION_KEYRING']},{missing:[]}])assert.throws(()=>requireFreshGitHubSetup({providers:{github:{...github,...change}}}));
const dir=await mkdtemp('/tmp/whumpo-app-setup-');
try{
 await mkdir(dir+'/.secrets',{mode:0o700});await writeFile(dir+'/.secrets/github-app.json','{"clientSecret":"SYNTHETIC_SECRET_SENTINEL",INVALID}',{mode:0o600});
 const result=spawnSync(process.execPath,[new URL('../tools/configure-github-app.mjs',import.meta.url).pathname],{cwd:dir,encoding:'utf8'});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.ok(!result.stderr.includes('SYNTHETIC_SECRET_SENTINEL'));assert.match(result.stderr,/No credentials were printed/);
}finally{await rm(dir,{recursive:true,force:true});}
console.log('GitHub setup checks passed: exact identity, minimal permissions, strict private fields, retained-vault refusal and encryption-key preservation.');
