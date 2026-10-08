// Shared fixtures for the WH-008 local recovery drills. Synthetic data only; nothing
// here reaches a network, a provider or a remote Cloudflare resource.
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fixtureCiphertext} from './connection-keyring.mjs';

/** Private in-memory object store with the R2 surface the current handlers use
 * (create-only put, head, get with stored metadata, list, delete). */
export function memoryBucket(){
 const objects=new Map();
 const view=(key,o)=>({key,size:o.body.length,customMetadata:{...o.customMetadata},httpMetadata:{...o.httpMetadata},arrayBuffer:async()=>Uint8Array.from(o.body).buffer,body:new Response(o.body).body});
 return {
  objects,
  get:async key=>objects.has(key)?view(key,objects.get(key)):null,
  head:async key=>objects.has(key)?view(key,objects.get(key)):null,
  put:async(key,value,options={})=>{
   if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;
   objects.set(key,{body:Buffer.from(value),customMetadata:options.customMetadata??{},httpMetadata:options.httpMetadata??{}});return {key};
  },
  delete:async key=>{for(const k of Array.isArray(key)?key:[key])objects.delete(k);},
  list:async({prefix='',limit=1000}={})=>({objects:[...objects.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(key=>({key})),truncated:false}),
 };
}

/** Isolated Wrangler state with EMPTY D1 databases and buckets. No routes, service
 * bindings or schema. Returns the platform proxy; the caller disposes it. */
export async function isolatedTargets(directory,{databases,buckets}){
 const config=join(directory,'isolated.json'),at=i=>String(i+3).repeat(8)+'-0000-4000-8000-000000000000';
 await writeFile(config,JSON.stringify({name:'whumpo-recovery-drill-isolated',compatibility_date:'2026-09-29',
  d1_databases:databases.map((n,i)=>({binding:'DRILL_'+n,database_name:'drill-'+n.toLowerCase(),database_id:at(i)})),
  r2_buckets:buckets.map(n=>({binding:'OBJECTS_'+n,bucket_name:'drill-objects-'+n.toLowerCase()}))}));
 const {getPlatformProxy}=await import('wrangler');
 return getPlatformProxy({configPath:config,persist:{path:join(directory,'isolated-state')},remoteBindings:false});
}

/** One GitHub and one Cloudflare token plus one PKCE flow each, sealed under the
 * supplied keyring through the actual vault primitive. Returns the stable ids. */
export async function seedCredentials(db,keyring,owner,canary){
 const ids={};
 for(const provider of ['github','cloudflare'])for(const purpose of ['token','pkce']){
  const record=crypto.randomUUID(),cipher=await fixtureCiphertext(keyring,`whumpo:${provider}:${purpose}:${owner.account}:${record}`,canary);
  if(purpose==='pkce')await db.prepare(`INSERT INTO ${provider}_oauth_states(user_id,state_hash,authority_id,verifier_ciphertext,expires_at) VALUES(?,?,?,?,'2099-01-01')`).bind(owner.account,record,owner.authority,cipher).run();
  else if(provider==='github')await db.prepare("INSERT INTO github_token_vault VALUES(?,?,?,'2099-01-01','revoking')").bind(record,owner.account,cipher).run();
  else await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,'2099-01-01','2026-10-08','revoking')").bind(record,owner.account,cipher).run();
  ids[provider+':'+purpose]=record;
 }
 return ids;
}

/** Envelope-valid baseline JPEG (marker structure accepted by the actual upload
 * gate). It is not a decodable image: the gate does not decode pixels either. */
export function syntheticJPEG(seed=0){
 const entropy=Array.from({length:16},(_,i)=>(seed*31+i*7)%250);
 return Uint8Array.from([255,216, 255,219,0,67,0,...Array(64).fill(1), 255,192,0,11,8,0,8,0,8,1,1,0x11,0,
  255,196,0,20,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, 255,218,0,8,1,1,0,0,63,0, ...entropy, 255,217]);
}
