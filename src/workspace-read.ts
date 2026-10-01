import {photoSafetySQL} from './photo-safety';
import {describeConnections} from './connection-chat';
import type {DNSChatOptions} from './dns-chat';
import {readStandardAIHistory,describeStandardAIHistory} from './standard-ai-history';
import {readProjectDetails} from './project-details';
import {readTraffic,trafficDescription} from './site-traffic';
import {savedPage} from './photo-versions';
import {getBilling} from './billing';
import {domainCommand} from './domains';
import {publicationCommand,siteURL} from './publications';

export const inspectionScopes=['projects','project','versions','version','activity','usage','domains','traffic','connections','photos'] as const;
export type InspectionScope=typeof inspectionScopes[number];
/** Read-only, owner-scoped records. Model text never supplies query fragments or URLs. */
export async function inspectWorkspace(db:D1Database,userId:string,scope:InspectionScope,targetId?:string,options?:DNSChatOptions){
 if(scope==='connections')return describeConnections(db,userId,options);
 if(scope==='photos'){
  const {results}=await db.prepare(`SELECT f.id,f.project_id,f.name,f.status,${photoSafetySQL} safetyStatus,f.width,f.height FROM project_files f JOIN projects p ON p.id=f.project_id WHERE p.owner_user_id=? ORDER BY f.created_at DESC,f.id DESC LIMIT 21`).bind(userId).all();
  return JSON.stringify({type:'photo_metadata',files:results.slice(0,20),hasMore:results.length>20,notice:'Metadata only, not image pixels. Only approved files can be used. Open Photos for the full inventory.'});
 }
 if(scope==='traffic')return trafficDescription(await readTraffic(db,userId));
 if(scope==='usage'){
  const b=await getBilling(db,userId);
  return `${b.plan.name} · ${b.period}\nStandard AI assistance is included under fair use with no credit charges. Advanced-model spending is not enabled. Never suggest buying credits to continue standard work. Testing capacity and provider availability can interrupt service. Subscriptions are sandbox-only; real payments and upgrades are disabled.\n\n${describeStandardAIHistory(await readStandardAIHistory(db,userId))}`;
 }
 if(scope==='domains')return (await domainCommand(db,userId,'', '/domains'))!.reply;
 if(scope==='versions')return (await publicationCommand(db,userId,'', '/versions'+(targetId?' '+targetId:'')))!.reply;
 if(scope==='activity'){
  const {results}=await db.prepare('SELECT summary,created_at FROM activity_events WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 10').bind(userId).all<{summary:string;created_at:string}>();
  return results.map(r=>`${r.created_at}: ${r.summary}`).join('\n')||'No activity yet.';
 }
 if(scope==='projects'){
  const {results}=await db.prepare('SELECT id,name,service_status AS status,site_live,backend_live,cms_articles FROM project_service_status WHERE owner_user_id=? ORDER BY updated_at DESC,id DESC LIMIT 20').bind(userId).all<{id:string;name:string;status:string;site_live:number;backend_live:number;cms_articles:number}>();
  return results.map(p=>`${p.name} — ${p.status}\nProject: ${p.id}${p.site_live?'\n'+siteURL(p.id):''}${p.backend_live?'\nPublic JSON backend · https://'+p.id+'.whumpo.site/backend':''}${p.cms_articles?'\nCMS articles: '+p.cms_articles+' · https://'+p.id+'.whumpo.site/cms':''}`).join('\n\n')||'No projects yet. Tell me what you would like to build.';
 }
 if(scope==='project'){
  const p=await db.prepare('SELECT p.*,s.version_id AS live_version FROM project_service_status p LEFT JOIN publications s ON s.project_id=p.id WHERE p.id=? AND p.owner_user_id=?').bind(targetId??null,userId).first<{id:string;name:string;purpose:string;status:string;audience:string;style_notes:string;preferred_theme:string;live_version:string|null;service_status:string;backend_live:number;cms_articles:number}>();
  if(!p)return 'Project not found.';
  const details=await readProjectDetails(db,userId,p.id);
  const count=await db.prepare('SELECT COUNT(*) AS total FROM site_versions WHERE project_id=?').bind(p.id).first<{total:number}>();
  return `${details.name} — ${p.service_status}\nProject: ${p.id}\nDetails revision: ${details.revision}\nCMS articles: ${p.cms_articles}${p.cms_articles?' · https://'+p.id+'.whumpo.site/cms':''}${p.backend_live?'\nPublic JSON backend · https://'+p.id+'.whumpo.site/backend':''}\nSaved versions: ${count?.total??0}\nLive version: ${p.live_version??'None'}\nIdea: ${details.purpose}\nPrivate audience/goal: ${details.audience||'Not specified'}\nPrivate style notes: ${details.style_notes||'Not specified'}\nStarting theme: ${details.preferred_theme}`;
 }
 const v=await db.prepare('SELECT v.id,v.project_id,v.component_id,v.config_json,v.created_at,p.name,s.version_id AS live_id FROM site_versions v JOIN projects p ON p.id=v.project_id LEFT JOIN publications s ON s.project_id=p.id WHERE v.id=? AND p.owner_user_id=? AND NOT EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=v.id)').bind(targetId??null,userId).first<{id:string;project_id:string;component_id:string;config_json:string;created_at:string;name:string;live_id:string|null}>();
 if(!v)return 'Saved version not found.';
 const page=savedPage(v.component_id,v.config_json);
 return `${v.name}\nVersion: ${v.id}\nProject: ${v.project_id}\n${v.id===v.live_id?'Currently live':'Not currently live'} · ${v.created_at}\nTheme: ${page.theme}\nHeadline: ${page.headline}\nIntroduction: ${page.description}\n${page.aboutTitle}: ${page.aboutText}\n${page.sections.map(s=>s.heading+': '+s.text).join('\n')}${'photos' in page?'\nPhotos: '+page.photos.map(p=>p.alt+' ('+p.id+')').join(', '):''}\n\nThis read does not publish or change the version.`;
}
