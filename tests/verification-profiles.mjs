import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureEnvironment,runProfile} from '../tools/verify.mjs';
const environment=fixtureEnvironment({PATH:'/bin',SITE_AI:'1',RUN_LIVE_MUSE:'1',CLOUDFLARE_API_TOKEN:'secret',AI_API_KEY:'secret',NODE_OPTIONS:'--inspect',HTTPS_PROXY:'secret'},'/tmp/fixture');
for(const key of ['SITE_AI','RUN_LIVE_MUSE','CLOUDFLARE_API_TOKEN','AI_API_KEY','NODE_OPTIONS','HTTPS_PROXY'])assert.equal(environment[key],undefined);
const cwd=mkdtempSync(join(tmpdir(),'whumpo-profile-test-'));let calls=0,home;
try{
 assert.throws(()=>runProfile('unknown',{cwd}),/Choose/);
 for(const result of [{status:7},{status:null,signal:'SIGTERM'},{error:{code:'ETIMEDOUT'}}]){
  calls=0;
  assert.throws(()=>runProfile('fast',{cwd,run:(_cmd,_args,options)=>{calls++;home=options.env.HOME;assert.ok(existsSync(home));return result;}}),/failed/);
  assert.equal(calls,1);assert.equal(existsSync(home),false);
 }
 const homes=[];
 for(let i=0;i<2;i++){const site=[];runProfile('site',{cwd,run:(_cmd,args,options)=>{site.push(args[0]);homes.push(options.env.HOME);return {status:0};}});assert.deepEqual(site,['tests/customer-site-journey.mjs','tests/standard-service-no-maintainer.mjs']);}
 assert.equal(new Set(homes).size,2,'Each profile run gets its own home');assert.ok(homes.every(h=>!existsSync(h)));
 const fast=[];runProfile('fast',{cwd,run:(_cmd,args)=>{fast.push(args[0]);return {status:0};}});
 assert.deepEqual(fast,['tests/ai.mjs','tests/prompt-data-boundaries.mjs','tests/ack-timing.mjs','tests/lifecycle-catalog.mjs','tests/connection-vault.mjs','tests/notifications-contract.mjs','tests/customer-presentation-contract.mjs']);
 const protection=[];runProfile('protection',{cwd,run:(_cmd,args)=>{protection.push(args[0]);return {status:0};}});
 assert.deepEqual(protection,['tests/processing-boundaries.mjs','tests/deploy-ci.mjs','tests/secret-custody.mjs','tests/build-snapshot.mjs','tests/release-manifest.mjs','tests/release-provider.mjs','tests/connection-oauth-outcomes.mjs','tests/connection-key-backup.mjs','tests/restore-admission.mjs','tests/restore-inventory.mjs','tests/restore-inventory-freshness.mjs','tests/github-refresh-custody.mjs','tests/github-grant-revocation.mjs','tests/github-grant-chat.mjs','tests/boundary-audit.mjs']);
 writeFileSync(join(cwd,'.dev.vars'),'SYNTHETIC=1');
 assert.throws(()=>runProfile('fast',{cwd,run:()=>assert.fail('Must not launch')}),/Local/);
}finally{rmSync(cwd,{recursive:true,force:true});}
console.log('Verification runner: credential/live-flag isolation, unique homes, cleanup, invalid-profile/local-secret refusal and failure propagation passed.');
