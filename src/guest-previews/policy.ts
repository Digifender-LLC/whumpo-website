import {hashToken} from '../security';
import {featureRequest,inclusionPredicate} from '../feature-inclusion';

/** WH-092 shared guest-preview policy. Owner (platform Worker) and guest (sites Worker)
 * handlers import only these bounds and predicates; neither imports the other's authority. */
export const guestPreviewFeature='creator.guest-feedback' as const;
/** Issuing a link and every guest read/comment admission use one exact operation, so a
 * project-scoped private-test grant names exactly one scope. Owner listing, revocation and
 * deletion stay outside the paid-feature gate. */
export const guestPreviewOperation='dispatch' as const;
export const guestPreviewLimits=Object.freeze({
 minHours:1,maxHours:168,labelLength:80,nameLength:60,textLength:2000,
 windowSeconds:600,viewsPerWindow:60,feedbackPerWindow:10,feedbackPerLink:200,feedbackPerOwner:2000,
 activeLinksPerProject:20,linksPerProject:200,endedLinkRetentionDays:30,
});
export class GuestPreviewError extends Error{
 constructor(public status:number,message:string){super(message);}
}
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
/** 256 random bits, base64url. Returned to the owner once; only its SHA-256 is stored. */
export function newGuestToken(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export async function guestTokenHash(token:unknown){
 return typeof token==='string'&&tokenPattern.test(token)?hashToken(token):null;
}
export const sha256Hex=(value:string)=>hashToken(value);
/** The owner's current feature inclusion for the link's exact project, without actor identity. */
export function guestInclusion(ownerUserId:string,projectId:string){
 return inclusionPredicate(featureRequest({userId:ownerUserId,projectId,featureId:guestPreviewFeature,operation:guestPreviewOperation}));
}
/** A link serves only while unrevoked, unexpired, its exact version still exists in the same
 * owned project with the pinned digest, and that version is current-format and not held. */
export function guestLinkCurrent(t:string){
 return `${t}.revoked_at IS NULL AND ${t}.expires_at>unixepoch() AND ${t}.version_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM projects gp JOIN site_versions gv ON gv.project_id=gp.id WHERE gp.id=${t}.project_id AND gp.owner_user_id=${t}.owner_user_id AND gv.id=${t}.version_id AND gv.digest=${t}.version_digest)
 AND EXISTS(SELECT 1 FROM project_spec_versions WHERE version_id=${t}.version_id)
 AND NOT EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=${t}.version_id)`;
}
export function guestLinkState(row:{revoked_at:number|null;expires_at:number;version_id:string|null},now=Math.floor(Date.now()/1000)){
 return row.revoked_at!==null?'revoked' as const:row.version_id===null?'removed' as const:row.expires_at<=now?'expired' as const:'active' as const;
}
