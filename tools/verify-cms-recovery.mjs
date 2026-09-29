// Isolated local restore of trusted operator captures; never accepts remote bindings.
import {readFile,writeFile,mkdtemp,lstat,rm,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import wrangler from 'wrangler';
import {restoreCapturedCMSD1} from './cms-database-snapshot.mjs';
import {verifyCapturedCMSMedia} from './cms-media-snapshot.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function jsonFile(path,maxBytes){const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await file.stat();if(!stat.isFile()||stat.size>maxBytes)throw Error('Invalid recovery artifact size');return JSON.parse(await file.readFile('utf8'));}finally{await file.close();}}
export async function verifyCMSRecoveryCapture(directory,{projectId}={}){
 const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Invalid capture directory');
 const manifest=await jsonFile(join(directory,'manifest.json'),1024*1024),snapshot=await jsonFile(join(directory,'database.json'),70*1024*1024);
 if(projectId&&manifest.identity?.project_id!==projectId)throw Error('Recovery project identity mismatch');
 if(manifest.format!=='townhello-cms-database-manifest-v1'||digest(snapshot)!==manifest.digest)throw Error('Database capture checksum mismatch');
 let media;
 if(manifest.media){media=await jsonFile(join(directory,'media.json'),4*1024*1024);if(digest(media)!==manifest.media.digest)throw Error('Media manifest checksum mismatch');await verifyCapturedCMSMedia(join(directory,'media'),media);}
 const temp=await mkdtemp(join(tmpdir(),'townhello-cms-recovery-'));let proxy;
 try{
  const config=join(temp,'wrangler.json');await writeFile(config,JSON.stringify({name:'townhello-cms-recovery-local',compatibility_date:'2026-09-29',workers_dev:false,preview_urls:false,d1_databases:[{binding:'DB',database_name:'isolated-restore',database_id:randomUUID()}],r2_buckets:[{binding:'MEDIA',bucket_name:'isolated-restore-media'}]}),{mode:0o600});
  proxy=await wrangler.getPlatformProxy({configPath:config,persist:{path:join(temp,'state')},remoteBindings:false});
  const restored=await restoreCapturedCMSD1(proxy.env.DB,snapshot);
  for(const object of media?.objects??[]){
   const bytes=await readFile(join(directory,'media',object.file));if(createHash('sha256').update(bytes).digest('hex')!==object.sha256)throw Error('Media changed since verification');
   const http={...object.metadata.http_metadata};if(http.cacheExpiry!==undefined){http.cacheExpiry=new Date(http.cacheExpiry);if(!Number.isFinite(http.cacheExpiry.getTime()))throw Error('Invalid media cache expiry');}
   await proxy.env.MEDIA.put(object.key,bytes,{httpMetadata:http,customMetadata:object.metadata.custom_metadata??{}});
   const result=await proxy.env.MEDIA.get(object.key);if(!result||result.size!==object.size||createHash('sha256').update(new Uint8Array(await result.arrayBuffer())).digest('hex')!==object.sha256)throw Error('Restored media bytes differ');
   for(const [key,value] of Object.entries(http))if(String(result.httpMetadata[key])!==String(value))throw Error('Restored media HTTP metadata differs');
   const actual=result.customMetadata??{},expected=object.metadata.custom_metadata??{};if(Object.keys(actual).length!==Object.keys(expected).length||Object.keys(expected).some(k=>actual[k]!==expected[k]))throw Error('Restored media custom metadata differs');
  }
  return {format:'townhello-cms-local-recovery-evidence-v1',verifiedAt:new Date().toISOString(),databaseDigest:restored.digest,mediaDigest:manifest.media?.digest??null,tables:restored.snapshot.tables.length,rows:restored.rows,mediaObjects:media?.objects.length??0,scope:'isolated-local-d1-r2-only',productionRecoveryVerified:false};
 }finally{await proxy?.dispose();await rm(temp,{recursive:true,force:true});}
}
async function main(){
 const [project,snapshot,...extra]=process.argv.slice(2);if(extra.length||![project,snapshot].every(v=>/^[0-9a-f-]{36}$/.test(v??'')))throw Error('Invalid recovery capture IDs');
 let directory=resolve('.');for(const part of ['.secrets','cms-database-snapshots',project,snapshot]){directory=join(directory,part);const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid capture path');}
 const evidence=await verifyCMSRecoveryCapture(directory,{projectId:project}),file=join(directory,'local-restore-'+randomUUID()+'.json');await writeFile(file,JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600});console.log('Local D1/R2 restore verified. Evidence saved to '+file+'. Production recovery and traffic switching remain unverified.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Local CMS recovery verification failed. Use: npm run cms:verify-recovery -- PROJECT_ID SNAPSHOT_ID. The capture must be a trusted operator artifact; no production data was changed.');process.exitCode=1;});
