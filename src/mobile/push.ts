// WH-086: owner device registration, withdrawal and the opaque event readback. Same gate as M2/M4 (workspace()); a device is bound to the native
// session LINEAGE, so a native reauthentication keeps it and logout, revocation or the account cascade end it (schema push_devices / push_live_devices).
// Registration needs the explicit activation PUSH_NOTIFICATION_PROVIDER=fcm: until then no delivery address is stored (interim privacy default).
import {seal} from '../connection-vault';
import {hashToken} from '../security';
import type {IdentityPrincipal} from '../workspace-identity/authority';
import {MobileError,ok,readJson,signin,type MobileEnvironment} from './transport';
import {workspace} from './workspace';

export const pushKinds=['review_pending','operation_completed','attention_required'] as const;
export type PushKind=typeof pushKinds[number];
type Row=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
/** FCM registration tokens are ~160 characters of URL-safe text with one colon; bound generously, accept nothing exotic. */
const fcmToken=/^[A-Za-z0-9_:.-]{20,4096}$/;
export const pushActive=(env:{PUSH_NOTIFICATION_PROVIDER?:string})=>env.PUSH_NOTIFICATION_PROVIDER==='fcm';

export const registerDevice=async(request:Request,env:MobileEnvironment,p:IdentityPrincipal)=>{
 const d=await readJson(request,['version','fcmRegistrationToken','notificationsEnabled']);
 if(typeof d.fcmRegistrationToken!=='string'||!fcmToken.test(d.fcmRegistrationToken)||typeof d.notificationsEnabled!=='boolean')throw new MobileError('invalid_request');
 if(!pushActive(env)||!env.CONNECTION_ENCRYPTION_KEYRING)throw new MobileError('unavailable');
 const token=d.fcmRegistrationToken,enabled=d.notificationsEnabled?1:0;
 return workspace(env,p,false,async(scoped,user)=>{
  const s=await scoped.DB.prepare("SELECT lineage_id FROM identity_sessions WHERE id=? AND account_id=? AND client='android'").bind(p.authorityId,user).first<Row>();
  if(!s)throw signin();
  const id=crypto.randomUUID(),sealed=await seal(env.CONNECTION_ENCRYPTION_KEYRING!,`whumpo:push:token:${user}:${s.lineage_id}`,token),hash=await hashToken(token);
  const [,,written]=await scoped.DB.batch([
   // A token has one owner: a re-used or rotated token moves to this lineage. A revoked row is replaced, never revived.
   scoped.DB.prepare('DELETE FROM push_devices WHERE token_hash=? AND lineage_id!=?').bind(hash,s.lineage_id),
   scoped.DB.prepare('DELETE FROM push_devices WHERE lineage_id=? AND revoked_at IS NOT NULL').bind(s.lineage_id),
   scoped.DB.prepare(`INSERT INTO push_devices(id,account_id,lineage_id,platform,token_hash,token_sealed,notifications_enabled,created_at,last_seen_at)
    SELECT ?,s.account_id,s.lineage_id,'android',?,?,?,unixepoch(),unixepoch() FROM identity_sessions s WHERE s.id=? AND s.client='android'
    ON CONFLICT(lineage_id) DO UPDATE SET token_hash=excluded.token_hash,token_sealed=excluded.token_sealed,notifications_enabled=excluded.notifications_enabled,last_seen_at=excluded.last_seen_at
    RETURNING id`).bind(id,hash,sealed,enabled,p.authorityId)
  ]);
  const row=written.results[0] as Row|undefined;
  if(!row)throw signin();
  return ok({deviceId:row.id,preferences:{notificationsEnabled:!!enabled}});
 });
};

export const removeDevice=(env:MobileEnvironment,p:IdentityPrincipal)=>workspace(env,p,false,async(scoped,user)=>{
 await scoped.DB.prepare("DELETE FROM push_devices WHERE account_id=? AND lineage_id IN (SELECT lineage_id FROM identity_sessions WHERE id=? AND account_id=? AND client='android')").bind(user,p.authorityId,user).run();
 return ok({removed:true});
});

/** Another owner's id and an unknown id are the same 404; an owned event whose project is gone or that has expired answers state unavailable with no destination. */
export const readEvent=(env:MobileEnvironment,p:IdentityPrincipal,eventId:string)=>workspace(env,p,false,async(scoped,user)=>{
 if(!uuid.test(eventId))throw new MobileError('not_found');
 const e=await scoped.DB.prepare('SELECT e.kind,p.id AS project_id,e.review_id,e.expires_at FROM push_events e LEFT JOIN projects p ON p.id=e.project_id AND p.owner_user_id=e.account_id WHERE e.id=? AND e.account_id=?').bind(eventId,user).first<Row>();
 if(!e)throw new MobileError('not_found');
 const live=!!e.project_id&&e.expires_at>Math.floor(Date.now()/1000);
 return ok({event:{id:eventId,kind:e.kind,destination:!live?null:e.kind==='review_pending'&&e.review_id?{type:'review',id:e.review_id}:{type:'project',id:e.project_id},state:live?'current':'unavailable'}});
});

/** Content-free event row behind a future notification (ids and a kind only). Nothing sends from here. */
export async function recordPushEvent(db:Pick<D1Database,'prepare'>,e:{accountId:string;kind:PushKind;projectId:string;reviewId?:string|null;ttlSeconds?:number}){
 const id=crypto.randomUUID();
 await db.prepare('INSERT INTO push_events(id,account_id,kind,project_id,review_id,created_at,expires_at) VALUES(?,?,?,?,?,unixepoch(),unixepoch()+?)').bind(id,e.accountId,e.kind,e.projectId,e.reviewId??null,Math.min(e.ttlSeconds??86400,604800)).run();
 return id;
}
