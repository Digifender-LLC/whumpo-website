import {readWorkspaceReviews,filterWorkspaceReviewAccess,type WorkspaceReviewQueue} from './workspace-reviews';
import {assertFeature} from './feature-admission';
import {FeatureInclusionError} from './feature-inclusion';
import {assertWorkspace} from './workspace-identity/admission';
import {readLayout} from './workspace-layout';
import {readProjectStatuses,readWorkspaceActivity,readWorkspaceStorage} from './workspace-data';
import {readTraffic} from './site-traffic';
import {readGuestPreviewFacts} from './guest-previews/bindings';
import {readSiteDiagnostics} from './site-diagnostics';
import {readModuleInstances} from './shared-modules/registry';
import {readAccessRoles} from './shared-modules/access';
import {readRecordsSummary} from './shared-modules/records';
import {object,exact,uuid,viewComponents,WorkspaceViewError,type WidgetKind} from './workspace-view-contract';
import {readViewComponentData,viewBinding,type ViewComponentData} from './workspace-view-data';

/** Registry-owned read, shared by Chat and pages. No billing initialization,
 * model calls, provider calls, effects or arbitrary selectors are permitted. */
export async function readViewBinding(db:D1Database,user:string,kind:WidgetKind,projectId:string|null,revalidate?:()=>Promise<void>):Promise<ViewComponentData>{
 await assertWorkspace(db,user);
 if(!Object.hasOwn(viewComponents,kind)||!(projectId===null||uuid(projectId)))throw new WorkspaceViewError(400,'invalid_view','Use a registered component and exact scope.');
 const feature=viewComponents[kind].feature,gate=feature===null?null:{userId:user,projectId,featureId:feature,operation:'read' as const};
 let status:ViewComponentData['status']='ready',data:unknown=null,before:string|null=null;
 const ownedIds=async()=>JSON.stringify((await db.prepare('SELECT id FROM projects WHERE owner_user_id=? ORDER BY id').bind(user).all<{id:string}>()).results);
 try{
  if(gate)await assertFeature(db,gate);before=projectId===null?await ownedIds():null;
  if(kind==='projects'||kind==='cms'){
   const {results}=await readProjectStatuses(db,user,projectId);
   if(results.some(p=>![0,1].includes(p.site_live)))throw new Error('Invalid saved project status');
   data={items:results.map(p=>kind==='projects'?{projectId:p.id,name:p.name,state:p.status,websitePublished:p.site_live===1}:{projectId:p.id,name:p.name,publishedArticles:p.cms_articles})};
  }else if(kind==='usage')data={standardIncluded:true,advancedEnabled:false};
  else if(kind==='storage'){
   const {results}=await readWorkspaceStorage(db,user,projectId);data={files:results.reduce((n,p)=>n+p.files,0),bytes:results.reduce((n,p)=>n+p.bytes,0)};
  }else if(kind==='activity'){
   const {results}=await readWorkspaceActivity(db,user,projectId);data={items:results.map(a=>({id:a.id,projectId:a.project_id,summary:a.summary,createdAt:a.created_at}))};
  }else if(kind==='reviews')data=await readWorkspaceReviews(db,user,projectId);
  else if(kind==='traffic')data=await readTraffic(db,user,projectId);
  else if(kind==='guest-previews'){if(projectId===null)status='unavailable';else data=await readGuestPreviewFacts(db,user,projectId);}
  else if(kind==='site-health')data=await readSiteDiagnostics(db,user,projectId);
  else if(kind==='modules'){if(projectId===null)status='unavailable';else data=await readModuleInstances(db,user,projectId);}
  else if(kind==='access-roles'){if(projectId===null)status='unavailable';else data=await readAccessRoles(db,user,projectId);}
  else if(kind==='records-summary'){if(projectId===null)status='unavailable';else data=await readRecordsSummary(db,user,projectId);}
  else status='unavailable';
 }catch(error){status=error instanceof FeatureInclusionError?'denied':'unavailable';}
 // Discard already-read facts after late access changes; never return stale data
 // alongside a denied/unavailable status. Identity failure propagates to the gate.
 await revalidate?.();
 if(kind==='reviews'&&status==='ready'){
  // A layout read may race with a review change; refresh through its authoritative
  // validator, then fence the page and per-project eligibility again.
  try{data=await readWorkspaceReviews(db,user,projectId);}catch{status='unavailable';}
  await revalidate?.();
  if(status==='ready')data=await filterWorkspaceReviewAccess(db,user,data as WorkspaceReviewQueue);
 }
 if(before!==null&&before!==await ownedIds())status='unavailable';
 await assertWorkspace(db,user);
 try{if(gate)await assertFeature(db,gate);}catch(error){if(!(error instanceof FeatureInclusionError))throw error;status='denied';}
 const header={version:1,kind,binding:viewBinding(kind,projectId),projectId,asOf:new Date().toISOString()};
 return readViewComponentData({...header,status,data:status==='ready'?data:null})??readViewComponentData({...header,status:'unavailable',data:null})!;
}

/** A saved page authorizes only its registered definition, never named data. */
export async function readSavedViewComponent(db:D1Database,user:string,input:unknown){
 if(!object(input)||!exact(input,['version','pageId','revision','kind'])||input.version!==1||typeof input.pageId!=='string'||!Number.isSafeInteger(input.revision)||Number(input.revision)<0||typeof input.kind!=='string'||!Object.hasOwn(viewComponents,input.kind))throw new WorkspaceViewError(400,'invalid_view','Read a supported current page component.');
 const current=await readLayout(db,user),kind=input.kind as WidgetKind,view=input.pageId==='dashboard'?current.layout.dashboard:current.layout.tabs.find(t=>t.id===input.pageId)?.view;
 if(current.revision!==input.revision)throw new WorkspaceViewError(409,'workspace_layout_changed','This page changed. Refresh the workspace.');
 if(!view||!view.widgets.includes(kind))throw new WorkspaceViewError(404,'component_missing','This page component is no longer available.');
 return readViewBinding(db,user,kind,view.projectId,async()=>{
  const latest=await readLayout(db,user);
  if(latest.revision!==current.revision)throw new WorkspaceViewError(409,'workspace_layout_changed','This page changed. Refresh the workspace.');
 });
}
