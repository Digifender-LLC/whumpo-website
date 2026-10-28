import {BackendError} from './backend-versions';
import {hashToken} from './security';
import {requireReviewedReply} from './chat-review-receipts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Nomination={id:string;version_id:string;digest:string;state:'review'|'nominated'|'withdrawn';expires_at:string;consent_at:string|null;withdrawn_at:string|null};
export async function readNomination(db:D1Database,user:string,id:string){
 const row=await db.prepare('SELECT n.id,n.version_id,n.digest,n.state,n.expires_at,n.consent_at,n.withdrawn_at FROM backend_nominations n JOIN backend_versions v ON v.id=n.version_id JOIN projects p ON p.id=v.project_id WHERE n.id=? AND n.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<Nomination>();
 if(!row)throw new BackendError(404,'Nomination not found');return row;
}
export async function prepareNomination(db:D1Database,user:string,id:string,version:string){
 if(!uuid.test(id)||!uuid.test(version))throw new BackendError(400,'Choose a saved backend version');
 const prior=await db.prepare('SELECT user_id,version_id FROM backend_nominations WHERE id=?').bind(id).first<{user_id:string;version_id:string}>();if(prior){if(prior.user_id!==user||prior.version_id!==version)throw new BackendError(409,'Nomination ID already used');return readNomination(db,user,id);}
 const source=await db.prepare('SELECT v.source,v.digest FROM backend_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?').bind(version,user).first<{source:string;digest:string}>();if(!source)throw new BackendError(404,'Backend version not found');if(await hashToken(source.source)!==source.digest)throw new BackendError(409,'Saved source integrity check failed');
 const now=new Date();try{await db.prepare('INSERT INTO backend_nominations(id,user_id,version_id,digest,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id,user,version,source.digest,now.toISOString(),new Date(now.getTime()+600000).toISOString()).run();}catch{
  const saved=await db.prepare('SELECT user_id,version_id FROM backend_nominations WHERE id=?').bind(id).first<{user_id:string;version_id:string}>();if(saved?.user_id!==user||saved.version_id!==version)throw new BackendError(409,"An open nomination already exists or the nomination allowance is full. Ask an operator to inspect your saved nomination records.");
 }
 return readNomination(db,user,id);
}
export async function consentNomination(db:D1Database,user:string,id:string,confirmation:string){
 if(confirmation!=='NOMINATE')throw new BackendError(400,'Read the nomination review, then type NOMINATE exactly');
 const row=await readNomination(db,user,id);if(row.state==='nominated')return row;if(row.state!=='review'||row.expires_at<=new Date().toISOString())throw new BackendError(409,'This nomination review is no longer available');
 try{await db.prepare("UPDATE backend_nominations SET state='nominated',consent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND state='review' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(id,user).run();}catch{const saved=await readNomination(db,user,id);if(saved.state==='nominated')return saved;throw new BackendError(409,'Nomination changed; inspect it before continuing');}
 const saved=await readNomination(db,user,id);if(saved.state!=='nominated')throw new BackendError(409,'Nomination changed; inspect it before continuing');return saved;
}
export async function withdrawNomination(db:D1Database,user:string,id:string){
 const row=await readNomination(db,user,id);if(row.state==='withdrawn')return row;
 try{await db.prepare("UPDATE backend_nominations SET state='withdrawn',withdrawn_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND state IN ('review','nominated')").bind(id,user).run();}catch{const saved=await readNomination(db,user,id);if(saved.state==='withdrawn')return saved;throw new BackendError(409,'Withdrawal was not confirmed; inspect the same nomination');}
 const saved=await readNomination(db,user,id);if(saved.state!=='withdrawn')throw new BackendError(409,'Withdrawal was not confirmed; inspect the same nomination');return saved;
}
function describe(row:Nomination){
 const head=`Private reuse nomination: ${row.state==='review'&&row.expires_at<=new Date().toISOString()?'expired':row.state}\nNomination: ${row.id}\nVersion: ${row.version_id}\nSHA-256: ${row.digest}`;
 if(row.state==='withdrawn')return head+'\nWithdrawn. This record cannot authorize reuse. Your source version is unchanged.';
 if(row.state==='nominated')return head+'\nYour permission for maintainer review is recorded. Nothing has been shared with other customers, executed or published. Screening and promotion are not yet available.\nAsk an operator to withdraw consent for nomination '+row.id;
 if(row.expires_at<=new Date().toISOString())return head+"\nThis consent review expired. An operator can prepare a fresh review for version "+row.version_id;
 return head+"\nAsk to inspect the exact source for version "+row.version_id+'. Nomination gives Whumpo maintainers permission to review this version for possible generic reuse. Do not nominate code containing secrets, customer data, proprietary material you cannot share or incompatible third-party licensing. This is not a license grant for publication. A separate synthetic candidate, privacy/license screening, tests and maintainer approval are still required before sharing. No source is copied to a catalog or model.\nReview expires: '+row.expires_at+'\nOperator consent review: '+row.id+'\nAsk an operator to cancel nomination '+row.id;
}
/** Internal nomination adapter. Not exposed as a Chat control or model action. */
export function backendNominationCommand(db:D1Database,user:string,turn:string,content:string){
 const [rawVerb,id,confirmation,...extra]=content.trim().split(/\s+/),verb=rawVerb.toLowerCase();if(!['/nominate-backend','/backend-nomination','/backend-nominations','/confirm-backend-nomination','/withdraw-backend-nomination'].includes(verb))return;
 return async()=>{try{
  if(verb==='/backend-nominations'&&!id){const {results}=await db.prepare('SELECT n.id,n.version_id,n.digest,n.state,n.expires_at,n.consent_at,n.withdrawn_at FROM backend_nominations n JOIN backend_versions v ON v.id=n.version_id JOIN projects p ON p.id=v.project_id WHERE n.user_id=? AND p.owner_user_id=? ORDER BY n.created_at DESC,n.id DESC LIMIT 20').bind(user,user).all<Nomination>();return results.length?results.map(describe).join('\n\n'):"No reuse nominations. Nomination consent is operator-managed until a dedicated review control is available.";}
  if(verb==='/backend-nominations'||!id||!uuid.test(id)||extra.length||(verb==='/confirm-backend-nomination'?confirmation!=='NOMINATE':confirmation!==undefined))throw new BackendError(400,"Choose an exact saved nomination or version. Nomination consent and withdrawal are operator-managed.");
  if(verb==='/nominate-backend')return describe(await prepareNomination(db,user,turn,id));
  if(verb==='/confirm-backend-nomination'){await requireReviewedReply(db,user,'backendNomination',id);return describe(await consentNomination(db,user,id,confirmation!));}
  if(verb==='/withdraw-backend-nomination')return describe(await withdrawNomination(db,user,id));
  return describe(await readNomination(db,user,id));
 }catch(error){return error instanceof BackendError?error.message:'Nomination outcome is unavailable. Inspect the same record before retrying.';}};
}
