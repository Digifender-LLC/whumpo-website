import {copyJSON} from './project-specification/v2/json';
import {workspaceShortcuts,type WorkspaceShortcut} from './workspace-shortcuts';
/** Current maintained component registry; bindings own data, never layout JSON. */
export const viewComponents={
 projects:{version:1,binding:'project.status@1'},usage:{version:1,binding:'account.usage@1'},
 storage:{version:1,binding:'project.storage@1'},activity:{version:1,binding:'owner.activity@1'},
 traffic:{version:1,binding:'site.traffic@1'},cms:{version:1,binding:'cms.status@1'},
 performance:{version:1,binding:'project.performance@1'}
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
 const v=copy(input,12000);if(!object(v)||!exact(v,['version','projectId','widgets','shortcuts'])||v.version!==1||!(v.projectId===null||uuid(v.projectId))||!Array.isArray(v.widgets)||!v.widgets.length||v.widgets.length>7||new Set(v.widgets).size!==v.widgets.length||v.widgets.some(k=>typeof k!=='string'||!Object.hasOwn(viewComponents,k))||!Array.isArray(v.shortcuts)||v.shortcuts.length>5||new Set(v.shortcuts).size!==v.shortcuts.length||v.shortcuts.some(k=>typeof k!=='string'||!Object.hasOwn(workspaceShortcuts,k))||v.shortcuts.length>0&&!v.projectId)throw invalid();
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
 {operation:'renamePage';pageId:string;label:string}|{operation:'removePage';pageId:string}|{operation:'undo';receiptId:string});
export function parseLayoutChange(input:unknown):LayoutChange{
 const r=copy(input,14000);if(!object(r)||r.version!==1||!uuid(r.requestId)||!Number.isSafeInteger(r.expectedRevision)||Number(r.expectedRevision)<0)throw invalid();
 const base=['version','requestId','expectedRevision','operation'];
 if(r.operation==='setDashboard'&&exact(r,[...base,'view'])){const view=parseView(r.view);if(view.projectId!==null||view.shortcuts.length)throw invalid();return {...r,view} as LayoutChange;}
 if(r.operation==='createPage'&&exact(r,[...base,'page']))return {...r,page:parseTab(r.page)} as LayoutChange;
 if(r.operation==='updatePage'&&exact(r,[...base,'pageId','view'])&&pageId(r.pageId))return {...r,view:parseView(r.view)} as LayoutChange;
 if(r.operation==='renamePage'&&exact(r,[...base,'pageId','label'])&&pageId(r.pageId)&&label(r.label))return r as LayoutChange;
 if(r.operation==='removePage'&&exact(r,[...base,'pageId'])&&pageId(r.pageId))return r as LayoutChange;
 if(r.operation==='undo'&&exact(r,[...base,'receiptId'])&&uuid(r.receiptId))return r as LayoutChange;
 throw invalid();
}
