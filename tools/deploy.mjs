import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJSON,verifyRelease,applyRelease,reconcileRelease,newJournal} from './release-manifest.mjs';
import {prepareRelease} from './prepare-release.mjs';
import {releaseProvider} from './release-provider.mjs';
import {ciRelease} from './deploy-ci.mjs';

async function main(args){
 const [command,value]=args;
 if(!command||command==='--help'){
  console.log('Usage: pnpm run deploy ci | prepare REVIEW.json | status RELEASE_ID | apply RELEASE_ID\nci runs only inside Cloudflare Workers Builds after a merge to main and refuses schema/database changes. prepare/apply are the owner cutover path for those. Status is read-only. See docs/releases.md.');if(!command)process.exitCode=1;return;
 }
 if(command==='ci'){
  if(args.length!==1)throw Error('Invalid release command');
  await ciRelease(process.cwd(),await releaseProvider());return;
 }
 if(!['prepare','status','apply'].includes(command)||args.length!==2)throw Error('Invalid release command');
 if(command==='prepare'){
  const result=await prepareRelease(process.cwd(),await releaseProvider(),await readJSON(value));
  console.log('Prepared release '+result.manifest.id+'; manifest: '+join(result.directory,'manifest.json'));return;
 }
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))throw Error('Invalid release ID');
 const directory=resolve('.secrets/releases',value),manifest=await verifyRelease(directory),driver=await releaseProvider();
 if(command==='apply'){
  const result=await applyRelease(directory,driver);console.log('Release '+value+': '+result.status+'. Verify application behavior separately.');return;
 }
 let journal;try{journal=await readJSON(join(directory,'journal.json'));}catch(e){if(e.code!=='ENOENT')throw e;journal=newJournal(manifest);}
 const observed=await driver.observe(manifest);let reconciliation='ready';
 try{reconcileRelease(manifest,structuredClone(journal),observed);}catch(error){reconciliation=error.message;}
 console.log(JSON.stringify({release:value,status:journal.status,reconciliation,workers:Object.fromEntries(Object.entries(observed.workers).map(([role,w])=>[role,{before:manifest.before.workers[role].id,live:w.id,candidateTagMatches:w.tag===manifest.workers[role].tag,step:journal.steps[role]}])),schema:{observed:observed.schema,target:manifest.schema.expected,step:journal.steps.schema},cmsRegistryMatches:JSON.stringify(manifest.cms)===JSON.stringify(observed.cms)},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
