import {visitorIdentity} from './app-data';
import {BackendError} from './backend-versions';
import {ContactError} from './contacts';
import {completeVisitorVerification,optInStaff,optOutStaff,removeVisitorAddress,setVisitorAddress,startVisitorVerification,visitorNotificationState} from './notification-recipients';
/**
 * WH-214 visitor-origin notification routes (docs/notifications.md, "Visitor routes"). A closed set of steps under `account/notifications` on the
 * visitor gateway, after its Origin check and per-IP limiter. The visitor, project and staff instance come only from the session cookie
 * (`visitorIdentity`); a body may carry exactly the one field its step names, so a visitor, project, instance, role or consent can never be
 * supplied. No response carries an address: the visitor's own is shown only as a hint, and an address they just submitted is never echoed.
 */
export const notificationSteps=['','address','address/remove','verify/start','verify/complete','staff/opt-in','staff/opt-out'] as const;
export type NotificationStep=typeof notificationSteps[number];
const fields:Record<NotificationStep,string[]>={'':[],address:['address'],'address/remove':[],'verify/start':[],'verify/complete':['code'],'staff/opt-in':[],'staff/opt-out':[]};
export async function appNotifications(db:D1Database,session:string,project:string,step:NotificationStep,data:Record<string,unknown>,options:{ceilingCents?:number;stopped?:boolean}){
 const actor=await visitorIdentity(db,session,project),keys=fields[step];
 if(Object.keys(data).length!==keys.length||!keys.every(k=>Object.hasOwn(data,k)))throw new BackendError(400,'Send only what this step asks for.');
 try{
  let status:string|undefined;
  if(step==='address')await setVisitorAddress(db,project,actor.visitor_id,data.address);
  else if(step==='address/remove')await removeVisitorAddress(db,project,actor.visitor_id);
  else if(step==='verify/start')status=(await startVisitorVerification(db,project,actor.visitor_id,options)).status;
  else if(step==='verify/complete')await completeVisitorVerification(db,project,actor.visitor_id,data.code);
  else if(step==='staff/opt-in')await optInStaff(db,project,actor.access_id,actor.visitor_id);
  else if(step==='staff/opt-out')await optOutStaff(db,project,actor.access_id,actor.visitor_id);
  return {...await visitorNotificationState(db,project,actor.visitor_id),deliveryAvailable:(options.ceilingCents??0)>0,stopped:!!options.stopped,...(status?{status}:{})};
 }catch(cause){if(cause instanceof ContactError)throw new BackendError(cause.status,cause.message);throw cause;}
}
