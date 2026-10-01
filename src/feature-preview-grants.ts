import {featureRequest,featureTime,requireFeatureScope,FeatureInclusionError,type FeatureRequest,type FeatureScope} from './feature-inclusion';

// Operator-only functions. Never register these with public HTTP, Chat, models or customer jobs.
type Database=Pick<D1Database,'prepare'>;
type GrantInput=FeatureRequest&{id:string;purpose:'private-test-acceptance';reviewReference:string;startsAt:number;endsAt:number};
type Row={id:string;contract_version:1;user_id:string;project_id:string|null;feature_id:FeatureRequest['featureId'];operation:FeatureRequest['operation'];purpose:'private-test-acceptance';review_reference:string;starts_at:number;ends_at:number;created_at:number;revoked_at:number|null};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export function previewGrantInput(value:unknown):GrantInput {
 const v=value as GrantInput;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==9||Object.keys(v).some(k=>!['id','userId','projectId','featureId','operation','purpose','reviewReference','startsAt','endsAt'].includes(k)))throw new FeatureInclusionError(400,'Invalid preview grant fields.');
 const request=featureRequest({userId:v.userId,projectId:v.projectId,featureId:v.featureId,operation:v.operation});
 if(typeof v.id!=='string'||!uuid.test(v.id)||v.purpose!=='private-test-acceptance'||typeof v.reviewReference!=='string'||!v.reviewReference.trim()||v.reviewReference.length>200||/[\x00-\x1f\x7f]/.test(v.reviewReference)
  ||!Number.isSafeInteger(v.startsAt)||v.startsAt<0||!Number.isSafeInteger(v.endsAt)||v.endsAt<=v.startsAt||v.endsAt-v.startsAt>604800)throw new FeatureInclusionError(400,'Use an exact preview scope, review reference and interval of at most seven days.');
 return {id:v.id,...request,purpose:v.purpose,reviewReference:v.reviewReference,startsAt:v.startsAt,endsAt:v.endsAt};
}
function exact(row:Row,input:GrantInput){return row.contract_version===1&&row.user_id===input.userId&&row.project_id===input.projectId&&row.feature_id===input.featureId&&row.operation===input.operation&&row.purpose===input.purpose&&row.review_reference===input.reviewReference&&row.starts_at===input.startsAt&&row.ends_at===input.endsAt;}
function describe(row:Row,at:number){return {id:row.id,version:row.contract_version,scope:{userId:row.user_id,projectId:row.project_id,featureId:row.feature_id,operation:row.operation},purpose:row.purpose,reviewReference:row.review_reference,startsAt:row.starts_at,endsAt:row.ends_at,createdAt:row.created_at,revokedAt:row.revoked_at,state:row.revoked_at!==null?'revoked':row.ends_at<=at?'expired':row.starts_at>at?'scheduled':'active'};}
function environment(value:unknown){if(value!=='test'&&value!=='local')throw new FeatureInclusionError(403,'Private preview grants require an explicit test or local operator environment.');}

export async function issueFeaturePreviewGrant(db:Database,input:GrantInput,operatorEnvironment:'test'|'local',date=new Date()){
 environment(operatorEnvironment);const grant=previewGrantInput(input),at=featureTime(date);
 await requireFeatureScope(db,grant);
 const read=()=>db.prepare('SELECT * FROM feature_preview_grants WHERE id=?').bind(grant.id).first<Row>();
 let row=await read();
 if(!row){
  if(grant.endsAt<=at||grant.startsAt>at+604800)throw new FeatureInclusionError(400,'A new grant must have remaining time and start within seven days.');
  try{await db.prepare(`INSERT INTO feature_preview_grants(id,contract_version,user_id,project_id,feature_id,operation,purpose,review_reference,starts_at,ends_at,created_at)
   VALUES(?,1,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(grant.id,grant.userId,grant.projectId,grant.featureId,grant.operation,grant.purpose,grant.reviewReference,grant.startsAt,grant.endsAt,at).run();}
  catch(error){row=await read();if(!row)throw error;}
  row??=await read();
 }
 if(!row)throw new FeatureInclusionError(503,'Preview grant outcome is unresolved. Read or retry the same exact grant.');
 if(!exact(row,grant))throw new FeatureInclusionError(409,'Preview grant ID already names another scope or interval.');
 return describe(row,at);
}
export async function readFeaturePreviewGrant(db:Database,scope:FeatureScope,id:string,date=new Date()){
 const at=featureTime(date);
 if(typeof id!=='string'||!uuid.test(id))throw new FeatureInclusionError(400,'Choose a valid preview grant ID.');
 // Validate scope through the same closed request boundary, with fixed non-authorizing fields.
 const request=featureRequest({...scope,featureId:'core.editing',operation:'read'});
 await requireFeatureScope(db,request);
 const row=await db.prepare('SELECT * FROM feature_preview_grants WHERE id=? AND user_id=? AND project_id IS ?').bind(id,request.userId,request.projectId).first<Row>();
 if(!row)throw new FeatureInclusionError(404,'Preview grant is unavailable.');
 return describe(row,at);
}
export async function revokeFeaturePreviewGrant(db:Database,scope:FeatureScope,id:string,operatorEnvironment:'test'|'local',date=new Date()){
 environment(operatorEnvironment);const request=featureRequest({...scope,featureId:'core.editing',operation:'read'}),at=featureTime(date);
 const before=await readFeaturePreviewGrant(db,request,id,new Date(at*1000));
 if(before.revokedAt===null){
  try{await db.prepare('UPDATE feature_preview_grants SET revoked_at=? WHERE id=? AND user_id=? AND project_id IS ? AND revoked_at IS NULL').bind(at,id,request.userId,request.projectId).run();}
  catch(error){const observed=await readFeaturePreviewGrant(db,request,id,new Date(at*1000));if(observed.revokedAt===null)throw error;}
 }
 return readFeaturePreviewGrant(db,request,id,new Date(at*1000));
}
