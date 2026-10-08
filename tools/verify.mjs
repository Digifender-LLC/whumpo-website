import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const profiles={
 fast:['tests/ai.mjs','tests/prompt-data-boundaries.mjs','tests/ack-timing.mjs','tests/lifecycle-catalog.mjs','tests/connection-vault.mjs'],
 protection:['tests/processing-boundaries.mjs','tests/deploy-ci.mjs','tests/secret-custody.mjs','tests/build-snapshot.mjs','tests/release-manifest.mjs','tests/release-provider.mjs','tests/connection-oauth-outcomes.mjs','tests/connection-key-backup.mjs','tests/restore-admission.mjs','tests/restore-inventory.mjs','tests/restore-inventory-freshness.mjs','tests/restore-inventory-containment.mjs','tests/recovery-authority.mjs','tests/github-refresh-custody.mjs','tests/github-grant-revocation.mjs','tests/github-grant-chat.mjs'],
 site:['tests/customer-site-journey.mjs'],
 app:['tests/customer-app-journey.mjs'],
};

// Deliberately allowlist environment inputs. In particular, no provider keys,
// optional live-test flags, NODE_OPTIONS, proxies or inherited Wrangler auth.
export function fixtureEnvironment(parent,home){
 const env={HOME:home,XDG_CONFIG_HOME:home,CI:'1',WRANGLER_SEND_METRICS:'false',WRANGLER_LOAD_DEV_VARS_FROM_DOT_ENV:'false'};
 for(const key of ['PATH','SystemRoot','WINDIR','TMPDIR','TEMP','TMP'])if(parent[key])env[key]=parent[key];
 return env;
}

export function runProfile(name,{run=spawnSync,parent=process.env,cwd=root}={}){
 if(!Object.hasOwn(profiles,name))throw Error('Choose fast, protection, site or app.');
 if(Number(process.versions.node.split('.')[0])!==24)throw Error('Verification requires Node.js 24.');
 // Wrangler can read local secret files even with an empty credential environment.
 if(readdirSync(cwd).some(name=>/^\.(?:dev\.vars|env)(?:\.|$)/.test(name)))throw Error('Local .env/.dev.vars files exist. Use a checkout without them for fixture profiles.');
 const home=mkdtempSync(resolve(tmpdir(),'whumpo-verify-'));
 try{
  for(const script of profiles[name]){
   console.log(`Verifying ${name}: ${script}`);
   const result=run(process.execPath,[script],{cwd,env:fixtureEnvironment(parent,home),stdio:'inherit',timeout:300000});
   if(result.error||result.signal||result.status!==0)throw Error(`${script} failed (${result.error?.code??result.signal??result.status}).`);
  }
 }finally{rmSync(home,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length>3)throw Error('Usage: node tools/verify.mjs [fast|protection|site|app]');
  runProfile(process.argv[2]??'fast');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
