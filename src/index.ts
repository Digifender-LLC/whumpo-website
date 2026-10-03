import {readSavedViewComponent} from './workspace-view-bindings';
import {readLayout,readLayoutHistory,readLayoutReceipt,mutateLayout} from './workspace-layout';
import {WorkspaceViewError} from './workspace-view-contract';
import {handleInteractionRequest} from './chat-interactions/http';
import {cleanIdentityCeremonies} from './workspace-identity/ceremonies';
import {handleIdentityRequest,workspaceIdentity} from './workspace-identity/http';
import {IdentityError} from './workspace-identity/authority';
import {admitWorkspace,workspaceBindings,assertWorkspace,requireFreshWorkspace,workspaceTransport} from './workspace-identity/admission';
import {FeatureInclusionError} from './feature-inclusion';
import {stripeBillingWebhook,subscriptionsEnabled,subscriptionStatus,refreshSubscriptions,startSubscription,billingPortal} from './stripe-billing';
import {serviceClientActivationPreview} from './project-specification/service-clients/activation';
import {runMaintenance} from './maintenance';
import {cleanupInteractionDrafts} from './chat-interactions/retention';
import {exportChatTranscript} from './chat-transcript';
import {quarantineBackendImport,listBackendImports,scanBackendImports} from './backend-imports';
import {serviceClientPreview,savedServiceClientPreview} from './project-specification/service-clients/store';
import {specificationPreview,specificationReviewDetails} from './project-specification/store';
import {eraseRevokedVisitor} from './app-owner-erasure';
import {chatHistory} from './chat-history';
import {readOnboarding,saveOnboarding,completeOnboarding,onboardingComplete} from './onboarding';
import {cmsWordPressAction,cmsWordPressCommand} from './cms-wordpress-chat';
import {analyzeCMSWordPress,inspectCMSWordPress,uploadCMSWordPressRequest} from './cms-wordpress-api';
import {listCMSWordPressSources,readCMSWordPressSource,downloadCMSWordPressSource} from './cms-wordpress-sources';
import {prepareCMSWordPressImport,prepareCMSWordPressMediaImport} from './cms-wordpress-import';
import {readCMSImport,confirmCMSImport,cmsImportPage} from './cms-imports';
import {readCMSUploads,uploadCMSMediaRequest} from './cms-media-uploads';
import {cleanupFairUseObservations} from './fair-use-observation';
import {readCMSMediaPreview} from './cms-media-preview';
import {listCMSMedia} from './cms-media';
import {cmsExport} from './cms-export';
import {readProjectDetails,saveProjectDetails} from './project-details';
import {cleanupTraffic} from './site-traffic';
import {compareBackends} from './backend-diff';
import {cleanupAppLifecycle} from './app-lifecycle';
import {readAppPage,readAppPageReview,prepareAppPage,confirmAppPage} from './app-pages';
import {readProfile,updateProfile,profilePhoto,updateProfilePhoto} from './profile';
import {readAppAccess,cancelAppInvitation} from './app-access';
import {createAppInvitation,revokeAppVisitor} from './app-auth';
import {dashboardData,readCapacity,saveCapacity} from './workspace-dashboard';
import { readAcknowledgment } from './acknowledgment';
import {readApplication,readApplicationReview,prepareApplication,confirmApplication} from './app-activation';
import {readBackendForm,readBackendFormReview,prepareBackendForm,confirmBackendForm} from './backend-forms';
import {readBackendPublication,prepareBackendPublication,readBackendPublicationReview,confirmBackendPublication} from './backend-publication';
import {cmsDiscardCommand} from './cms-discard';
import {cmsUnpublishCommand} from './cms-unpublish';
import {cmsPublicationCommand,cmsPublicationPage} from './cms-publication';
import {cmsPreview} from './cms-preview';
import {cmsContentAction,listCMSDrafts,readCMSDraft} from './cms-content';
import {listCMSPublications} from './cms-publication';
import {readCMSCapabilities,readCMSStatus} from './cms-status';
import {listCMS,readCMSReview,prepareCMS,confirmCMS,CMSProjectError} from './cms-projects';
import {readBackendState,readBackendReview,prepareBackendState,confirmBackendState,backendStateHistory,exportBackendState,restoreBackendState} from './backend-state';
import {BackendError,listBackends,testBackend} from './backend-versions';
import {readDirectory,directoryHistory,exportDirectory,DirectoryError} from './directory';
import {HealthError,listHealth,checkHealth,maintainHealth} from './site-health';
import {DiffError,compareVersions,compareReview,diffPage,comparisonErrorResponse} from './version-diff';
import {contactPage} from './contact-page';
import {ContactError,contactInbox,deleteContact,cleanupContacts} from './contacts';
import {listDNSActions,reviewTXT,reviewCNAME,confirmDNS} from './cloudflare-dns';
import {cloudflareConfig,cloudflareStatus,startCloudflare,cancelCloudflare,finishCloudflare,disconnectCloudflare,cloudflareZones,cleanupCloudflare} from './cloudflare-connection';
import {hostingConfig,hostingConnections,reviewHosting,confirmHosting,refreshHosting,disconnectHosting,maintainHosting} from './domain-hosting';
import {githubRepositories,listBackups,reviewBackup,confirmBackup} from './github-backups';
import {ConnectionVaultError} from './connection-vault';
import {ConnectionError,githubConfig,startGitHub,cancelGitHub,finishGitHub,disconnectGitHub,connectionStatus,cleanupGitHub,githubInstallations} from './github-connection';
import {githubGrantReviews,reviewGitHubGrant,confirmGitHubGrant,cancelGitHubGrant} from './github-grant-revocation';
import {DomainError,listDomains} from './domains';
import { ownedPreview } from './photo-versions';
import { StorageLimitError } from './storage-budget';
import {uploadPhoto,listPhotos,readPhotoUpload,readPhoto,cleanupPhotos} from './files';
import {parsePhotoHandoff} from './chat-interactions/photo-handoff';
import {FileError} from './photo-format';
import { ownedExport } from './exports';
import { componentCatalog, previewHeaders } from './components';
import { publicPlans, domainBenefit } from "./plans";
import { launchFeatureCatalogue } from "./plan-features";
import { readChat, sendConversation, sendChatControl } from "./chat";
import {chatControl} from "./chat-controls";
import { BillingError, getBilling } from "./billing";
import { configuredAI } from "./ai-chat";

type User = { id: string; email: string };
type Project = { id: string; name: string; purpose: string; status: string; created_at: string; updated_at: string };
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy":"no-referrer" };

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...headers } });
}
function error(status: number, message: string): Response { return json({ error: message }, status); }
async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) return null;
  try {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const raw = new TextDecoder().decode(bytes);
    const data: unknown = JSON.parse(raw);
    return data !== null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch { return null; }
}
function localMode(request: Request, env: Env): boolean {
  return String(env.ENVIRONMENT) === "local";
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}
async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  const identity=await handleIdentityRequest(request,env);if(identity)return identity;
  if (method === "GET" && pathname === "/api/health") return json({ status: "ok" });
  if (method === "POST" && pathname === "/api/stripe/webhook") return json(await stripeBillingWebhook(request, env.DB, env));
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !sameOrigin(request)) return error(403, "Origin check failed");
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!(await env.API_LIMITER.limit({ key: ip })).success) return error(429, "Too many requests. Try again in a minute.");
  if (method === "GET" && pathname === "/api/plans") return json({ plans: publicPlans, featureCatalogue: launchFeatureCatalogue, domainBenefit, byoc: "contact-us", resourceAllowancesStatus: "launch-targets", currency: "USD", draft: true, checkoutMode: "test", subscriptionsEnabled: subscriptionsEnabled(env) });
  if(pathname.startsWith('/api/auth/'))return error(404,'Not found');
  const principal=await workspaceIdentity(request,env);
  const scoped=workspaceBindings(env,admitWorkspace(env.DB,principal),principal.accountId);
  const user=await scoped.DB.prepare('SELECT id,email FROM users WHERE id=?').bind(principal.accountId).first<User>();
  if(!user)throw new IdentityError(401,'proof_required','Sign in to continue.');
  const response=await handleWorkspace(request,scoped,ctx,user);
  try{await assertWorkspace(scoped.DB,user.id);}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  return response;
}
async function handleWorkspace(request:Request,env:Env,ctx:ExecutionContext,user:User):Promise<Response>{
  const {pathname}=new URL(request.url),method=request.method;
  const transport=workspaceTransport(env.DB,user.id);
  // Check persisted completion before reading workspace data or dispatching Chat work.
  if((pathname==='/api/chat'||pathname.startsWith('/api/chat/')||pathname.startsWith('/api/workspace/'))&&!await onboardingComplete(env.DB,user.id))return json({error:'Start your first project in welcome before opening your workspace.',code:'onboarding_required'},409);
  if(pathname==='/api/onboarding'){
    if(method==='GET')return json(await readOnboarding(env.DB,user.id));
    if(method==='PUT')return json(await saveOnboarding(env.DB,user.id,(await body(request))??{}));
  }
  if(pathname==='/api/onboarding/complete'&&method==='POST')return json(await completeOnboarding(env.DB,user.id,(await body(request))??{}));
  if(pathname==='/api/profile'){
    if(method==='GET')return json(await readProfile(env.DB,user.id));
    if(method==='PATCH')return json(await updateProfile(env.DB,user.id,await body(request)));
  }
  if(pathname==='/api/profile/photo'){
    if(method==='GET')return profilePhoto(env.DB,user.id);
    if(method==='PUT'||method==='DELETE')return json(await updateProfilePhoto(env.DB,user.id,request));
  }
  if(method==='GET'&&pathname==='/api/workspace/dashboard')return json(await dashboardData(env.DB,user.id));
  if(pathname==='/api/workspace/views/v1/component'&&method==='POST')return json(await readSavedViewComponent(env.DB,user.id,await body(request)));
  if(pathname==='/api/workspace/views/v1/layout'&&method==='GET')return json(await readLayout(env.DB,user.id));
  if(pathname==='/api/workspace/views/v1/history'&&method==='GET')return json(await readLayoutHistory(env.DB,user.id));
  if(pathname==='/api/workspace/views/v1/mutate'&&method==='POST')return json(await mutateLayout(env.DB,user.id,await body(request)));
  if(pathname==='/api/workspace/views/v1/receipt'&&method==='POST'){const data=await body(request);if(!data||Object.keys(data).sort().join(',')!=='requestId,version'||data.version!==1)throw new WorkspaceViewError(400,'invalid_request','Use the current request receipt.');return json(await readLayoutReceipt(env.DB,user.id,data.requestId));}
  if(pathname==='/api/workspace/capacity'){
    if(method==='GET')return json(await readCapacity(env.DB,user.id));
    if(method==='PUT')return json(await saveCapacity(env.DB,user.id,await body(request)));
  }

  const wordpressSourceRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/wordpress\/sources(?:\/([0-9a-f-]{36})(?:\/(download|import-reviews))?)?$/);
  if(wordpressSourceRoute){
    const [,project,source,action]=wordpressSourceRoute,cmsEnv=env as unknown as Record<string,unknown>;
    if(method==='GET'&&!source)return json({sources:await listCMSWordPressSources(env.DB,user.id,project,cmsEnv)});
    if(method==='PUT'&&source&&!action)return json(await uploadCMSWordPressRequest(request,env.DB,env.FILES,user.id,project,source,cmsEnv));
    if(source){const owned=await readCMSWordPressSource(env.DB,user.id,source);if(owned.project_id!==project)return error(404,'Source file not found');
      if(method==='GET'&&!action)return json(await inspectCMSWordPress(env.DB,env.FILES,user.id,project,source));
      if(method==='GET'&&action==='download')return downloadCMSWordPressSource(env.DB,env.FILES,user.id,source);
      if(method==='POST'&&action==='import-reviews'){const data=await body(request);if(!data||Object.keys(data).some(k=>!['id','sourceItemId','mediaIds'].includes(k))||typeof data.id!=='string'||typeof data.sourceItemId!=='number'||!Number.isSafeInteger(data.sourceItemId)||data.sourceItemId<1)return error(400,'Choose one source article and a review request ID');if(data.mediaIds!==undefined){if(!Array.isArray(data.mediaIds)||!data.mediaIds.length||data.mediaIds.length>4||data.mediaIds.some(value=>typeof value!=='string'||!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)))return error(400,'Choose confirmed local image IDs in source image order');return json(await prepareCMSWordPressMediaImport(env.DB,env.FILES,user.id,project,source,data.sourceItemId,data.id,data.mediaIds.map((mediaId,position)=>({position,mediaId})),cmsEnv));}return json(await prepareCMSWordPressImport(env.DB,env.FILES,user.id,project,source,data.sourceItemId,data.id,cmsEnv,analyzeCMSWordPress));}
    }
    return error(405,'Method not allowed');
  }
  const wordpressReviewsRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/wordpress\/import-reviews$/);
  if(wordpressReviewsRoute&&method==='GET'){
    const project=wordpressReviewsRoute[1];await listCMSWordPressSources(env.DB,user.id,project,env as unknown as Record<string,unknown>);
    return json({reviews:(await env.DB.prepare("SELECT id,source_upload_id,source_id,status,collection,expires_at,json_extract(body,'$.data.title') title FROM cms_import_reviews WHERE user_id=? AND project_id=? AND source_upload_id IS NOT NULL ORDER BY created_at DESC,id LIMIT 100").bind(user.id,project).all()).results});
  }
  const wordpressReviewRoute=pathname.match(/^\/api\/cms-import-reviews\/([0-9a-f-]{36})(?:\/(preview|confirm))?$/);
  if(wordpressReviewRoute){
    const [,reviewId,action]=wordpressReviewRoute,row=await readCMSImport(env.DB,user.id,reviewId);if(!row.source_upload_id)return error(404,'Source-bound import review not found');
    if(method==='GET'&&!action)return json(row);
    if(method==='GET'&&action==='preview')return cmsImportPage(env.DB,user.id,reviewId,env as unknown as Record<string,unknown>);
    if(method==='POST'&&action==='confirm')return json(await confirmCMSImport(env.DB,user.id,reviewId,env as unknown as Record<string,unknown>));
    return error(405,'Method not allowed');
  }
  const cmsPublicationRoute=pathname.match(/^\/api\/cms-publication-reviews\/([0-9a-f-]{36})\/preview$/);
  if(method==='GET'&&cmsPublicationRoute)return cmsPublicationPage(env.DB,user.id,cmsPublicationRoute[1],env.FILES);
  const cmsExportRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/content\/([0-9a-f-]{36})\/export$/);
  if(method==='GET'&&cmsExportRoute)return cmsExport(env.DB,user.id,cmsExportRoute[1],cmsExportRoute[2],env as unknown as Record<string,unknown>);
  const cmsPreviewRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/content\/([0-9a-f-]{36})\/preview$/);
  if(method==='GET'&&cmsPreviewRoute)return cmsPreview(env.DB,user.id,cmsPreviewRoute[1],cmsPreviewRoute[2],env as unknown as Record<string,unknown>);
  const cmsContentRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/content(?:\/([0-9a-f-]{36}))?$/);
  if(cmsContentRoute){
    const projectId=cmsContentRoute[1],requestId=cmsContentRoute[2],cmsEnv=env as unknown as Record<string,unknown>;
    if(method==='GET')return json(requestId?await readCMSDraft(env.DB,user.id,projectId,requestId,cmsEnv):{drafts:await listCMSDrafts(env.DB,user.id,projectId,cmsEnv),publications:await listCMSPublications(env.DB,user.id,projectId)});
    if((method==='POST'&&!requestId)||(method==='PATCH'&&requestId)){
      const data=await body(request),structured=!!data&&Object.hasOwn(data,'content'),field=structured?'content':'text',allowed=requestId?['id','title',field,'revision']:['id','title',field,'collection'];
      if(!data||typeof data.id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data.id)||Object.keys(data).some(k=>!allowed.includes(k)))return error(400,'Provide a request ID and supported content fields');
      return json(await cmsContentAction(env.DB,user.id,{operation:requestId?(structured?'editStructuredDraft':'editDraft'):(structured?'structuredDraft':'draft'),projectId,...(requestId?{requestId,revision:data.revision}:{collection:data.collection}),title:data.title,[field]:data[field]},data.id,cmsEnv));
    }
    return error(405,'Method not allowed');
  }
  const cmsUploadsRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/media\/uploads(?:\/([0-9a-f-]{36}))?$/);
  if(cmsUploadsRoute){
    const project=cmsUploadsRoute[1],requestId=cmsUploadsRoute[2],cmsEnv=env as unknown as Record<string,unknown>;
    if(method==='GET'&&!requestId)return json(await readCMSUploads(env.DB,user.id,project,cmsEnv));
    if(method==='PUT'&&requestId)return json(await uploadCMSMediaRequest(request,env.DB,user.id,project,requestId,cmsEnv));
    return error(405,'Method not allowed');
  }
  const cmsImagePreviewRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/media\/([0-9A-HJKMNP-TV-Z]{26})\/preview$/);
  if(method==='GET'&&cmsImagePreviewRoute)return await readCMSMediaPreview(env.DB,user.id,cmsImagePreviewRoute[1],cmsImagePreviewRoute[2],env as unknown as Record<string,unknown>);
  const cmsMediaRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/media$/);
  if(method==='GET'&&cmsMediaRoute){const page=new URL(request.url).searchParams.get('page')??'1';if(!/^(?:[1-9]\d{0,2}|1000)$/.test(page))return error(400,'Choose a valid media page');return json(await listCMSMedia(env.DB,user.id,cmsMediaRoute[1],Number(page),env as unknown as Record<string,unknown>));}
  const cmsCapabilitiesRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/capabilities$/);
  if(method==='GET'&&cmsCapabilitiesRoute)return json(await readCMSCapabilities(env.DB,user.id,cmsCapabilitiesRoute[1],env as unknown as Record<string,unknown>));
  const cmsStatusRoute=pathname.match(/^\/api\/cms\/([0-9a-f-]{36})\/status$/);
  if(method==='GET'&&cmsStatusRoute)return json(await readCMSStatus(env.DB,user.id,cmsStatusRoute[1],env as unknown as Record<string,unknown>));
  if(method==='GET'&&pathname==='/api/cms')return json({instances:await listCMS(env.DB,user.id)});
  if(method==='POST'&&pathname==='/api/cms/setup-reviews'){
    const data=await body(request);
    if(typeof data?.id!=='string'||typeof data.projectId!=='string'||typeof data.title!=='string'||typeof data.tagline!=='string')return error(400,'Provide a request ID, project, title and tagline');
    return json(await prepareCMS(env.DB,user.id,data.id,data.projectId,data.title,data.tagline));
  }
  const cmsReviewRoute=pathname.match(/^\/api\/cms\/setup-reviews\/([0-9a-f-]{36})(\/confirm)?$/);
  if(cmsReviewRoute){
    if(method==='GET'&&!cmsReviewRoute[2])return json(await readCMSReview(env.DB,user.id,cmsReviewRoute[1]));
    if(method==='POST'&&cmsReviewRoute[2])return json(await confirmCMS(env.DB,user.id,cmsReviewRoute[1]));
  }
  const historyRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/backend-state\/history$/);
  if(method==='GET'&&historyRoute)return json(await backendStateHistory(env.DB,user.id,historyRoute[1]));
  const snapshotRoute=pathname.match(/^\/api\/backend-state-snapshots\/([0-9a-f-]{36})\/(export|restore)$/);
  if(snapshotRoute){
    if(method==='GET'&&snapshotRoute[2]==='export')return json(await exportBackendState(env.DB,user.id,snapshotRoute[1]),200,{'content-disposition':'attachment; filename="whumpo-backend-state-'+snapshotRoute[1]+'.json"'});
    if(method==='POST'&&snapshotRoute[2]==='restore'){
      const data=await body(request);if(typeof data?.id!=='string'||(data.side!=='before'&&data.side!=='after'))return error(400,'Provide a review ID and before or after snapshot side');
      return json(await restoreBackendState(env.DB,user.id,data.id,snapshotRoute[1],data.side));
    }
  }
  const stateRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/backend-state$/);
  if(stateRoute){
    if(method==='GET')return json(await readBackendState(env.DB,user.id,stateRoute[1]));
    if(method==='POST'){
      const data=await body(request);
      if(typeof data?.id!=='string'||typeof data.versionId!=='string'||!('input' in data))return error(400,'Provide a review ID, backend version ID and JSON input');
      return json(await prepareBackendState(env.DB,env.BACKEND_RUNTIME,user.id,stateRoute[1],data.versionId,data.id,data.input));
    }
  }
  const stateReviewRoute=pathname.match(/^\/api\/backend-state-reviews\/([0-9a-f-]{36})(\/confirm)?$/);
  if(stateReviewRoute){
    if(method==='GET'&&!stateReviewRoute[2])return json(await readBackendReview(env.DB,user.id,stateReviewRoute[1]));
    if(method==='POST'&&stateReviewRoute[2])return json(await confirmBackendState(env.DB,user.id,stateReviewRoute[1]));
  }
  const appPageRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/application-page$/);
  if(appPageRoute){
    if(method==='GET')return json(await readAppPage(env.DB,user.id,appPageRoute[1]));
    if(method==='POST'){const data=await body(request);if(typeof data?.id!=='string'||!Object.hasOwn(data,'form'))return error(400,'Provide a review ID and form, or null to take the page offline');return json(await prepareAppPage(env.DB,user.id,appPageRoute[1],data.id,data.form));}
  }
  const appPageReview=pathname.match(/^\/api\/application-page-reviews\/([0-9a-f-]{36})(\/confirm)?$/);
  if(appPageReview){if(method==='GET'&&!appPageReview[2])return json(await readAppPageReview(env.DB,user.id,appPageReview[1]));if(method==='POST'&&appPageReview[2])return json(await confirmAppPage(env.DB,user.id,appPageReview[1]));}
  const accessRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/application-access(?:\/(invitations|visitors)(?:\/([0-9a-f-]{36}|[0-9a-f]{64})\/(cancel|revoke|erase))?)?$/);
  if(accessRoute){
    const [,project,kind,id,action]=accessRoute;
    if(method==='GET'&&!kind)return json(await readAppAccess(env.DB,user.id,project));
    if(method==='POST'){
      await requireFreshWorkspace(env.DB,user.id);
      if(!(await env.AUTH_LIMITER.limit({key:'app-access:'+user.id})).success)return error(429,'Too many access changes. Try again in a minute.');
      const data=await body(request);
      if(kind==='visitors'&&id&&action==='erase')return json(await eraseRevokedVisitor(env.DB,user.id,project,id,data??{}));
      if(!data||Object.keys(data).length)return error(400,'This action expects an empty JSON object');
      if(kind==='invitations'&&!id)return json(await createAppInvitation(env.DB,user.id,project),201);
      if(kind==='invitations'&&id&&action==='cancel')return json(await cancelAppInvitation(env.DB,user.id,project,id));
      if(kind==='visitors'&&id&&action==='revoke'){await revokeAppVisitor(env.DB,user.id,project,id);return json({revoked:true});}
    }
    return error(405,'Unsupported visitor access operation');
  }
  const applicationRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/application$/);
  if(applicationRoute){
    if(method==='GET')return json(await readApplication(env.DB,user.id,applicationRoute[1]));
    if(method==='POST'){const data=await body(request);if(typeof data?.id!=='string'||(data.operation!=='enable'&&data.operation!=='disable')||data.operation==='enable'&&(typeof data.versionId!=='string'||typeof data.runId!=='string'))return error(400,'Provide a review ID, operation and transition test');return json(await prepareApplication(env.DB,user.id,applicationRoute[1],data.id,data.operation,typeof data.versionId==='string'?data.versionId:null,typeof data.runId==='string'?data.runId:null));}
  }
  const applicationReview=pathname.match(/^\/api\/application-reviews\/([0-9a-f-]{36})(\/confirm)?$/);
  if(applicationReview){
    if(method==='GET'&&!applicationReview[2])return json(await readApplicationReview(env.DB,user.id,applicationReview[1]));
    if(method==='POST'&&applicationReview[2])return json(await confirmApplication(env.DB,user.id,applicationReview[1]));
  }
  const backendFormRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/backend-form$/);
  if(backendFormRoute){
    if(method==='GET')return json(await readBackendForm(env.DB,user.id,backendFormRoute[1]));
    if(method==='POST'){const data=await body(request);if(typeof data?.id!=='string'||!('config' in data))return error(400,'Provide a review ID and config (null to disable)');return json(await prepareBackendForm(env.DB,user.id,backendFormRoute[1],data.id,data.config));}
  }
  const backendFormReview=pathname.match(/^\/api\/backend-form-reviews\/([0-9a-f-]{36})(\/confirm)?$/);
  if(backendFormReview){
    if(method==='GET'&&!backendFormReview[2])return json(await readBackendFormReview(env.DB,user.id,backendFormReview[1]));
    if(method==='POST'&&backendFormReview[2])return json(await confirmBackendForm(env.DB,user.id,backendFormReview[1]));
  }
  const backendPublicationRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/backend-publication$/);
  if(backendPublicationRoute){
    if(method==='GET')return json(await readBackendPublication(env.DB,user.id,backendPublicationRoute[1]));
    if(method==='POST'){
      const data=await body(request);
      if(typeof data?.id!=='string'||typeof data.versionId!=='string'||(data.operation!=='publish'&&data.operation!=='unpublish')||data.operation==='publish'&&typeof data.runId!=='string')return error(400,'Provide a review ID, operation, version and successful test receipt');
      return json(await prepareBackendPublication(env.DB,user.id,backendPublicationRoute[1],data.id,data.operation,data.versionId,typeof data.runId==='string'&&data.operation==='publish'?data.runId:null));
    }
  }
  const backendPublicationReview=pathname.match(/^\/api\/backend-publication-reviews\/([0-9a-f-]{36})(\/confirm)?$/);
  if(backendPublicationReview){
    if(method==='GET'&&!backendPublicationReview[2])return json(await readBackendPublicationReview(env.DB,user.id,backendPublicationReview[1]));
    if(method==='POST'&&backendPublicationReview[2])return json(await confirmBackendPublication(env.DB,user.id,backendPublicationReview[1]));
  }
  const backendDiffRoute=pathname.match(/^\/api\/backend-versions\/([0-9a-f-]{36})\/compare\/([0-9a-f-]{36})$/);
  if(method==='GET'&&backendDiffRoute)return json(await compareBackends(env.DB,user.id,backendDiffRoute[1],backendDiffRoute[2]));
  const backendRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/backends(?:\/([0-9a-f-]{36})\/test)?$/);
  if(backendRoute){
    if(method==='GET'&&!backendRoute[2])return json({versions:await listBackends(env.DB,user.id,backendRoute[1]),imports:await listBackendImports(env.DB,user.id,backendRoute[1])});
    if(method==='POST'){
      const data=await body(request);if(!data)return error(400,'A bounded JSON request is required');
      return backendRoute[2]?json(await testBackend(env.DB,env.BACKEND_RUNTIME,user.id,backendRoute[1],backendRoute[2],data.id,data.input,Object.hasOwn(data,'expected')?{expected:data.expected}:undefined)):json(await quarantineBackendImport(env.DB,user.id,backendRoute[1],data.id,data.source),202);
    }
  }
  const inboxMatch=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/inbox$/);
  if(method==='GET'&&inboxMatch)return json(await contactInbox(env.DB,user.id,inboxMatch[1]));
  const messageMatch=pathname.match(/^\/api\/contact-messages\/([0-9a-f-]{36})$/);
  if(method==='DELETE'&&messageMatch){await deleteContact(env.DB,user.id,messageMatch[1]);return json({ok:true});}
  if(method==='GET'&&pathname==='/api/domain-hosting')return json({enabled:!!hostingConfig(env),connections:await hostingConnections(env.DB,user.id)});
  if(method==='POST'&&pathname==='/api/domain-hosting/review'){
    const data=await body(request);if(typeof data?.id!=='string'||typeof data.claimId!=='string')return error(400,'Choose a domain ownership claim.');
    return json(await reviewHosting(env.DB,user.id,data.id,data.claimId,hostingConfig(env)));
  }
  const hostingAction=pathname.match(/^\/api\/domain-hosting\/([0-9a-f-]{36})\/(confirm|refresh|disconnect)$/);
  if(method==='POST'&&hostingAction){const fn=hostingAction[2]==='confirm'?confirmHosting:hostingAction[2]==='refresh'?refreshHosting:disconnectHosting;return json(await fn(env.DB,user.id,hostingAction[1],hostingConfig(env)));}
  if (method === "GET" && pathname === "/api/domains") return json({...await listDomains(env.DB,user.id),connectionEnabled:!!hostingConfig(env)});
  if (method === "GET" && pathname === "/api/components") return json({components:componentCatalog});
  const filesMatch = pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/files(?:\/([0-9a-f-]{36}))?$/);
  if (filesMatch && method === 'GET' && !filesMatch[2]) return json(await listPhotos(env.DB,user.id,filesMatch[1]));
  if (filesMatch && method === 'GET' && filesMatch[2]) return json(await readPhotoUpload(env.DB,user.id,filesMatch[1],filesMatch[2],request.headers.has('x-whumpo-photo-handoff')?parsePhotoHandoff(request.headers.get('x-whumpo-photo-handoff')):null));
  if (filesMatch && method === 'PUT' && filesMatch[2]) return json(await uploadPhoto(request,env,user.id,filesMatch[1],filesMatch[2]));
  const photoMatch=pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/);
  if (photoMatch && method === 'GET') return readPhoto(env,user.id,photoMatch[1]);
  const diffMatch=pathname.match(/^\/api\/site-versions\/([0-9a-f-]{36})\/diff$/);
  const serviceActivation=pathname.match(/^\/api\/service-client-activations\/([0-9a-f-]{36})\/(preview|diff)$/);
  if(method==='GET'&&serviceActivation){if(new URL(request.url).search)return error(400,'Use the exact service activation review link.');return serviceClientActivationPreview(env.DB,user.id,serviceActivation[1],serviceActivation[2]==='diff');}
  const serviceClientReview=pathname.match(/^\/api\/service-client-reviews\/([0-9a-f-]{36})\/(preview|diff)$/);
  if(method==='GET'&&serviceClientReview){if(new URL(request.url).search)return error(400,'Use the exact service settings review link.');return serviceClientPreview(env.DB,user.id,serviceClientReview[1],serviceClientReview[2]==='diff',env.FILES);}
  const serviceClientVersion=pathname.match(/^\/api\/service-client-versions\/([0-9a-f-]{36})\/preview$/);
  if(method==='GET'&&serviceClientVersion){if(new URL(request.url).search)return error(400,'Use the exact saved service settings link.');return savedServiceClientPreview(env.DB,user.id,serviceClientVersion[1],env.FILES);}
  const specificationReview=pathname.match(/^\/api\/specification-reviews\/([0-9a-f-]{36})\/(preview|diff|details)$/);
  if(method==='GET'&&specificationReview){if(new URL(request.url).search)return error(400,'Use the exact website review link.');if(specificationReview[2]==='details')return json(await specificationReviewDetails(env.DB,user.id,specificationReview[1]));return specificationPreview(env.DB,user.id,specificationReview[1],specificationReview[2]==='diff',env.FILES);}
  if(method==='GET'&&diffMatch){const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>k!=='base')||params.getAll('base').length>1)return error(400,'Choose a single baseline.');return diffPage(await compareVersions(env.DB,user.id,diffMatch[1],params.get('base')??undefined));}
  const reviewDiff=pathname.match(/^\/api\/publication-reviews\/([0-9a-f-]{36})\/diff$/);
  if(method==='GET'&&reviewDiff)return diffPage(await compareReview(env.DB,user.id,reviewDiff[1]));
  const exportMatch = pathname.match(/^\/api\/site-versions\/([0-9a-f-]{36})\/export$/);
  if (method === 'GET' && exportMatch) {
    const archive = await ownedExport(env.DB, user.id, exportMatch[1], env.FILES);
    return archive ? new Response(archive, {headers:{'content-type':'application/zip','content-disposition':`attachment; filename="whumpo-site-${exportMatch[1]}.zip"`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'",'referrer-policy':'no-referrer'}}) : error(404,'Saved version not found');
  }
  const previewMatch = pathname.match(/^\/api\/site-versions\/([0-9a-f-]{36})\/preview$/);
  if (method === 'GET' && previewMatch) {
    return await ownedPreview(env,user.id,previewMatch[1]) ?? error(404,'Preview not found');
  }
  const versionsMatch = pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/versions$/);
  if (method === 'GET' && versionsMatch) {
    if (!(await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND owner_user_id = ?').bind(versionsMatch[1],user.id).first())) return error(404,'Project not found');
    const {results} = await env.DB.prepare('SELECT id,component_id,digest,created_at FROM site_versions WHERE project_id = ? ORDER BY created_at DESC,id DESC LIMIT 25').bind(versionsMatch[1]).all();
    return json({versions:results});
  }
  if (method === 'GET' && pathname === '/api/billing/subscription') return json(await subscriptionStatus(env.DB,env,user.id));
  if (method === 'POST' && pathname === '/api/billing/subscription/refresh') return json(await refreshSubscriptions(env.DB,env,user.id,transport));
  if (method === 'POST' && pathname === '/api/billing/subscription/checkout') return json(await startSubscription(env.DB,env,user.id,(await body(request))??{},transport));
  if (method === 'POST' && pathname === '/api/billing/portal') return json(await billingPortal(env.DB,env,user.id,transport));
  if (method === "GET" && pathname === "/api/billing") return json({ ...await getBilling(env.DB, user.id), checkoutMode: "test" });
  if (method === "GET" && pathname === "/api/connections") return json({...await connectionStatus(env.DB,user.id,githubConfig(env)),cloudflare:await cloudflareStatus(env.DB,user.id,cloudflareConfig(env))});
  const directoryHistoryRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/directory\/history$/);
  if(method==='GET'&&directoryHistoryRoute)return json(await directoryHistory(env.DB,user.id,directoryHistoryRoute[1]));
  const directoryExportRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/directory\/snapshots\/([0-9a-f-]{36})\/export$/);
  if(method==='GET'&&directoryExportRoute)return json(await exportDirectory(env.DB,user.id,directoryExportRoute[1],directoryExportRoute[2]),200,{'content-disposition':'attachment; filename="whumpo-directory-'+directoryExportRoute[2]+'.json"'});
  const directoryProject=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/directory$/);
  if(method==='GET'&&directoryProject){const d=await readDirectory(env.DB,user.id,directoryProject[1]);return json({projectId:d.id,name:d.name,revision:d.revision,listings:d.draft,published:d.published,publishedAt:d.published?d.published_at:null});}
  if(method==='GET'&&pathname==='/api/site-health')return json(await listHealth(env.DB,user.id));
  const healthProject=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/health$/);
  if(method==='POST'&&healthProject){if(String(env.ENVIRONMENT)==='local')return error(503,'Website checks are unavailable in this environment.');return json(await checkHealth(env.DB,user.id,healthProject[1]));}
  if(method==='GET'&&pathname==='/api/cloudflare/dns')return json({enabled:!!cloudflareConfig(env),...await listDNSActions(env.DB,user.id)});
  if(method==='POST'&&pathname==='/api/cloudflare/dns/review'){
    const data=await body(request);if(typeof data?.id!=='string'||typeof data.claimId!=='string'||typeof data.zoneId!=='string')return error(400,'Choose a claim and Cloudflare zone.');
    return json(await reviewTXT(env.DB,user.id,data.id,data.claimId,data.zoneId,cloudflareConfig(env)));
  }
  if(method==='POST'&&pathname==='/api/cloudflare/dns/routing-review'){
    const data=await body(request);if(!data||Object.keys(data).some(k=>!['id','connectionId','zoneId'].includes(k))||typeof data.id!=='string'||typeof data.connectionId!=='string'||typeof data.zoneId!=='string')return error(400,'Choose a hosting connection and Cloudflare zone.');
    return json(await reviewCNAME(env.DB,user.id,data.id,data.connectionId,data.zoneId,cloudflareConfig(env),transport,!!hostingConfig(env)));
  }
  const dnsConfirmation=pathname.match(/^\/api\/cloudflare\/dns\/([0-9a-f-]{36})\/confirm$/);
  if(method==='POST'&&dnsConfirmation)return json(await confirmDNS(env.DB,user.id,dnsConfirmation[1],cloudflareConfig(env),transport,!!hostingConfig(env)));
  if(method==='POST'&&pathname==='/api/connections/cloudflare/start'){
    await requireFreshWorkspace(env.DB,user.id);
    return json(await startCloudflare(env.DB,user.id,cloudflareConfig(env)));
  }
  if(method==='GET'&&pathname==='/api/connections/cloudflare/callback'){
    const params=new URL(request.url).searchParams;let destination='/workspace/?connection=cloudflare';
    try{if(params.has('error')){await cancelCloudflare(env.DB,user.id,params.get('state')??'');throw new ConnectionError(400,'Cloudflare authorization cancelled.');}await finishCloudflare(env.DB,user.id,params.get('state')??'',params.get('code')??'',cloudflareConfig(env));}
    catch(cause){if(!(cause instanceof ConnectionError)&&!(cause instanceof ConnectionVaultError)&&!(cause instanceof FeatureInclusionError))throw cause;destination+='&connection_error=authorization';}
    return new Response(null,{status:303,headers:{location:destination,'cache-control':'no-store','referrer-policy':'no-referrer'}});
  }
  if(method==='POST'&&pathname==='/api/connections/cloudflare/disconnect')return json(await disconnectCloudflare(env.DB,user.id,cloudflareConfig(env)));
  if(method==='GET'&&pathname==='/api/connections/cloudflare/zones')return json(await cloudflareZones(env.DB,user.id,cloudflareConfig(env),Number(new URL(request.url).searchParams.get('page')??1)));
  if (method === "POST" && pathname === "/api/connections/github/start") {
    await requireFreshWorkspace(env.DB,user.id);
    return json(await startGitHub(env.DB,user.id,githubConfig(env)));
  }
  if (method === "GET" && pathname === "/api/connections/github/callback") {
    const params=new URL(request.url).searchParams;
    let destination='/workspace/?connection=github';
    try{if(params.has('error')){await cancelGitHub(env.DB,user.id,params.get('state')??'');throw new ConnectionError(400,'GitHub authorization was cancelled.');}await finishGitHub(env.DB,user.id,params.get('state')??'',params.get('code')??'',githubConfig(env));}
    catch(cause){if(!(cause instanceof ConnectionError)&&!(cause instanceof ConnectionVaultError)&&!(cause instanceof FeatureInclusionError))throw cause;destination+='&connection_error=authorization';}
    return new Response(null,{status:303,headers:{location:destination,'cache-control':'no-store','referrer-policy':'no-referrer'}});
  }
  if (method === "POST" && pathname === "/api/connections/github/disconnect") return json(await disconnectGitHub(env.DB,user.id,githubConfig(env)));
  if(method==='GET'&&pathname==='/api/connections/github/grant-reviews')return json(await githubGrantReviews(env.DB,user.id));
  if(method==='POST'&&pathname==='/api/connections/github/grant-reviews'){
    const data=await body(request);if(!data||Object.keys(data).join(',')!=='id'||typeof data.id!=='string')return error(400,'Choose a unique GitHub access review ID.');
    return json(await reviewGitHubGrant(env.DB,user.id,data.id,githubConfig(env)));
  }
  const grantReview=pathname.match(/^\/api\/connections\/github\/grant-reviews\/([0-9a-f-]{36})\/(confirm|cancel)$/);
  if(method==='POST'&&grantReview){
    if(grantReview[2]==='cancel')return json(await cancelGitHubGrant(env.DB,user.id,grantReview[1]));
    const data=await body(request);if(!data||Object.keys(data).join(',')!=='confirmation'||data.confirmation!=='REVOKE_APP_ACCESS')return error(400,'Explicitly confirm the reviewed app-wide GitHub access removal.');
    return json(await confirmGitHubGrant(env.DB,user.id,grantReview[1],data.confirmation,githubConfig(env),transport));
  }
  if (method === "GET" && pathname === "/api/connections/github/installations") return json(await githubInstallations(env.DB,user.id,githubConfig(env)));
  if (method === "GET" && pathname === "/api/connections/github/repositories") {
    const params=new URL(request.url).searchParams;
    return json(await githubRepositories(env.DB,user.id,githubConfig(env),Number(params.get('installation')),Number(params.get('page')??1)));
  }
  if (method === "GET" && pathname === "/api/github/backups") return json(await listBackups(env.DB,user.id));
  if (method === "POST" && pathname === "/api/github/backups/review") {
    const data=await body(request);if(!data)return error(400,'A backup review is required.');
    return json(await reviewBackup(env.DB,env.FILES,user.id,data,githubConfig(env)));
  }
  const backupConfirm=pathname.match(/^\/api\/github\/backups\/([0-9a-f-]{36})\/confirm$/);
  if(method==='POST'&&backupConfirm)return json(await confirmBackup(env.DB,env.FILES,user.id,backupConfirm[1],githubConfig(env)));
  if (method === "GET" && pathname === "/api/me") return json({ user });
  const ackMatch=pathname.match(/^\/api\/chat\/([0-9a-f-]{36})\/ack$/);
  if(method==='GET' && ackMatch)return json(await readAcknowledgment(env.DB,user.id,ackMatch[1]));
  const interaction=await handleInteractionRequest(request,env.DB,user.id,configuredAI(env),transport);if(interaction)return interaction;
  if (method === "GET" && pathname === "/api/chat/export") return exportChatTranscript(request,env.DB,user.id);
  if (method === "GET" && pathname === "/api/chat/history") return chatHistory(request,env.DB,user.id);
  if (method === "GET" && pathname === "/api/chat") return json(await readChat(env.DB, user.id, !!configuredAI(env)));
  if (method === "POST" && (pathname === "/api/chat" || pathname === "/api/chat/actions")) {
    const data = await body(request);
    if (!data) return error(400, "A JSON message is required");
    const explicitAction=pathname==='/api/chat/actions';
    const control=explicitAction?chatControl(data.action):undefined;
    if(explicitAction&&!control)return error(400,'Choose a valid reviewed action.');
    if(control?.recentAuth){
      await requireFreshWorkspace(env.DB,user.id);
      if(!(await env.AUTH_LIMITER.limit({key:'app-recovery:'+user.id})).success)return error(429,'Too many recovery changes. Try again in a minute.');
    }
    const result = await (explicitAction?sendChatControl:sendConversation)(env.DB, user.id, data, configuredAI(env),{transport,githubTransport:transport,background:promise=>ctx.waitUntil(promise),cmsPublication:(turn,content)=>cmsWordPressCommand(env.DB,user.id,turn,content,env as unknown as Record<string,unknown>)??cmsDiscardCommand(env.DB,user.id,turn,content,env as unknown as Record<string,unknown>)??cmsUnpublishCommand(env.DB,user.id,turn,content,env as unknown as Record<string,unknown>)??cmsPublicationCommand(env.DB,user.id,turn,content,env as unknown as Record<string,unknown>),cmsContent:(action,id)=>cmsWordPressAction(env.DB,user.id,action,id,env as unknown as Record<string,unknown>)??cmsContentAction(env.DB,user.id,action,id,env as unknown as Record<string,unknown>),cms:project=>readCMSStatus(env.DB,user.id,project,env as unknown as Record<string,unknown>),backendRuntime:env.BACKEND_RUNTIME,config:cloudflareConfig(env),hostingReady:!!hostingConfig(env),hosting:hostingConfig(env),github:githubConfig(env),files:env.FILES,healthChecks:String(env.ENVIRONMENT)!=='local'});
    return result.error ? error(result.status, result.error) : json(await readChat(env.DB, user.id, !!configuredAI(env)));
  }
  if (method === "GET" && pathname === "/api/projects") {
    const { results } = await env.DB.prepare("SELECT id,name,purpose,service_status AS status,site_live,backend_live,cms_articles,created_at,updated_at FROM project_service_status WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT 100")
      .bind(user.id).all<Project>();
    return json({ projects: results });
  }
  if (method === "POST" && pathname === "/api/projects") {
    const data = await body(request);
    const name = typeof data?.name === "string" ? data.name.trim() : "";
    const purpose = typeof data?.purpose === "string" ? data.purpose.trim() : "";
    if (!name || name.length > 100 || purpose.length > 1000) return error(400, "Name is required and must be 100 characters or fewer");
    const now = new Date().toISOString();
    const project: Project = { id: crypto.randomUUID(), name, purpose, status: "draft", created_at: now, updated_at: now };
    try { await env.DB.batch([
      env.DB.prepare("INSERT INTO projects (id, owner_user_id, name, purpose, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(project.id, user.id, name, purpose, project.status, now, now),
      env.DB.prepare("INSERT INTO activity_events (id, user_id, project_id, action, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, project.id, "project.created", `Created project ${name}`, now)
    ]); } catch (cause) {
      if (String(cause).includes("project_quota")) return error(409, "The test platform allows 20 projects per account");
      throw cause;
    }
    return json({ project }, 201);
  }
  const detailsMatch=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/details$/);
  if(detailsMatch&&method==='GET')return json(await readProjectDetails(env.DB,user.id,detailsMatch[1]));
  if(detailsMatch&&method==='PATCH')return json(await saveProjectDetails(env.DB,user.id,detailsMatch[1],await body(request)));
  const projectMatch = pathname.match(/^\/api\/projects\/([0-9a-f-]{36})$/);
  if (method === "GET" && projectMatch) {
    const project = await env.DB.prepare("SELECT id,name,purpose,service_status AS status,site_live,backend_live,cms_articles,created_at,updated_at FROM project_service_status WHERE id = ? AND owner_user_id = ?")
      .bind(projectMatch[1], user.id).first<Project>();
    return project ? json({ project }) : error(404, "Project not found");
  }
  if (method === "GET" && pathname === "/api/activity") {
    const { results } = await env.DB.prepare("SELECT id, project_id, action, summary, created_at FROM activity_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(user.id).all();
    return json({ activity: results });
  }
  return error(404, "Not found");
}

export default {
  async scheduled(_event: ScheduledController, env: Env) {
    const imports={name:'imports' as const,run:()=>scanBackendImports(env.DB)};
    if(_event.cron==='47 * * * *'){
      await runMaintenance(env.DB,[imports,{name:'chat_drafts',run:()=>cleanupInteractionDrafts(env.DB)},
      {name:'identity',run:()=>cleanIdentityCeremonies(env.DB)},{name:'hosting',enabled:!!hostingConfig(env),run:()=>maintainHosting(env.DB,hostingConfig(env))},{name:'health',run:()=>maintainHealth(env.DB)}]);return;
    }
    await runMaintenance(env.DB,[imports,{name:'chat_drafts',run:()=>cleanupInteractionDrafts(env.DB)},
      {name:'identity',run:()=>cleanIdentityCeremonies(env.DB)},
      {name:'fair_use',run:()=>cleanupFairUseObservations(env.DB)},
      {name:'traffic',run:()=>cleanupTraffic(env.DB)},
      {name:'applications',run:()=>cleanupAppLifecycle(env.DB)},
      {name:'contacts',run:()=>cleanupContacts(env.DB)},
      {name:'photos',run:()=>cleanupPhotos(env)},
      {name:'github',enabled:!!githubConfig(env),run:()=>cleanupGitHub(env.DB,githubConfig(env))},
      {name:'cloudflare',enabled:!!cloudflareConfig(env),run:()=>cleanupCloudflare(env.DB,cloudflareConfig(env))},
    ]);
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = crypto.randomUUID();
    if(String(env.ENVIRONMENT)!=='local'&&new URL(request.url).origin!=='https://whumpo.com')return error(404,'Not found');
    try {
      const contactMatch=new URL(request.url).pathname.match(/^\/contact\/([0-9a-f-]{36})$/);
      if(contactMatch)return contactPage(request,env,contactMatch[1]);
      if (new URL(request.url).pathname.startsWith("/api/")) return comparisonErrorResponse(request,await handle(request, env, ctx));
      return env.ASSETS.fetch(request);
    } catch (cause) {
      if(String(cause).includes('connection_write_key_changed'))return comparisonErrorResponse(request,error(503,new ConnectionVaultError('write-key').message));
      if(cause instanceof WorkspaceViewError)return comparisonErrorResponse(request,json({error:cause.message,code:cause.code},cause.status));
      if(cause instanceof IdentityError)return comparisonErrorResponse(request,json({error:cause.message,code:cause.code},cause.status));
      if (cause instanceof FeatureInclusionError || cause instanceof CMSProjectError || cause instanceof BackendError || cause instanceof DirectoryError || cause instanceof HealthError || cause instanceof DiffError || cause instanceof ContactError || cause instanceof ConnectionError || cause instanceof ConnectionVaultError || cause instanceof DomainError || cause instanceof BillingError || cause instanceof FileError || cause instanceof StorageLimitError) return comparisonErrorResponse(request,error(cause.status, cause.message));
      console.error(JSON.stringify({ event: "request.failed", requestId, category: "unexpected" }));
      return comparisonErrorResponse(request,json({ error: "Internal error", requestId }, 500));
    }
  }
} satisfies ExportedHandler<Env>;
