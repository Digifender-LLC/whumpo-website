/** WH-016 public abuse-report intake for published Whumpo sites and applications.
 *
 * Anyone can report a published site or application without an account. The report is bound server-side to the project
 * and owner currently serving that address and stored in the restricted `abuse_reports` queue, which only the WH-132
 * authenticated case-role surface reads and triages (src/safety-cases.ts). The site owner, Chat, the maintainer agent and
 * every model path never read it. No reporter IP or upload is stored. The reporter may optionally give an email address
 * for follow-up (owner decision October 4, 2026): it is validated and bounded here, stored in the same restricted row,
 * readable only by a case reviewer, never logged and never emailed by this code. The reporter receives only a receipt
 * identifier. A report is never a finding or a violation by anyone: triage is a separate human decision.
 * Callers must already have checked Origin, the bounded body, the connection rate limit and Turnstile. */
import {customerProject,visitorProject} from './hosts';
import {hashToken} from './security';

export class AbuseReportError extends Error {constructor(public status:number,message:string){super(message);}}
export const abuseReportCategories=Object.freeze({
 child_safety:'Child sexual exploitation or abuse',
 sexual_content:'Sexual content',
 copyright:'Copyright infringement or piracy',
 fraud_phishing:'Fraud, scam, phishing or impersonation',
 hate_harassment:'Hate, harassment, threats or doxxing',
 gambling:'Gambling, betting or wagering',
 malware_security:'Malware or attacks on systems',
 spam_abuse:'Spam or abusive automated traffic',
 other:'Something else that breaks the Acceptable Use Policy',
} as const);
export type AbuseReportCategory=keyof typeof abuseReportCategories;
export type AbuseReportTarget={projectId:string;ownerId:string;surface:'site'|'app';hostKind:'platform'|'custom';path:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const maxReportDetails=1000;
export const maxReporterEmail=254;
// A deliberately plain address shape: one @, a bounded local part of common characters and a dotted DNS name.
const emailShape=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
/** The optional reporter email: blank means none. The domain is lower-cased; nothing is sent to it. */
export function reporterEmailInput(value:unknown):string|null{
 if(value==null)return null;
 if(typeof value!=='string')throw new AbuseReportError(400,'Enter a valid email address, or leave it blank.');
 const text=value.trim();if(!text)return null;
 if(text.length<6||text.length>maxReporterEmail||!emailShape.test(text))throw new AbuseReportError(400,'Enter a valid email address, or leave it blank.');
 const at=text.lastIndexOf('@');return text.slice(0,at)+'@'+text.slice(at+1).toLowerCase();
}

/** Resolves a reporter-supplied address to the project currently publishing it. Only the path is kept (no query or
 * fragment), and only a currently published site or enabled application of a known owner is reportable here. */
export async function resolveAbuseReportTarget(db:D1Database,address:unknown):Promise<AbuseReportTarget>{
 const refuse=()=>{throw new AbuseReportError(404,'We could not find a published Whumpo site or app at that address. Check the address, or email legal@digifender.com.');};
 if(typeof address!=='string'||!address.trim()||address.length>2048||control.test(address))throw new AbuseReportError(400,'Enter the address of the site or app you are reporting.');
 let url:URL;
 try{const raw=address.trim();url=new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw);}catch{throw new AbuseReportError(400,'Enter the address of the site or app you are reporting.');}
 if(url.protocol!=='https:'&&url.protocol!=='http:')throw new AbuseReportError(400,'Enter the address of the site or app you are reporting.');
 const host=url.hostname.toLowerCase(),path=url.pathname.slice(0,512)||'/';
 let projectId=customerProject(host),surface:'site'|'app'='site',hostKind:'platform'|'custom'='platform';
 if(!projectId){projectId=visitorProject(host);if(projectId)surface='app';}
 if(!projectId){
  const mapping=await db.prepare("SELECT c.project_id FROM domain_connections c JOIN projects p ON p.id=c.project_id AND p.owner_user_id=c.user_id WHERE c.hostname=? AND c.state='active' AND c.serve_until>? AND c.provider_id IS NOT NULL").bind(host,new Date().toISOString()).first<{project_id:string}>();
  if(!mapping)return refuse();
  projectId=mapping.project_id;hostKind='custom';
 }
 const live=surface==='site'
  ?await db.prepare('SELECT p.owner_user_id AS owner FROM projects p JOIN publications s ON s.project_id=p.id WHERE p.id=? AND s.version_id IS NOT NULL').bind(projectId).first<{owner:string}>()
  :await db.prepare('SELECT p.owner_user_id AS owner FROM projects p JOIN app_spaces a ON a.project_id=p.id AND a.enabled=1 WHERE p.id=?').bind(projectId).first<{owner:string}>();
 if(!live)return refuse();
 return {projectId,ownerId:live.owner,surface,hostKind,path};
}

export function abuseReportInput(data:{id:unknown;category:unknown;details:unknown;email?:unknown}){
 const {id,category,details}=data;
 if(typeof id!=='string'||!uuid.test(id))throw new AbuseReportError(400,'Reload the report form.');
 if(typeof category!=='string'||!Object.hasOwn(abuseReportCategories,category))throw new AbuseReportError(400,'Choose what kind of problem you are reporting.');
 const text=typeof details==='string'?details.trim():details==null?'':null;
 if(text===null||text.length>maxReportDetails||control.test(text.replace(/[\r\n\t]/g,' ')))throw new AbuseReportError(400,`Describe the problem in up to ${maxReportDetails.toLocaleString('en-US')} characters, without attachments.`);
 return {id,category:category as AbuseReportCategory,details:text||null,email:reporterEmailInput(data.email)};
}

/** Stores one report atomically under the schema's target, capacity and rate guards. An exact retry with the same receipt
 * returns the same receipt; a different report reusing a receipt is refused. Returns the receipt identifier only. The
 * email is compared directly rather than hashed, so no digest of it outlives an erasure. */
export async function saveAbuseReport(db:D1Database,target:AbuseReportTarget,input:ReturnType<typeof abuseReportInput>){
 const hash=await hashToken(JSON.stringify([target.projectId,target.surface,target.path,input.category,input.details]));
 const same=async()=>{
  const saved=await db.prepare('SELECT request_hash,reporter_email FROM abuse_reports WHERE id=?').bind(input.id).first<{request_hash:string;reporter_email:string|null}>();
  if(!saved)return false;
  if(saved.request_hash!==hash||saved.reporter_email!==input.email)throw new AbuseReportError(409,'This report form was already used. Open a fresh form to send another report.');
  return true;
 };
 if(await same())return {receipt:input.id};
 try{
  await db.prepare('INSERT INTO abuse_reports(id,project_id,subject_user_id,surface,host_kind,path,category,details,reporter_email,request_hash,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,unixepoch())')
   .bind(input.id,target.projectId,target.ownerId,target.surface,target.hostKind,target.path,input.category,input.details,input.email,hash).run();
 }catch(cause){
  const text=String(cause);
  // A concurrent identical retry or a lost acknowledgement recovers the committed receipt.
  if(/UNIQUE|PRIMARY KEY/.test(text)&&await same())return {receipt:input.id};
  if(/abuse_report_(capacity|rate)/.test(text))throw new AbuseReportError(429,'Reporting is temporarily at capacity. Please try again later, or email legal@digifender.com.');
  if(text.includes('abuse_report_target'))throw new AbuseReportError(404,'That site or app is no longer published. If you still need to report it, email legal@digifender.com.');
  throw cause;
 }
 if(!await same())throw new AbuseReportError(503,'Your report could not be confirmed. Please try again.');
 return {receipt:input.id};
}
