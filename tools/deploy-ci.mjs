import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {verifyBuildSnapshot} from './build-snapshot.mjs';
import {currentSchemaArtifact} from './current-schema.mjs';
import {applyRelease,newJournal,readJSON,same} from './release-manifest.mjs';
import {prepareRelease} from './prepare-release.mjs';

// Merge-to-main release (Cloudflare Workers Builds). It writes its own review
// record for an unchanged current schema, then runs the ordinary prepare/apply
// path under the same D1 deployment lease. Schema initialization, database
// replacement and CMS registrations remain owner cutovers (docs/releases.md).
export const ciRefusal=reason=>Error('CI release refused: '+reason+' Nothing was deployed. Schema/database changes need an owner cutover; see docs/releases.md.');

export function ciCommit(env=process.env,git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()){
 // Manual Workers Builds runs set WORKERS_CI_COMMIT_SHA to the branch name; only a hex SHA is trusted.
 let commit=/^[0-9a-f]{7,40}$/.test(env.WORKERS_CI_COMMIT_SHA??'')?env.WORKERS_CI_COMMIT_SHA:undefined,dirty=false;
 if(!commit)try{commit=git(['rev-parse','HEAD']);}catch{}
 try{dirty=!!git(['status','--porcelain']);}catch{}
 if(!/^[0-9a-f]{7,40}$/.test(commit??''))throw ciRefusal('the source commit is unknown.');
 return {commit,dirty,branch:env.WORKERS_CI_BRANCH??null};
}

// Workers Builds sets WRANGLER_CI_OVERRIDE_NAME (and WRANGLER_CI_MATCH_TAG) for the
// linked Worker, and Wrangler then deploys EVERY config under that name. The
// release deploys four named Workers and verifies each by name and tag, so the
// override must not reach any child Wrangler process.
export function scrubCIOverrides(env,linked='whumpo-platform'){
 const name=env.WRANGLER_CI_OVERRIDE_NAME;
 if(name!==undefined&&name!==linked)throw ciRefusal('the Workers Builds trigger is linked to '+name+', not '+linked+'.');
 delete env.WRANGLER_CI_OVERRIDE_NAME;delete env.WRANGLER_CI_MATCH_TAG;
 return env;
}

export function ciReview(snapshot,artifact,source){
 return {
  version:3,environment:'test',buildInputs:snapshot.inputs.sha256,
  review:'Automatic merge-to-main release of commit '+source.commit+' via Cloudflare Workers Builds. The merged pull request is the source and mixed-Worker review; the current schema is unchanged.',
  mixedWorkersCompatible:true,schemaChange:'none',schemaSha256:artifact.sqlSha256,
 };
}

/** Refuse anything that is not an ordinary release onto the exact current schema. */
export function ciPreflight(driver,observed,artifact){
 if(!same(observed.schema,artifact.expected))throw ciRefusal('the live control database does not match the current schema in this commit.');
 const target=driver.configs.platform.d1_databases.find(d=>d.binding==='DB')?.database_id;
 if(observed.workers.platform.databases.find(d=>d.binding==='DB')?.id!==target)throw ciRefusal('the configured control database differs from the one bound to the live platform.');
 if(observed.cms.length)throw ciRefusal('CMS registrations exist and their master key is not available to CI.');
}

// A concurrent merge can deploy between this run's prepare and its apply, so reconcile refuses
// before any step starts. Only that refusal, with every journal step still pending, is retried.
export const baselineMoved=(error,journal)=>{
 const steps=Object.values(journal?.steps??{});
 return error?.message==='Worker changed outside this release'&&steps.length>0&&steps.every(step=>step.status==='pending');
};

export async function ciRelease(root,driver,{env=process.env,log=console.log,commit=ciCommit,snapshot:snap=verifyBuildSnapshot,schema=currentSchemaArtifact,prepare=prepareRelease,apply=applyRelease}={}){
 if(env.WORKERS_CI!=='1')throw Error('The ci release runs only in Cloudflare Workers Builds after a merge to main. Do not deploy by hand.');
 scrubCIOverrides(process.env);
 const source=commit(env),snapshot=await snap(root),artifact=await schema(root);
 ciPreflight(driver,await driver.observe(),artifact);
 const review=ciReview(snapshot,artifact,source);
 for(let attempt=0;;attempt++){
  const {directory,manifest}=await prepare(root,driver,review,{git:()=>({commit:source.commit,dirty:source.dirty})});
  if(manifest.schema.mode!=='none')throw ciRefusal('the prepared release is not a schema-unchanged release.');
  log('Prepared release '+manifest.id+' for commit '+source.commit);
  let failure;
  try{await apply(directory,driver);}catch(error){failure=error;}
  let journal=null;try{journal=await readJSON(join(directory,'journal.json'));}catch(e){if(e.code==='ENOENT')journal=newJournal(manifest);}
  log(JSON.stringify({release:manifest.id,commit:source.commit,journal},null,2));
  if(failure&&attempt===0&&baselineMoved(failure,journal)){
   log('Retrying once: another release changed the live Workers after release '+manifest.id+' was prepared and no step had started. Preparing again from live state.');
   continue;
  }
  if(failure)throw failure;
  return {manifest,journal};
 }
}
