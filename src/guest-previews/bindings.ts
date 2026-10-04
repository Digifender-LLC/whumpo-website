import {featureRequest,inclusionPredicate,resolveFeatureInclusion} from '../feature-inclusion';
import {assertWorkspace} from '../workspace-identity/admission';
import {requireSpecificationAvailable} from '../specification-safety';
import {GuestPreviewError,guestPreviewFeature,guestPreviewOperation,sha256Hex} from './policy';
import type {GuestPreviewFacts} from './shape';
import {createGuestPreview,listGuestPreviews,revokeGuestPreview,deleteGuestPreview,issuance,ownedProject} from './owner';

/** WH-151 owner bindings over the WH-150 domain handlers. This module is an adapter only: it owns no
 * table, token, eligibility rule or ownership check. Every effect calls the handler that the HTTP
 * routes call, so Chat, views and HTTP share identity, ownership and inclusion. A model is never a
 * caller: it can only show the read view, and every row below is reachable only from an authenticated
 * owner session (HTTP) or an owner-issued ChatControl. */
export const guestPreviewBindings=Object.freeze({
 'project.guest-previews@1':{mode:'read',scope:'project',handler:'listGuestPreviews',surface:'view widget guest-previews (Chat temporary view and saved page)',inclusion:'identity and ownership only',modelContext:'link state and counts'},
 'guest-preview.feedback@1':{mode:'read',scope:'link',handler:'listGuestFeedback',surface:'GET /api/guest-previews/{link}/feedback',inclusion:'identity and ownership only',modelContext:'never'},
 'guest-preview.prepare@1':{mode:'prepare',scope:'project',handler:'prepareGuestPreviewIssue',surface:'POST /api/projects/{project}/guest-previews/prepare',inclusion:'current creator.guest-feedback dispatch',modelContext:'never'},
 'guest-preview.issue@1':{mode:'confirm',scope:'project',handler:'confirmGuestPreviewIssue',surface:'POST /api/projects/{project}/guest-previews (needs the prepared confirmation)',inclusion:'current creator.guest-feedback dispatch, composed into the insert',modelContext:'never'},
 'guest-preview.revoke@1':{mode:'action',scope:'link',handler:'revokeGuestPreview',surface:'POST /api/guest-previews/{link}/revoke; ChatControl guestPreview/revoke',inclusion:'identity and ownership only',modelContext:'never'},
 'guest-preview.delete@1':{mode:'action',scope:'link',handler:'deleteGuestPreview',surface:'DELETE /api/guest-previews/{link}; ChatControl guestPreview/delete',inclusion:'identity and ownership only',modelContext:'never'},
 'guest-preview.resolve@1':{mode:'action',scope:'comment',handler:'resolveGuestFeedback',surface:'PATCH /api/guest-previews/{link}/feedback/{comment}',inclusion:'identity and ownership only',modelContext:'never'},
 'guest-preview.delete-comment@1':{mode:'action',scope:'comment',handler:'deleteGuestFeedback',surface:'DELETE /api/guest-previews/{link}/feedback/{comment}',inclusion:'identity and ownership only',modelContext:'never'},
} as const);

export type {GuestPreviewFacts};

/** Registered view read. Bounded, read-only (no billing initialization), never comment text, token or hash.
 * Listing needs only identity and ownership, as in HTTP; `canIssue` is informational and the issuance
 * handler re-evaluates inclusion itself. */
export async function readGuestPreviewFacts(db:D1Database,userId:string,projectId:string):Promise<GuestPreviewFacts>{
 const {links}=await listGuestPreviews(db,userId,projectId);
 const gate=inclusionPredicate(featureRequest({userId,projectId,featureId:guestPreviewFeature,operation:guestPreviewOperation}));
 const canIssue=!!await db.prepare(`SELECT 1 WHERE ${gate.sql}`).bind(...gate.params).first();
 const {results}=await db.prepare(`SELECT v.id,v.created_at FROM site_versions v WHERE v.project_id=?
  AND EXISTS(SELECT 1 FROM project_spec_versions WHERE version_id=v.id) AND NOT EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=v.id)
  ORDER BY v.created_at DESC,v.id DESC LIMIT 10`).bind(projectId).all<{id:string;created_at:string}>();
 return {canIssue,versions:results.map(v=>({id:v.id,createdAt:v.created_at})),
  links:links.map(l=>({id:l.id,versionId:l.versionId,label:l.label,feedbackEnabled:l.feedbackEnabled,createdAt:l.createdAt,expiresAt:l.expiresAt,revokedAt:l.revokedAt,state:l.state,feedbackCount:l.feedbackCount,openFeedbackCount:l.openFeedbackCount}))};
}

const confirmationPattern=/^[0-9a-f]{64}$/;
/** Exact readout of what a link would be. Nothing is written and no token exists yet. The confirmation
 * binds owner, project, request ID, exact saved version and its digest, expiry, comment setting and
 * label, so the owner confirms the displayed link and a later change refuses. */
export async function prepareGuestPreviewIssue(db:D1Database,userId:string,projectId:string,value:unknown){
 const input=issuance(value);await ownedProject(db,userId,projectId);
 const project=await db.prepare('SELECT name FROM projects WHERE id=? AND owner_user_id=?').bind(projectId,userId).first<{name:string}>();
 const version=await db.prepare('SELECT id,digest,created_at FROM site_versions WHERE id=? AND project_id=?').bind(input.versionId,projectId).first<{id:string;digest:string;created_at:string}>();
 if(!project||!version)throw new GuestPreviewError(404,'Saved version not found.');
 await requireSpecificationAvailable(db,version.id);
 await assertWorkspace(db,userId);
 if(!(await resolveFeatureInclusion(db,featureRequest({userId,projectId,featureId:guestPreviewFeature,operation:guestPreviewOperation}))).included)
  throw new GuestPreviewError(403,'Guest preview links require Creator or a higher plan, or an explicit scoped test grant. Existing links, feedback and revocation remain available.');
 const confirmation=await sha256Hex(JSON.stringify(['guest-preview-confirm@1',userId,projectId,input.id,version.id,version.digest,input.hours,input.feedback,input.label]));
 return {version:1 as const,readout:{requestId:input.id,project:{id:projectId,name:project.name},savedVersion:{id:version.id,createdAt:version.created_at,digest:version.digest},
  expiresInHours:input.hours,commentsAllowed:input.feedback,label:input.label,
  effect:`Anyone holding the link can view exactly this saved version for ${input.hours} hour(s) from the moment you confirm, without signing in${input.feedback?' and may leave comments':' and cannot comment'}. It cannot be extended. You can revoke it at any time. The link is shown once and cannot be recovered.`},confirmation};
}
/** The only issuance path: the same request fields plus the prepared confirmation. The token is returned
 * by the handler to this caller alone and is never written to Chat, history or any model request. */
export async function confirmGuestPreviewIssue(db:D1Database,userId:string,projectId:string,value:unknown,shareBase:string){
 const v=value as Record<string,unknown>|null;
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.confirmation!=='string'||!confirmationPattern.test(v.confirmation))
  throw new GuestPreviewError(400,'Review the exact link details and confirm them before a link is issued.');
 const {confirmation,...request}=v;
 const prepared=await prepareGuestPreviewIssue(db,userId,projectId,request);
 if(prepared.confirmation!==confirmation)throw new GuestPreviewError(409,'The link details changed since you reviewed them. Review them again before issuing.');
 return createGuestPreview(db,userId,projectId,request,shareBase);
}

/** Owner Chat controls. Command strings are private adapters for sendChatControl; no token, comment text or
 * hash is ever part of a command or its reply, so nothing here reaches history or model context. */
export async function guestPreviewChatCommand(db:D1Database,userId:string,command:string){
 const revoke=/^\/guest-preview-revoke ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(command);
 if(revoke){const {link}=await revokeGuestPreview(db,userId,revoke[1]);return {reply:`Preview link ${link.id} is revoked. Guests can no longer open it or comment. Your saved comments are unchanged.`};}
 const remove=/^\/guest-preview-delete ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) DELETE$/.exec(command);
 if(remove){await deleteGuestPreview(db,userId,remove[1]);return {reply:`Preview link ${remove[1]} and its saved comments were deleted. Guests can no longer open it.`};}
}
