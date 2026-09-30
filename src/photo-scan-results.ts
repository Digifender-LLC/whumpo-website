import {contentPolicyVersion} from './content-policy';
import {hashToken,newSessionToken} from './security';
export class PhotoScanError extends Error{constructor(readonly status:number,message:string){super(message);}}
type Kind='profile'|'project';
type Verdict='clear'|'matched'|'inconclusive';
type Evidence={digest:string;policyVersion:string;csam:{verdict:Verdict;reference:string};sexual:{verdict:Verdict;reference:string}};
type Ticket={id:string;kind:Kind;subject_id:string;user_id:string;digest:string;policy_version:string;authority_hash:string;state:'reserved'|'completed'|'stale';result_hash:string|null;outcome:'approved'|'blocked'|'held'|null;expires_at:string};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function evidence(value:unknown):Evidence{
 if(!exact(value,['digest','policyVersion','csam','sexual'])||typeof value.digest!=='string'||!/^[a-f0-9]{64}$/.test(value.digest)||value.policyVersion!==contentPolicyVersion)throw new PhotoScanError(400,'Invalid scan evidence');
 for(const key of ['csam','sexual']){const check=value[key];if(!exact(check,['verdict','reference'])||typeof check.verdict!=='string'||!['clear','matched','inconclusive'].includes(check.verdict)||typeof check.reference!=='string'||!/^[a-zA-Z0-9_.:-]{1,80}$/.test(check.reference))throw new PhotoScanError(400,'Invalid scan evidence');}
 return value as Evidence;
}
function current(t:Pick<Ticket,'kind'>){return t.kind==='profile'?"EXISTS(SELECT 1 FROM profile_photo_safety s JOIN user_profiles p ON p.user_id=s.user_id AND p.photo_digest=s.digest WHERE s.user_id=t.user_id AND t.subject_id=t.user_id AND s.digest=t.digest AND s.policy_version=t.policy_version AND s.state='pending')":"EXISTS(SELECT 1 FROM project_photo_safety s JOIN project_files f ON f.id=s.file_id AND f.digest=s.digest JOIN projects p ON p.id=f.project_id AND p.owner_user_id=s.user_id WHERE s.file_id=t.subject_id AND s.user_id=t.user_id AND s.digest=t.digest AND s.policy_version=t.policy_version AND s.state='pending')";}
/** Internal-only capability. Never put ticket authority in model context or customer responses. */
export async function reservePhotoScan(db:D1Database,kind:Kind,user:string,subject:string){
 if(!['profile','project'].includes(kind)||!uuid.test(user)||!uuid.test(subject))throw new PhotoScanError(400,'Invalid scan target');
 const source=kind==='profile'?await db.prepare("SELECT s.digest FROM profile_photo_safety s JOIN user_profiles p ON p.user_id=s.user_id AND p.photo_digest=s.digest WHERE s.user_id=? AND s.user_id=? AND s.policy_version=? AND s.state='pending'").bind(user,subject,contentPolicyVersion).first<{digest:string}>():await db.prepare("SELECT s.digest FROM project_photo_safety s JOIN project_files f ON f.id=s.file_id AND f.digest=s.digest JOIN projects p ON p.id=f.project_id AND p.owner_user_id=s.user_id WHERE s.user_id=? AND s.file_id=? AND s.policy_version=? AND s.state='pending'").bind(user,subject,contentPolicyVersion).first<{digest:string}>();
 if(!source)throw new PhotoScanError(404,'Pending scan target not found');
 const id=crypto.randomUUID(),authority=newSessionToken(),authorityHash=await hashToken(authority),expiresAt=new Date(Date.now()+15*60000).toISOString();
 try{await db.prepare('INSERT INTO photo_scan_tickets(id,kind,subject_id,user_id,digest,policy_version,authority_hash,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,kind,subject,user,source.digest,contentPolicyVersion,authorityHash,expiresAt).run();}
 catch{const saved=await db.prepare('SELECT id FROM photo_scan_tickets WHERE id=? AND authority_hash=?').bind(id,authorityHash).first();if(!saved)throw new PhotoScanError(409,'Scan is already reserved, changed, or unavailable');}
 return {id,authority,digest:source.digest,policyVersion:contentPolicyVersion,expiresAt};
}
/** Evidence must come from vetted scanner adapters; this is not a provider API parser or a detector. */
export async function recordPhotoScan(db:D1Database,id:string,authority:string,raw:unknown){
 if(!uuid.test(id)||typeof authority!=='string'||!/^[a-f0-9]{64}$/.test(authority))throw new PhotoScanError(403,'Scan authority unavailable');
 const tokenHash=await hashToken(authority),read=()=>db.prepare('SELECT * FROM photo_scan_tickets WHERE id=? AND authority_hash=?').bind(id,tokenHash).first<Ticket>();
 const ticket=await read();if(!ticket)throw new PhotoScanError(403,'Scan authority unavailable');
 const value=evidence(raw);if(value.digest!==ticket.digest||value.policyVersion!==ticket.policy_version)throw new PhotoScanError(409,'Scan evidence does not match the reserved content');
 const canonical={digest:value.digest,policyVersion:value.policyVersion,csam:{verdict:value.csam.verdict,reference:value.csam.reference},sexual:{verdict:value.sexual.verdict,reference:value.sexual.reference}};
 const resultHash=await hashToken(JSON.stringify(canonical));
 const outcome=value.csam.verdict==='matched'||value.sexual.verdict==='matched'?'blocked':value.csam.verdict==='clear'&&value.sexual.verdict==='clear'?'approved':'held';
 const replay=(row:Ticket)=>{if(row.result_hash!==resultHash)throw new PhotoScanError(409,'A different scan result was already recorded');return {state:row.state,outcome:row.state==='stale'?'held':row.outcome,applied:row.state==='completed'&&row.outcome!=='held',replayed:true};};
 if(ticket.state!=='reserved')return replay(ticket);
 // The only expiry authority is server time; provider data cannot extend it.
 const expiry=new Date(Date.now()+24*3600000).toISOString(),target=ticket.kind==='profile'?'profile_photo_safety':'project_photo_safety',key=ticket.kind==='profile'?'user_id':'file_id';
 const statements=[db.prepare(`UPDATE photo_scan_tickets AS t SET state=CASE WHEN julianday(t.expires_at)>julianday('now') AND ${current(ticket)} THEN 'completed' ELSE 'stale' END,result_hash=?,outcome=?,completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND authority_hash=? AND state='reserved'`).bind(resultHash,outcome,id,tokenHash)];
 if(outcome!=='held')statements.push(db.prepare(`UPDATE ${target} SET state=?,csam_check=?,sexual_check=?,scanner_reference=?,expires_at=? WHERE ${key}=? AND user_id=? AND digest=? AND policy_version=? AND state='pending' AND EXISTS(SELECT 1 FROM photo_scan_tickets WHERE id=? AND authority_hash=? AND state='completed' AND result_hash=? AND outcome=?)`).bind(outcome,value.csam.verdict==='inconclusive'?'unknown':value.csam.verdict,value.sexual.verdict==='inconclusive'?'unknown':value.sexual.verdict,id,expiry,ticket.subject_id,ticket.user_id,ticket.digest,ticket.policy_version,id,tokenHash,resultHash,outcome));
 try{await db.batch(statements);}catch{const saved=await read();if(saved&&saved.state!=='reserved')return replay(saved);throw new PhotoScanError(503,'Scan result could not be confirmed; content stays held');}
 const saved=await read();if(!saved||saved.state==='reserved')throw new PhotoScanError(503,'Scan result could not be confirmed; content stays held');
 if(saved.result_hash!==resultHash)throw new PhotoScanError(409,'A different scan result was already recorded');return {state:saved.state,outcome:saved.state==='stale'?'held':saved.outcome,applied:saved.state==='completed'&&saved.outcome!=='held',replayed:false};
}
