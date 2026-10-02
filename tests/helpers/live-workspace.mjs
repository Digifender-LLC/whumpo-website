// Opt-in probe support only. Synthetic completed accounts do not prove enrollment,
// device support, kit delivery, invitation checks or human Turnstile acceptance.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {currentSchemaArtifact,inspectSchema} from '../../tools/current-schema.mjs';
import {authenticator} from './webauthn-authenticator.mjs';
const prefix='/api/auth/identity/',version=prefix+'v1/',session='__Host-whumpo_session';
export async function requireCurrentProbeSchema(db){
 const expected=(await currentSchemaArtifact()).expected,observed=await inspectSchema(db);
 assert.deepEqual(observed,expected,'Probe requires the exact current schema; complete the coordinated test cutover first');
}
export function liveWorkspaceBrowser(base='https://whumpo.com',transport=fetch){
 assert.equal(base,'https://whumpo.com');const cookies=new Map();
 async function call(path,method='GET',data){
  const url=new URL(path,base);assert.equal(url.origin,base);assert.equal(url.pathname+url.search,path);
  const selected=[...cookies].filter(([name])=>name===session||url.pathname.startsWith(prefix));
  const response=await transport(url.href,{method,headers:{origin:base,'content-type':'application/json',cookie:selected.map(([k,v])=>k+'='+v).join('; ')},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(90000),redirect:'error'});
  for(const cookie of response.headers.getSetCookie()){
   const pair=cookie.split(';')[0],at=pair.indexOf('='),name=pair.slice(0,at),value=pair.slice(at+1);
   assert.ok([session,'__Secure-whumpo_identity_grant','__Secure-whumpo_identity_challenge'].includes(name),'Unexpected identity cookie');
   assert.ok(cookie.includes('; Secure; HttpOnly; SameSite='));assert.ok(!cookie.includes('Domain='));
   assert.ok(cookie.includes('Path='+(name===session?'/;':prefix+';')));
   assert.ok(cookie.includes('SameSite='+(name===session?'Lax':'Strict')+';'));
   if(value)cookies.set(name,value);else cookies.delete(name);
  }
  if(url.pathname.startsWith(version))assert.equal(response.headers.get('cache-control'),'no-store');
  return response;
 }
 async function json(path,method='GET',data){const response=await call(path,method,data);assert.equal(response.status,200,'Unexpected status for '+method+' '+path);return response.json();}
 async function login(key,account,counter=1){
  const options=await json(version+'login/options','POST',{version:1});assert.equal(options.options.rpId,'whumpo.com');
  const verified=await json(version+'login/verify','POST',{version:1,credential:key.assertion(options.options,counter,{handle:Buffer.from(account).toString('base64url')})});
  assert.equal(verified.purpose,'workspace');assert.ok(cookies.has(session));assert.equal(cookies.size,1);
  const state=await json(version+'state','POST',{version:1});assert.equal(state.identity.accountId,account);assert.equal(state.identity.purpose,'workspace');
 }
 async function logout(){await json(version+'logout','POST',{version:1});assert.equal(cookies.size,0);assert.equal((await call('/api/me')).status,401);}
 return {call,json,login,logout};
}
export async function seedCurrentProbeIdentity(db,id,email){
 await requireCurrentProbeSchema(db); // Before the first write, including when called independently.
 assert.match(id,/^[a-f0-9-]{36}$/);assert.match(email,/^[a-z-]+-fixture-[a-f0-9-]{36}@example\.test$/);assert.ok(email.endsWith('-fixture-'+id+'@example.test'));
 const keys=[authenticator(),authenticator()];
 await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(id,email).run();
 await db.prepare("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,credential_revision,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,2,1,?,?)").bind(id,randomBytes(32).toString('hex'),crypto.randomUUID()).run();
 for(const [index,key] of keys.entries()){
  // The public-key blob is generated locally. D1 HTTP parameter arrays cannot bind a typed byte array.
  const hex=Buffer.from(key.publicKey).toString('hex');assert.match(hex,/^[a-f0-9]+$/);
  await db.prepare(`INSERT INTO identity_credentials(id,account_id,public_key,counter,name,status,created_at) VALUES(?,?,X'${hex}',0,?,'active',unixepoch())`).bind(key.id,id,'Synthetic probe key '+(index+1)).run();
 }
 return keys;
}
