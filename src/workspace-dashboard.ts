import {readLayout} from './workspace-layout';
export {readLayout,workspaceAction,defaultLayout,parseLayout} from './workspace-layout';
export type {WorkspaceLayout,WidgetKind} from './workspace-view-contract';
import {readTraffic} from './site-traffic';
import {BillingError,getBilling} from './billing';
import {capacityPolicy} from './capacity-policy';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
export async function readCapacity(db:D1Database,user:string){
 const saved=await db.prepare('SELECT revision,preferred_plan,billing_interval,draft_overage_cents FROM capacity_preferences WHERE user_id=?').bind(user).first();
 return {preferences:saved??{revision:0,preferred_plan:'starter',billing_interval:'month',draft_overage_cents:0},policy:capacityPolicy,authorizationActive:false,capacityPercent:null,recommendation:'Infrastructure metering and retail rates are not connected. No paid plan change or overage is authorized.'};
}
export async function saveCapacity(db:D1Database,user:string,value:unknown){
 if(!object(value)||!exact(value,['revision','preferred_plan','billing_interval','draft_overage_cents'])||!Number.isSafeInteger(value.revision)||Number(value.revision)<0||!['starter','personal','business','business-pro'].includes(String(value.preferred_plan))||!['month','year'].includes(String(value.billing_interval))||!Number.isSafeInteger(value.draft_overage_cents)||Number(value.draft_overage_cents)<0||Number(value.draft_overage_cents)>100000)throw new BillingError(400,'Invalid capacity preferences');
 await db.prepare('INSERT OR IGNORE INTO capacity_preferences(user_id,updated_at) VALUES(?,?)').bind(user,new Date().toISOString()).run();
 const r=await db.prepare('UPDATE capacity_preferences SET revision=revision+1,preferred_plan=?,billing_interval=?,draft_overage_cents=?,updated_at=? WHERE user_id=? AND revision=?').bind(value.preferred_plan,value.billing_interval,value.draft_overage_cents,new Date().toISOString(),user,value.revision).run();
 if(r.meta.changes!==1)throw new BillingError(409,'Preferences changed. Refresh before saving.');
 return readCapacity(db,user);
}
/** Shared owned projection; project-specific consumers filter before reading. */
export async function readProjectStatuses(db:D1Database,user:string,projectId:string|null=null){
 return db.prepare('SELECT id,name,service_status AS status,site_live,backend_live,cms_articles FROM project_service_status WHERE owner_user_id=? AND (? IS NULL OR id=?) ORDER BY updated_at DESC LIMIT 20').bind(user,projectId,projectId).all<{id:string;name:string;status:'draft'|'building'|'live'|'error';site_live:number;backend_live:number;cms_articles:number}>();
}
export async function dashboardData(db:D1Database,user:string){
 const [layout,billing,capacity,projects,activity,storage,traffic]=await Promise.all([
  readLayout(db,user),getBilling(db,user),readCapacity(db,user),
  readProjectStatuses(db,user),
  db.prepare('SELECT project_id,summary,created_at FROM activity_events WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(user).all(),
  db.prepare("SELECT f.project_id,COUNT(*) AS files,SUM(f.size) AS bytes FROM project_files f JOIN projects p ON p.id=f.project_id WHERE p.owner_user_id=? AND f.status='ready' GROUP BY f.project_id").bind(user).all(),readTraffic(db,user)
 ]);
 return {...layout,billing,capacity,projects:projects.results,activity:activity.results,storage:storage.results,measuredAt:new Date().toISOString(),traffic,performance:null};
}
