import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureEnvironment,runProfile} from '../tools/verify.mjs';
const environment=fixtureEnvironment({PATH:'/bin',RUN_LIVE_MUSE:'1',CLOUDFLARE_API_TOKEN:'secret',AI_API_KEY:'secret',NODE_OPTIONS:'--inspect',HTTPS_PROXY:'secret'},'/tmp/fixture','site');
assert.equal(environment.SITE_AI,'1');
for(const key of ['RUN_LIVE_MUSE','CLOUDFLARE_API_TOKEN','AI_API_KEY','NODE_OPTIONS','HTTPS_PROXY'])assert.equal(environment[key],undefined);
const cwd=mkdtempSync(join(tmpdir(),'whumpo-profile-test-'));let calls=0,home;
try{
 assert.throws(()=>runProfile('unknown',{cwd}),/Choose/);
 for(const result of [{status:7},{status:null,signal:'SIGTERM'},{error:{code:'ETIMEDOUT'}}]){
  calls=0;
  assert.throws(()=>runProfile('fast',{cwd,run:(_cmd,_args,options)=>{calls++;home=options.env.HOME;assert.ok(existsSync(home));return result;}}),/failed/);
  assert.equal(calls,1);assert.equal(existsSync(home),false);
 }
 const homes=[];
 for(let i=0;i<2;i++)runProfile('site',{cwd,run:(_cmd,args,options)=>{assert.deepEqual(args,['tests/customer-site-journey.mjs']);homes.push(options.env.HOME);return {status:0};}});
 assert.notEqual(homes[0],homes[1]);assert.ok(homes.every(h=>!existsSync(h)));
 writeFileSync(join(cwd,'.dev.vars'),'SYNTHETIC=1');
 assert.throws(()=>runProfile('fast',{cwd,run:()=>assert.fail('Must not launch')}),/Local/);
}finally{rmSync(cwd,{recursive:true,force:true});}
console.log('Verification runner: credential/live-flag isolation, unique homes, cleanup, invalid-profile/local-secret refusal and failure propagation passed.');
