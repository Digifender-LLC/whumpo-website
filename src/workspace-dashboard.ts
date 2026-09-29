import {readTraffic} from './site-traffic';
import { BillingError, getBilling } from './billing';
import {capacityPolicy} from './capacity-policy';
export const widgetKinds=['projects','usage','storage','activity','traffic','cms','performance'] as const;
export type WidgetKind=typeof widgetKinds[number];
export type WorkspaceLayout={widgets:WidgetKind[];tabs:{id:string;label:string;projectId:string|null;widgets:WidgetKind[]}[]};
export const defaultLayout:WorkspaceLayout={widgets:['projects','usage','activity'],tabs:[]};
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
function widgets(value:unknown):value is WidgetKind[]{return Array.isArray(value)&&value.length>0&&value.length<=7&&new Set(value).size===value.length&&value.every(v=>widgetKinds.includes(v));}
export function parseLayout(value:unknown):WorkspaceLayout{
 if(!object(value)||!exact(value,['widgets','tabs'])||!widgets(value.widgets)||!Array.isArray(value.tabs)||value.tabs.length>8)throw new BillingError(400,'Choose up to eight tabs and seven supported cards');
 const ids=new Set();
 for(const tab of value.tabs){
  if(!object(tab)||!exact(tab,['id','label','projectId','widgets'])||typeof tab.id!=='string'||!/^tab-[a-z0-9-]{1,40}$/.test(tab.id)||ids.has(tab.id)||typeof tab.label!=='string'||!tab.label.trim()||tab.label.length>40||/[\x00-\x1f\x7f]/.test(tab.label)||!(tab.projectId===null||typeof tab.projectId==='string'&&/^[0-9a-f-]{36}$/.test(tab.projectId))||!widgets(tab.widgets))throw new BillingError(400,'Invalid workflow tab');
  ids.add(tab.id);
 }
 return value as unknown as WorkspaceLayout;
}
export async function readLayout(db:D1Database,user:string){
 const row=await db.prepare('SELECT revision,layout_json FROM workspace_preferences WHERE user_id=?').bind(user).first<{revision:number;layout_json:string}>();
 return {revision:row?.revision??0,layout:row?JSON.parse(row.layout_json) as WorkspaceLayout:defaultLayout};
}
export async function saveLayout(db:D1Database,user:string,revision:unknown,value:unknown){
 const layout=parseLayout(value);
 if(!Number.isSafeInteger(revision)||Number(revision)<0)throw new BillingError(400,'Invalid dashboard revision');
 for(const tab of layout.tabs)if(tab.projectId&&!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(tab.projectId,user).first())throw new BillingError(404,'Project not found');
 await db.prepare('INSERT OR IGNORE INTO workspace_preferences(user_id,layout_json,updated_at) VALUES(?,?,?)').bind(user,JSON.stringify(defaultLayout),new Date().toISOString()).run();
 const result=await db.prepare('UPDATE workspace_preferences SET revision=revision+1,layout_json=?,updated_at=? WHERE user_id=? AND revision=?').bind(JSON.stringify(layout),new Date().toISOString(),user,revision).run();
 if(result.meta.changes!==1)throw new BillingError(409,'The dashboard changed. Refresh before editing.');
 return readLayout(db,user);
}
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
export async function dashboardData(db:D1Database,user:string){
 const [layout,billing,capacity,projects,activity,storage,traffic]=await Promise.all([
  readLayout(db,user),getBilling(db,user),readCapacity(db,user),
  db.prepare('SELECT id,name,service_status AS status,site_live,backend_live,cms_articles FROM project_service_status WHERE owner_user_id=? ORDER BY updated_at DESC LIMIT 20').bind(user).all(),
  db.prepare('SELECT project_id,summary,created_at FROM activity_events WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(user).all(),
  db.prepare("SELECT f.project_id,COUNT(*) AS files,SUM(f.size) AS bytes FROM project_files f JOIN projects p ON p.id=f.project_id WHERE p.owner_user_id=? AND f.status='ready' GROUP BY f.project_id").bind(user).all(),readTraffic(db,user)
 ]);
 return {...layout,billing,capacity,projects:projects.results,activity:activity.results,storage:storage.results,measuredAt:new Date().toISOString(),traffic,performance:null};
}
export async function workspaceAction(db:D1Database,user:string,action:Record<string,unknown>){
 if(action.operation==='read'&&exact(action,['kind','operation']))return {reply:JSON.stringify(await readLayout(db,user)),statements:[] as D1PreparedStatement[]};
 if(action.operation==='save'&&exact(action,['kind','operation','revision','layout'])){const result=await saveLayout(db,user,action.revision,action.layout);return {reply:'Workspace updated. Dashboard cards and workflow tabs are saved (revision '+result.revision+'). Missing metrics remain marked unavailable. Your account controls remain available.',statements:[] as D1PreparedStatement[]};}
 throw new BillingError(400,'Unsupported dashboard action');
}
