import {copyJSON} from './project-specification/v2/json';
import {workspaceShortcuts,type WorkspaceShortcut} from './workspace-shortcuts';
/** Current maintained component registry; bindings own data, never layout JSON. */
export const viewComponents={
 projects:{version:1,binding:'project.status@1',feature:'core.editing'},usage:{version:1,binding:'account.usage@1',feature:'core.editing'},
 storage:{version:1,binding:'project.storage@1',feature:'core.editing'},activity:{version:1,binding:'owner.activity@1',feature:'core.editing'},
 traffic:{version:1,binding:'project.traffic@1',feature:'core.insights'},cms:{version:1,binding:'cms.status@1',feature:'core.editing'},
 reviews:{version:1,binding:'workspace.reviews@1',feature:'core.editing'},
 performance:{version:1,binding:'project.performance@1',feature:'core.insights'},
 // WH-151: managing existing guest links needs identity and ownership only, exactly as the HTTP handlers do, so it
 // stays available after plan or feature inclusion ends. Issuance re-checks creator.guest-feedback in its own handler.
 'guest-previews':{version:1,binding:'project.guest-previews@1',feature:null},
 // WH-037: saved health, domain, form and measurement-quality facts for owned projects. Like the HTTP health report it needs
 // identity and ownership only, so a problem stays diagnosable when insight inclusion ends. Traffic counts keep their own gate.
 'site-health':{version:1,binding:'project.site-health@1',feature:null},
 // WH-125: configured/registered module instance states for one owned project. Identity and ownership only, so owner
 // read and disable stay available after plan loss; activation handlers re-check inclusion. No visitor values.
 modules:{version:1,binding:'module.instances@1',feature:null},
 // WH-126: staff roster per registered access instance (opaque visitor ids, dates, staff state). Identity and ownership
 // only, so owners can read and remove roles after plan loss; granting re-checks core.editing. No credentials or values.
 'access-roles':{version:1,binding:'access.roles@1',feature:null},
 // WH-127: records counts per registered records instance (states, revisions, counts by submitter kind). Identity and
 // ownership only, so owners keep collected-data status after plan loss. Never field labels, values or visitor ids.
 'records-summary':{version:1,binding:'records.summary@1',feature:null},
 // WH-093: lead counts by stage per records instance (counts only; never a note, due date or value). Identity and ownership only, so it survives plan loss.
 'records-leads-summary':{version:1,binding:'records.leads-summary@1',feature:null}
} as const;
export type WidgetKind=keyof typeof viewComponents;
export const widgetKinds=Object.keys(viewComponents) as WidgetKind[];
export type WorkspaceView={version:1;projectId:string|null;widgets:WidgetKind[];shortcuts:WorkspaceShortcut[]};
export type WorkspaceTab={id:string;label:string;view:WorkspaceView};
export type WorkspaceLayout={version:1;dashboard:WorkspaceView;tabs:WorkspaceTab[]};
export const defaultLayout:WorkspaceLayout={version:1,dashboard:{version:1,projectId:null,widgets:['projects','usage','activity'],shortcuts:[]},tabs:[]};
export class WorkspaceViewError extends Error{constructor(readonly status:number,readonly code:string,message:string){super(message);}}
const invalid=()=>new WorkspaceViewError(400,'invalid_view','Choose a supported current view, scope and operation.');
const copy=(input:unknown,limit:number)=>{try{return copyJSON(input,limit);}catch{throw invalid();}};
export const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const pageId=(v:unknown):v is string=>typeof v==='string'&&/^tab-[a-z0-9-]{1,40}$/.test(v);
const label=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v===v.trim()&&v.length<=40&&!/[\x00-\x1f\x7f]/.test(v);
export function parseView(input:unknown):WorkspaceView{
 const v=copy(input,12000);if(!object(v)||!exact(v,['version','projectId','widgets','shortcuts'])||v.version!==1||!(v.projectId===null||uuid(v.projectId))||!Array.isArray(v.widgets)||!v.widgets.length||v.widgets.length>widgetKinds.length||new Set(v.widgets).size!==v.widgets.length||v.widgets.some(k=>typeof k!=='string'||!Object.hasOwn(viewComponents,k))||!Array.isArray(v.shortcuts)||v.shortcuts.length>5||new Set(v.shortcuts).size!==v.shortcuts.length||v.shortcuts.some(k=>typeof k!=='string'||!Object.hasOwn(workspaceShortcuts,k))||v.shortcuts.length>0&&!v.projectId)throw invalid();
 return v as WorkspaceView;
}
export function parseTab(input:unknown):WorkspaceTab{if(!object(input)||!exact(input,['id','label','view'])||!pageId(input.id)||!label(input.label))throw invalid();return {id:input.id,label:input.label,view:parseView(input.view)};}
export function parseLayout(input:unknown):WorkspaceLayout{
 const v=copy(input,12000);if(!object(v)||!exact(v,['version','dashboard','tabs'])||v.version!==1||!Array.isArray(v.tabs)||v.tabs.length>8)throw invalid();
 const dashboard=parseView(v.dashboard),tabs=v.tabs.map(parseTab);if(dashboard.projectId!==null||dashboard.shortcuts.length||new Set(tabs.map(t=>t.id)).size!==tabs.length)throw invalid();return {version:1,dashboard,tabs};
}
type Base={version:1;requestId:string;expectedRevision:number};
export type LayoutChange=Base&(
 {operation:'setDashboard';view:WorkspaceView}|{operation:'createPage';page:WorkspaceTab}|{operation:'updatePage';pageId:string;view:WorkspaceView}|
 {operation:'renamePage';pageId:string;label:string}|{operation:'removePage';pageId:string}|{operation:'undo';receiptRevision:number});
export function parseLayoutChange(input:unknown):LayoutChange{
 const r=copy(input,14000);if(!object(r)||r.version!==1||!uuid(r.requestId)||!Number.isSafeInteger(r.expectedRevision)||Number(r.expectedRevision)<0)throw invalid();
 const base=['version','requestId','expectedRevision','operation'];
 if(r.operation==='setDashboard'&&exact(r,[...base,'view'])){const view=parseView(r.view);if(view.projectId!==null||view.shortcuts.length)throw invalid();return {...r,view} as LayoutChange;}
 if(r.operation==='createPage'&&exact(r,[...base,'page']))return {...r,page:parseTab(r.page)} as LayoutChange;
 if(r.operation==='updatePage'&&exact(r,[...base,'pageId','view'])&&pageId(r.pageId))return {...r,view:parseView(r.view)} as LayoutChange;
 if(r.operation==='renamePage'&&exact(r,[...base,'pageId','label'])&&pageId(r.pageId)&&label(r.label))return r as LayoutChange;
 if(r.operation==='removePage'&&exact(r,[...base,'pageId'])&&pageId(r.pageId))return r as LayoutChange;
 if(r.operation==='undo'&&exact(r,[...base,'receiptRevision'])&&Number.isSafeInteger(r.receiptRevision)&&Number(r.receiptRevision)>0)return r as LayoutChange;
 throw invalid();
}
