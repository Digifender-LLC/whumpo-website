/** Synthetic authority rows for domain tests. HTTP journeys use signed WebAuthn. */
export async function workspaceFixture(db,m,account=crypto.randomUUID(),proofOffset=-5){
 const id=()=>crypto.randomUUID(),credential=id();
 await db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(account,account+'@example.invalid').run();
 await db.prepare("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)").bind(account,'a'.repeat(64),id()).run();
 await db.prepare("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)").bind(credential,account,new Uint8Array([1,2,3])).run();
 return workspaceSession(db,m,{account,credential},proofOffset);
}
/** A new session records its real fixture proof time; existing proofs are never edited. */
export async function workspaceSession(db,m,{account,credential},proofOffset=-5){
 const token=m.newSessionToken(),authority=crypto.randomUUID();
 const current=await db.prepare('SELECT auth_epoch,policy_version FROM identity_accounts WHERE account_id=?').bind(account).first();
 if(!current)throw Error('Create the current identity fixture before issuing a session');
 await db.prepare("INSERT INTO identity_sessions VALUES(?,?,?,?,?,'web',?,'passkey',unixepoch()+?,unixepoch(),unixepoch()+3600)").bind(authority,await m.hashToken(token),account,current.policy_version,current.auth_epoch,credential,proofOffset).run();
 const scope=async(database=db)=>m.admitWorkspace(database,await m.resolveIdentity(database,{version:1,client:'web',kind:'session',token}));
 return {account,credential,token,authority,scope,revoke:()=>db.prepare('DELETE FROM identity_sessions WHERE id=?').bind(authority).run()};
}
/** Pause immediately before actual transaction admission, including local D1. */
export function interceptDatabase(db,pattern,hook,after){
 const originals=new WeakMap();
 function prepare(query){
  function wrap(original){
   const invoke=async(method,args)=>{const matched=pattern.test(query);if(matched)await hook();const result=await original[method](...args);if(matched)await after?.();return result;};
   const wrapped={bind:(...v)=>wrap(original.bind(...v)),first:(...v)=>invoke('first',v),all:(...v)=>invoke('all',v),run:(...v)=>invoke('run',v)};
   originals.set(wrapped,{original,query});return wrapped;
  }
  return wrap(db.prepare(query));
 }
 return {prepare,batch:async statements=>{const rows=statements.map(s=>originals.get(s)),matched=rows.some(r=>pattern.test(r.query));if(matched)await hook();const result=await db.batch(rows.map(r=>r.original));if(matched)await after?.();return result;}};
}
/** WH-207: the completed-welcome state, written through the schema's own review-then-complete guard. */
export async function completeWelcome(db,account){
 await db.prepare("INSERT INTO user_profiles(user_id,name) VALUES(?,'Synthetic owner') ON CONFLICT(user_id) DO UPDATE SET name='Synthetic owner'").bind(account).run();
 await db.prepare("INSERT INTO welcome_onboarding(user_id,project_id,stage,prompt,project_name,idea,revision) VALUES(?,?,'review','review','Synthetic welcome','A synthetic project',0)").bind(account,crypto.randomUUID()).run();
 await db.prepare("UPDATE welcome_onboarding SET revision=1,stage='complete',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=?").bind(account).run();
}
