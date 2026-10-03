import {canonicalJSON} from '../project-specification/v2/json';
import {parseView,type WorkspaceView} from '../workspace-view-contract';
import {viewBinding} from '../workspace-view-data';
import type {Definition} from './types';

/** Temporary and saved views use one definition. The Chat wrapper supplies
 * placement and durable dismissal; it cannot add actions or authored markup. */
export function workspaceViewDefinition(input:unknown):Definition&{workspaceView:WorkspaceView}{
 const view=parseView(input);
 if(view.shortcuts.length)throw new Error('Temporary views contain read components only.');
 return {version:1,kind:'view',template:'status@1',title:view.projectId?'Project overview':'Workspace overview',
  summary:'Current saved information. Refresh to check again, or ask Whumpo to change this view or save it as a page.',presentation:'inline',
  fields:[],cards:view.widgets.map(kind=>({id:kind,binding:viewBinding(kind,view.projectId),display:'workspace',limit:20,reviewId:null})),
  submitBinding:null,continuationBinding:null,workspaceView:view};
}
export function isWorkspaceViewDefinition(input:unknown):input is Definition&{workspaceView:WorkspaceView}{
 try{
  if(!input||typeof input!=='object'||!Object.hasOwn(input,'workspaceView'))return false;
  return canonicalJSON(input)===canonicalJSON(workspaceViewDefinition((input as Definition).workspaceView));
 }catch{return false;}
}
