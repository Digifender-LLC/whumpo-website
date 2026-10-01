import {createHash} from 'node:crypto';
const closed=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k));
export function featurePreviewInput(text,service){
 if(typeof text!=='string'||Buffer.byteLength(text)>4096)throw Error('Invalid preview-grant input');
 const v=JSON.parse(text);
 if(v?.version!==1)throw Error('Unsupported preview-grant input version');
 if(v.command==='issue'&&closed(v,['version','command','grant']))return {version:1,command:'issue',grant:service.previewGrantInput(v.grant)};
 if(['read','revoke'].includes(v.command)&&closed(v,['version','command','scope','id'])&&closed(v.scope,['userId','projectId'])&&typeof v.id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v.id)){
  const r=service.featureRequest({...v.scope,featureId:'core.editing',operation:'read'});
  return {version:1,command:v.command,scope:{userId:r.userId,projectId:r.projectId},id:v.id};
 }
 throw Error('Invalid preview-grant command or fields');
}
/** The digest binds the exact input and operator destination. It is a review guard, not a credential. */
export async function runFeaturePreviewOperator(service,db,input,realm,applyDigest,date=new Date()){
 if(!closed(realm,['environment','accountId','databaseId'])||!['test','local'].includes(realm.environment)||! /^[0-9a-f]{32}$/.test(realm.accountId)||! /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(realm.databaseId))throw Error('A current test destination is required');
 const request=featurePreviewInput(JSON.stringify(input),service);
 const digest=createHash('sha256').update(JSON.stringify({realm,request})).digest('hex');
 if(applyDigest!==undefined&&(applyDigest!==digest||request.command==='read'))throw Error('Preview the exact destination and input before applying');
 if(request.command==='read')return {mode:'read',grant:await service.readFeaturePreviewGrant(db,request.scope,request.id,date)};
 const scope=request.command==='issue'?{userId:request.grant.userId,projectId:request.grant.projectId}:request.scope;
 await service.requireFeatureScope(db,scope);
 if(applyDigest===undefined)return {mode:'preview',digest,destination:realm,request,mutated:false,inclusionOnly:true};
 const grant=request.command==='issue'
  ?await service.issueFeaturePreviewGrant(db,request.grant,realm.environment,date)
  :await service.revokeFeaturePreviewGrant(db,scope,request.id,realm.environment,date);
 return {mode:'applied',grant,inclusionOnly:true};
}
