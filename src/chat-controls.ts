/** Explicit UI intents. These are never accepted as agent proposals or parsed from chat text.
 * Command strings below are private adapters for the existing receipt handlers. */
export const confirmationControls = {
 site:{verb:'confirm',label:'Confirm the reviewed website change'},
 application:{verb:'confirm-application',label:'Authorize the reviewed application change'},
 appPage:{verb:'confirm-app-page',label:'Confirm the reviewed visitor page change'},
 domainProof:{verb:'confirm-domain-proof-remove',label:'Remove the reviewed domain proof'},
 backup:{verb:'confirm-backup',label:'Authorize the reviewed GitHub backup'},
 cmsImport:{verb:'confirm-cms-import',label:'Import the reviewed private article'},
 cmsDiscard:{verb:'confirm-cms-discard',label:'Discard the reviewed article changes'},
 cmsUnpublish:{verb:'confirm-cms-unpublish',label:'Take the reviewed article offline'},
 cmsPublish:{verb:'confirm-cms-publish',label:'Publish the reviewed article'},
 cmsSetup:{verb:'confirm-cms',label:'Approve the reviewed publishing setup'},
 backendState:{verb:'confirm-backend-state',label:'Confirm the reviewed private data change'},
 backendPublication:{verb:'confirm-backend-publication',label:'Confirm the reviewed backend publication change'},
 backendForm:{verb:'confirm-backend-form',label:'Confirm the reviewed website form change'},
 directory:{verb:'confirm-directory',label:'Confirm the reviewed directory change'},
 contact:{verb:'confirm-contact',label:'Confirm the reviewed contact form change'},
 version:{verb:'confirm-version-delete',label:'Delete the reviewed saved version'},
 photo:{verb:'confirm-photo-delete',label:'Delete the reviewed photo'},
} as const;
export type ChatControl =
 | {type:'githubGrant';operation:'confirm';reviewId:string;confirmation:'REVOKE_APP_ACCESS'}
 | {type:'githubGrant';operation:'cancel';reviewId:string}
 | {type:'confirm';kind:keyof typeof confirmationControls;reviewId:string}
 | {type:'serviceClientApply';reviewId:string;proposalDigest:string;expectedRevision:number}
 | {type:'specificationApply';reviewId:string;proposalDigest:string;expectedRevision:number}
 | {type:'moduleActivationReview';projectId:string;instanceId:string;action:'activate'|'disable'}
 | {type:'moduleActivationApply';reviewId:string;reviewDigest:string;expectedRevision:number}
 | {type:'accessRoleReview';projectId:string;instanceId:string;visitorId:string;action:'grant'|'revoke'}
 | {type:'accessRoleApply';reviewId:string;reviewDigest:string;expectedRevision:number}
 | {type:'appRestore';projectId:string;reviewId:string;confirmation:'RESTORE'}
 | {type:'appMaintenance';kind:'upgrade'|'rollback'|'cancel';reviewId:string;confirmation:'UPGRADE'|'ROLLBACK'|'CANCEL'}
 | {type:'reviewDetail';kind:'backend'|'test';targetId:string}
 | {type:'shortcut';kind:'project'|'versions'|'health'|'checkWebsite'|'application';projectId:string}
 | {type:'domainProof';hostname:string;projectId:string}
 | {type:'checkDomainProof';claimId:string}
 | {type:'guestPreview';operation:'revoke';linkId:string}
 | {type:'guestPreview';operation:'delete';linkId:string;confirmation:'DELETE'}
 | {type:'unpublish';projectId?:string};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const exact=(a:Record<string,unknown>,keys:string[])=>Object.keys(a).every(k=>keys.includes(k));
export function chatControl(value:unknown):{action:ChatControl;command:string;label:string;recentAuth:boolean}|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const a=value as Record<string,unknown>;
 if(a.type==='githubGrant'&&id(a.reviewId)){
  if(a.operation==='confirm'&&a.confirmation==='REVOKE_APP_ACCESS'&&exact(a,['type','operation','reviewId','confirmation']))return {action:{type:'githubGrant',operation:'confirm',reviewId:a.reviewId,confirmation:'REVOKE_APP_ACCESS'},command:'/github-grant-confirm '+a.reviewId,label:'Revoke all access for the GitHub app and account in this review.',recentAuth:true};
  if(a.operation==='cancel'&&exact(a,['type','operation','reviewId']))return {action:{type:'githubGrant',operation:'cancel',reviewId:a.reviewId},command:'/github-grant-cancel '+a.reviewId,label:'Cancel this GitHub access removal review.',recentAuth:false};
 }
 if(a.type==='serviceClientApply'&&exact(a,['type','reviewId','proposalDigest','expectedRevision'])&&id(a.reviewId)&&typeof a.proposalDigest==='string'&&/^[0-9a-f]{64}$/.test(a.proposalDigest)&&Number.isSafeInteger(a.expectedRevision)&&Number(a.expectedRevision)>=0){
  const action={type:'serviceClientApply' as const,reviewId:a.reviewId,proposalDigest:a.proposalDigest,expectedRevision:Number(a.expectedRevision)};
  return {action,command:`/confirm-service-clients ${action.reviewId} ${action.proposalDigest} ${action.expectedRevision}`,label:'Save the exact reviewed private service settings.',recentAuth:true};
 }
 if(a.type==='specificationApply'&&exact(a,['type','reviewId','proposalDigest','expectedRevision'])&&id(a.reviewId)&&typeof a.proposalDigest==='string'&&/^[0-9a-f]{64}$/.test(a.proposalDigest)&&Number.isSafeInteger(a.expectedRevision)&&Number(a.expectedRevision)>=0){
  const action={type:'specificationApply' as const,reviewId:a.reviewId,proposalDigest:a.proposalDigest,expectedRevision:Number(a.expectedRevision)};
  return {action,command:`/confirm-specification ${action.reviewId} ${action.proposalDigest} ${action.expectedRevision}`,label:'Save the exact reviewed private website version.',recentAuth:true};
 }
 // WH-125: ids, local instance id and revision only; configuration and visitor values never enter a control.
 if(a.type==='moduleActivationReview'&&exact(a,['type','projectId','instanceId','action'])&&Object.keys(a).length===4&&id(a.projectId)&&typeof a.instanceId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(a.instanceId)&&(a.action==='activate'||a.action==='disable')){
  const action={type:'moduleActivationReview' as const,projectId:a.projectId,instanceId:a.instanceId,action:a.action as 'activate'|'disable'};
  return {action,command:`/review-module-activation ${action.projectId} ${action.instanceId} ${action.action}`,label:`Review ${action.action==='activate'?'activating':'disabling'} the “${action.instanceId}” module.`,recentAuth:false};
 }
 if(a.type==='moduleActivationApply'&&exact(a,['type','reviewId','reviewDigest','expectedRevision'])&&Object.keys(a).length===4&&id(a.reviewId)&&typeof a.reviewDigest==='string'&&/^[0-9a-f]{64}$/.test(a.reviewDigest)&&Number.isSafeInteger(a.expectedRevision)&&Number(a.expectedRevision)>=0){
  const action={type:'moduleActivationApply' as const,reviewId:a.reviewId,reviewDigest:a.reviewDigest,expectedRevision:Number(a.expectedRevision)};
  return {action,command:`/confirm-module-activation ${action.reviewId} ${action.reviewDigest} ${action.expectedRevision}`,label:'Apply the exact reviewed module activation change.',recentAuth:true};
 }
 // WH-126: ids, the access instance id, an opaque visitor id and the access revision only.
 if(a.type==='accessRoleReview'&&exact(a,['type','projectId','instanceId','visitorId','action'])&&Object.keys(a).length===5&&id(a.projectId)&&id(a.visitorId)&&typeof a.instanceId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(a.instanceId)&&(a.action==='grant'||a.action==='revoke')){
  const action={type:'accessRoleReview' as const,projectId:a.projectId,instanceId:a.instanceId,visitorId:a.visitorId,action:a.action as 'grant'|'revoke'};
  return {action,command:`/review-access-role ${action.projectId} ${action.instanceId} ${action.visitorId} ${action.action}`,label:`Review ${action.action==='grant'?'granting':'removing'} the staff role for visitor ${action.visitorId.slice(0,8)}.`,recentAuth:false};
 }
 if(a.type==='accessRoleApply'&&exact(a,['type','reviewId','reviewDigest','expectedRevision'])&&Object.keys(a).length===4&&id(a.reviewId)&&typeof a.reviewDigest==='string'&&/^[0-9a-f]{64}$/.test(a.reviewDigest)&&Number.isSafeInteger(a.expectedRevision)&&Number(a.expectedRevision)>=1){
  const action={type:'accessRoleApply' as const,reviewId:a.reviewId,reviewDigest:a.reviewDigest,expectedRevision:Number(a.expectedRevision)};
  return {action,command:`/confirm-access-role ${action.reviewId} ${action.reviewDigest} ${action.expectedRevision}`,label:'Apply the exact reviewed staff role change.',recentAuth:true};
 }
 if(a.type==='confirm'&&exact(a,['type','kind','reviewId'])&&typeof a.kind==='string'&&Object.hasOwn(confirmationControls,a.kind)&&id(a.reviewId)){
  const kind=a.kind as keyof typeof confirmationControls,c=confirmationControls[kind];
  return {action:{type:'confirm',kind,reviewId:a.reviewId},command:`/${c.verb} ${a.reviewId}`,label:c.label+'.',recentAuth:false};
 }
 if(a.type==='appRestore'&&exact(a,['type','projectId','reviewId','confirmation'])&&id(a.projectId)&&id(a.reviewId)&&a.confirmation==='RESTORE')return {action:{type:'appRestore',projectId:a.projectId,reviewId:a.reviewId,confirmation:'RESTORE'},command:`/confirm-app-restore ${a.projectId} ${a.reviewId} RESTORE`,label:'Restore the exact reviewed application data.',recentAuth:true};
 if(a.type==='appMaintenance'&&exact(a,['type','kind','reviewId','confirmation'])&&id(a.reviewId)&&['upgrade','rollback','cancel'].includes(String(a.kind))){
  const kind=a.kind as 'upgrade'|'rollback'|'cancel',word=kind==='upgrade'?'UPGRADE':kind==='rollback'?'ROLLBACK':'CANCEL';
  if(a.confirmation!==word)return;
  return {action:{type:'appMaintenance',kind,reviewId:a.reviewId,confirmation:word},command:`/${kind==='cancel'?'cancel-app-upgrade':kind==='upgrade'?'confirm-app-upgrade':'confirm-app-rollback'} ${a.reviewId} ${word}`,label:kind==='cancel'?'Discard this reviewed upgrade check.':kind==='upgrade'?'Apply the exact reviewed app upgrade.':'Apply the exact reviewed app rollback.',recentAuth:true};
 }
 if(a.type==='reviewDetail'&&exact(a,['type','kind','targetId'])&&id(a.targetId)&&['backend','test'].includes(String(a.kind))){
  const kind=a.kind as 'backend'|'test';return {action:{type:'reviewDetail',kind,targetId:a.targetId},command:`/${kind==='backend'?'backend':'backend-result'} ${a.targetId}`,label:kind==='backend'?'Read the saved program for this review.':'Read the saved test result for this review.',recentAuth:false};
 }
 const shortcuts={project:['project','Read project status'],versions:['versions','Read saved website versions'],health:['health','Read the saved website health report'],checkWebsite:['check-site','Check the published website'],application:['app-status','Read application status']} as const;
 if(a.type==='shortcut'&&exact(a,['type','kind','projectId'])&&typeof a.kind==='string'&&Object.hasOwn(shortcuts,a.kind)&&id(a.projectId)){
  const kind=a.kind as keyof typeof shortcuts;return {action:{type:'shortcut',kind,projectId:a.projectId},command:`/${shortcuts[kind][0]} ${a.projectId}`,label:shortcuts[kind][1]+'.',recentAuth:false};
 }
 if(a.type==='domainProof'&&exact(a,['type','hostname','projectId'])&&id(a.projectId)&&typeof a.hostname==='string'&&/^[a-zA-Z0-9.-]{1,253}$/.test(a.hostname))return {action:{type:'domainProof',hostname:a.hostname.toLowerCase(),projectId:a.projectId},command:`/domain ${a.hostname.toLowerCase()} ${a.projectId}`,label:'Prepare ownership verification for '+a.hostname.toLowerCase()+'.',recentAuth:false};
 if(a.type==='checkDomainProof'&&exact(a,['type','claimId'])&&id(a.claimId))return {action:{type:'checkDomainProof',claimId:a.claimId},command:'/verify-domain '+a.claimId,label:'Check the saved domain ownership proof.',recentAuth:false};
 if(a.type==='guestPreview'&&id(a.linkId)){
  // WH-151: ids only. Issuance is never a control (its one-time token cannot enter Chat history).
  if(a.operation==='revoke'&&exact(a,['type','operation','linkId'])&&Object.keys(a).length===3)return {action:{type:'guestPreview',operation:'revoke',linkId:a.linkId},command:'/guest-preview-revoke '+a.linkId,label:'Revoke this guest preview link now.',recentAuth:false};
  if(a.operation==='delete'&&a.confirmation==='DELETE'&&Object.keys(a).length===4&&exact(a,['type','operation','linkId','confirmation']))return {action:{type:'guestPreview',operation:'delete',linkId:a.linkId,confirmation:'DELETE'},command:`/guest-preview-delete ${a.linkId} DELETE`,label:'Delete this guest preview link and its saved comments.',recentAuth:false};
 }
 if(a.type==='unpublish'&&exact(a,['type','projectId'])&&(!Object.hasOwn(a,'projectId')||id(a.projectId)))return {action:a.projectId?{type:'unpublish',projectId:a.projectId as string}:{type:'unpublish'},command:'/unpublish'+(a.projectId?' '+a.projectId:''),label:'Prepare a review to take my website offline.',recentAuth:false};
}
