/** Synthetic authority rows for domain tests. HTTP journeys use signed WebAuthn. */
export async function workspaceFixture(db,m,account=crypto.randomUUID(),proofOffset=-5){
 const id=()=>crypto.randomUUID(),credential=id(),token=m.newSessionToken(),authority=id();
 await db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(account,account+'@example.invalid').run();
 await db.prepare("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)").bind(account,'a'.repeat(64),id()).run();
 await db.prepare("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)").bind(credential,account,new Uint8Array([1,2,3])).run();
 await db.prepare("INSERT INTO identity_sessions VALUES(?,?,?,1,1,'web',?,'passkey',unixepoch()+?,unixepoch(),unixepoch()+3600)").bind(authority,await m.hashToken(token),account,credential,proofOffset).run();
 const scope=async(database=db)=>m.admitWorkspace(database,await m.resolveIdentity(database,{version:1,client:'web',kind:'session',token}));
 return {account,credential,token,authority,scope,revoke:()=>db.prepare('DELETE FROM identity_sessions WHERE id=?').bind(authority).run()};
}
/** Pause immediately before actual transaction admission, including local D1. */
export function interceptDatabase(db,pattern,hook){
 const originals=new WeakMap();
 function prepare(query){
  function wrap(original){const wrapped={bind:(...v)=>wrap(original.bind(...v)),first:async(...v)=>{if(pattern.test(query))await hook();return original.first(...v)},all:async(...v)=>{if(pattern.test(query))await hook();return original.all(...v)},run:async(...v)=>{if(pattern.test(query))await hook();return original.run(...v)}};originals.set(wrapped,{original,query});return wrapped;}
  return wrap(db.prepare(query));
 }
 return {prepare,batch:async statements=>{const rows=statements.map(s=>originals.get(s));if(rows.some(r=>pattern.test(r.query)))await hook();return db.batch(rows.map(r=>r.original));}};
}
