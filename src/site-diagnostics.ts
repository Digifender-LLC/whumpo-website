import {listHealth} from './site-health';
import {readTraffic,telemetryText} from './site-traffic';
import type {ProjectDiagnostics,SiteDiagnosticsFacts,Finding,DomainState,HealthStatus} from './site-diagnostics-shape';
export type {ProjectDiagnostics,SiteDiagnosticsFacts,Finding} from './site-diagnostics-shape';

/** WH-037 owner diagnostics over the existing domain handlers. This module is an adapter and classifier only: it owns no table,
 * writes nothing, makes no network or provider call and never starts a check. The one owner-run check (`site-health.check@1`)
 * and the saved report are the same handlers HTTP and Chat use, so identity, ownership, cooldown and daily budget are shared.
 * A model can only show the read view; it can never choose a URL, run a check from this surface or request a provider change. */
export const siteHealthBindings=Object.freeze({
 'project.site-health@1':{mode:'read',scope:'workspace',handler:'readSiteDiagnostics',surface:'view widget site-health (Chat temporary view and saved page)',inclusion:'identity and ownership only',modelContext:'states, counts and timestamps'},
 'site-health.report@1':{mode:'read',scope:'project',handler:'listHealth',surface:'GET /api/site-health; Chat /health [project]; ChatControl shortcut health',inclusion:'identity and ownership only',modelContext:'saved receipt'},
 'site-health.check@1':{mode:'action',scope:'project',handler:'checkHealth',surface:'POST /api/projects/{project}/health; Chat /check-site project; ChatControl shortcut checkWebsite',inclusion:'identity and ownership only; five-minute cooldown and daily platform budget',modelContext:'never from this surface'},
} as const);

type FactRow={id:string;name:string;revision:number|null;version_id:string|null;version_at:string|null;live_form:string|null;form_enabled:number;contact_enabled:number|null;contact_publication:number|null;contact_blocked:number;submissions:number;};
type Connection={id:string;project_id:string;hostname:string;state:string;provider_status:string;ssl_status:string;checked_at:string|null;serve_until:string|null};
type Claim={id:string;project_id:string;hostname:string;expires_at:string;verified_at:string|null};
const token=(v:unknown)=>typeof v==='string'&&/^[a-z0-9_ -]{1,40}$/i.test(v)?v:'';
const iso=(v:string|null)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const connectionStates=new Set(['review','creating','uncertain','provisioning','active','disconnecting','disconnected']);

export function domainFacts(connection:Connection|undefined,claim:Claim|undefined,now:Date):ProjectDiagnostics['domain']&{commandId:string|null;commandKind:'connection'|'claim'|null}{
 const at=now.toISOString();
 if(connection&&connectionStates.has(connection.state)){
  const state:DomainState=connection.state==='active'&&(!connection.serve_until||connection.serve_until<=at)?'needs_check':connection.state as DomainState;
  return {state,hostname:connection.hostname,providerStatus:token(connection.provider_status),certificateStatus:token(connection.ssl_status),evidenceAt:iso(connection.checked_at),commandId:connection.id,commandKind:'connection'};
 }
 if(claim)return {state:claim.expires_at<=at&&!claim.verified_at?'proof_expired':claim.verified_at?'ownership_verified':'awaiting_dns',hostname:claim.hostname,providerStatus:'',certificateStatus:'',evidenceAt:iso(claim.verified_at),commandId:claim.id,commandKind:'claim'};
 return {state:'none',hostname:null,providerStatus:'',certificateStatus:'',evidenceAt:null,commandId:null,commandKind:null};
}

/** Pure classification. Every finding names exactly one area; every action is a fixed owner command (see recommendedCommand). */
export function diagnose(p:Omit<ProjectDiagnostics,'findings'>,domainCommand:{id:string|null;kind:'connection'|'claim'|null}):Finding[]{
 const f:Finding[]=[],id=p.projectId,add=(area:Finding['area'],code:string,severity:Finding['severity'],message:string,action:Finding['action']=null)=>{f.push({area,code,severity,message,action});};
 const check={label:'Check the published website now',command:'/check-site '+id},report={label:'Read the saved health report',command:'/health '+id};
 if(p.publication.state==='unpublished')add('publication','publication.unpublished','info','This website is not published. Page, domain and traffic checks do not apply until a reviewed publication is confirmed.');
 else add('publication','publication.published','ok','Version '+p.publication.versionId+' is the published version (revision '+p.publication.revision+').');
 const h=p.health.status,messages:Partial<Record<HealthStatus,[Finding['severity'],string,Finding['action']]>>={
  not_checked:['attention','No saved page check exists for this publication. A website problem would not be visible yet.',check],
  changed:['attention','The publication, contact page or form changed after the last check, so that result no longer applies.',check],
  interrupted:['attention','The last check started but never finished. Its result is unknown.',check],
  stale:['attention','The last healthy check is older than six hours. The page may have changed since then.',check],
  checking:['info','A check is in progress.',report],
  unhealthy:['attention','The last check failed: '+(p.health.detail??'the published page could not be verified')+' Nothing was rolled back automatically.',check],
  superseded:['info','The last check was overtaken by a publication change.',check],
  healthy:['ok','The last check confirmed the saved version was served at the shared address at that time.',null]};
 if(p.publication.state==='published'&&messages[h]){const [s,m,a]=messages[h]!;add('health','health.'+h,s,m,a);}
 const d=p.domain.state,domainCmd=(kind:'connection'|'claim')=>domainCommand.id&&domainCommand.kind===kind?domainCommand.id:null;
 if(d==='none')add('domain','domain.none','info','No custom domain is connected. The website is served at its shared address only. Page checks never test custom domains.',{label:'List domain proofs',command:'/domains'});
 else{
  const connection=domainCmd('connection'),claim=domainCmd('claim');
  const dns:Record<string,[Finding['severity'],string,Finding['action']]>={
   awaiting_dns:['attention','DNS ownership is not verified yet. Add the exact proof record at your DNS provider, then check it.',claim?{label:'Check the saved domain proof',command:'/verify-domain '+claim}:{label:'List domain proofs',command:'/domains'}],
   ownership_verified:['info','Ownership is verified. Hosting is not connected.',{label:'Read hosting connections',command:'/hosting'}],
   proof_expired:['attention','The domain ownership proof expired. Prepare a fresh proof; nothing was changed at your DNS provider.',{label:'List domain proofs',command:'/domains'}],
   uncertain:['attention','The hosting request outcome is uncertain. Check it before trying again; a duplicate is never created automatically.',connection?{label:'Check this hosting connection',command:'/check-hosting '+connection}:{label:'Read hosting connections',command:'/hosting'}],
   needs_check:['attention','The last hosting status check expired, so routing and TLS are unconfirmed.',connection?{label:'Check this hosting connection',command:'/check-hosting '+connection}:{label:'Read hosting connections',command:'/hosting'}],
   provisioning:['attention','Hostname or TLS certificate validation is still in progress ('+(p.domain.certificateStatus||'status unknown')+'). Traffic may fail until it completes.',connection?{label:'Check this hosting connection',command:'/check-hosting '+connection}:{label:'Read hosting connections',command:'/hosting'}],
   active:['ok','Hosting is active with TLS status "'+(p.domain.certificateStatus||'not reported')+'" at the evidence time.',null],
   review:['info','A hosting connection is waiting for your review.',{label:'Read hosting connections',command:'/hosting'}],
   creating:['info','A hosting connection is being created.',{label:'Read hosting connections',command:'/hosting'}],
   disconnecting:['info','A hosting connection is being removed.',{label:'Read hosting connections',command:'/hosting'}],
   disconnected:['info','The custom domain is disconnected. The shared address is unaffected.',{label:'Read hosting connections',command:'/hosting'}]};
  const [s,m,a]=dns[d];add('domain','domain.'+d,s,m,a);
 }
 if(p.form.contact==='needs_republish')add('form','form.contact_needs_republish','attention','The contact page was enabled for an older publication and is not live. Review contact settings again after publishing.');
 if(p.form.contact==='held')add('form','form.contact_held','attention','The contact page is paused while a safety review is open. No message is accepted.');
 if(p.form.state==='not_live')add('form','form.not_live','attention','A website form was approved but is not live, usually because the website or its tool was republished since. Visitors cannot submit it.');
 else if(p.form.state==='live')add('form','form.live','ok','The website form is live. Submission content is never shown here; only the retained count.');
 else if(p.form.contact==='off')add('form','form.none','info','No contact page or website form is enabled.');
 const t=p.traffic,quiet=t.requests===0;
 add('traffic','traffic.'+t.state,t.state==='complete'?'ok':t.state==='not_published'?'info':'attention',telemetryText[t.state]+(quiet&&!['complete','not_published'].includes(t.state)?' Zero counted requests does not show that nobody visited.':quiet&&t.state==='complete'?' No page requests were counted in this window.':''),t.state==='complete'||t.state==='not_published'?null:{label:'Read the traffic report',command:'/traffic'});
 if(p.publication.state==='published'&&h==='healthy'&&quiet&&t.state==='complete')add('traffic','traffic.healthy_but_quiet','info','The page is healthy but no requests were counted: this points to no visitors rather than a publication, domain or telemetry fault.');
 return f;
}

/** Registry read. Owner-scoped in every query; bounded to twenty projects; reads only saved facts. */
export async function readSiteDiagnostics(db:D1Database,user:string,projectId:string|null=null,now=new Date()):Promise<SiteDiagnosticsFacts>{
 const [health,traffic,facts,connections,claims]=await Promise.all([
  listHealth(db,user,projectId??undefined).catch(error=>{if((error as {status?:number}).status===404)return {projects:[]};throw error;}),
  readTraffic(db,user,projectId,now),
  db.prepare(`SELECT p.id,p.name,s.revision,s.version_id,v.created_at AS version_at,(SELECT id FROM backend_live_forms WHERE project_id=p.id) AS live_form,
   EXISTS(SELECT 1 FROM backend_form_settings f JOIN backend_form_reviews r ON r.id=f.review_id WHERE f.project_id=p.id AND r.status='applied' AND r.enabled=1) AS form_enabled,
   c.enabled AS contact_enabled,c.publication_revision AS contact_publication,EXISTS(SELECT 1 FROM service_client_blocked_contacts b WHERE b.project_id=p.id) AS contact_blocked,
   (SELECT COUNT(*) FROM contact_submissions m WHERE m.project_id=p.id AND m.expires_at>?) AS submissions
   FROM projects p LEFT JOIN publications s ON s.project_id=p.id LEFT JOIN site_versions v ON v.id=s.version_id AND v.project_id=p.id LEFT JOIN contact_settings c ON c.project_id=p.id
   WHERE p.owner_user_id=? AND (? IS NULL OR p.id=?) ORDER BY p.created_at DESC,p.id LIMIT 20`).bind(now.toISOString(),user,projectId,projectId).all<FactRow>(),
  db.prepare('SELECT c.id,c.project_id,c.hostname,c.state,c.provider_status,c.ssl_status,c.checked_at,c.serve_until FROM domain_connections c JOIN projects p ON p.id=c.project_id WHERE p.owner_user_id=? AND c.user_id=? AND (? IS NULL OR p.id=?) ORDER BY c.created_at DESC,c.id LIMIT 100').bind(user,user,projectId,projectId).all<Connection>(),
  db.prepare('SELECT d.id,d.project_id,d.hostname,d.expires_at,d.verified_at FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE p.owner_user_id=? AND (? IS NULL OR p.id=?) ORDER BY d.created_at DESC,d.id LIMIT 100').bind(user,projectId,projectId).all<Claim>()
 ]);
 const healthBy=new Map(health.projects.map(h=>[h.projectId,h])),trafficBy=new Map(traffic.telemetry.projects.map(t=>[t.projectId,t]));
 const first=<T extends {project_id:string}>(rows:T[])=>{const m=new Map<string,T>();for(const r of rows)if(!m.has(r.project_id))m.set(r.project_id,r);return m;};
 const connectionBy=first(connections.results),claimBy=first(claims.results);
 const requests=new Map<string,number>();for(const r of traffic.rows)requests.set(r.project_id,(requests.get(r.project_id)??0)+r.requests);
 const asOf=now.toISOString();
 const items=facts.results.map(row=>{
  const h=healthBy.get(row.id),t=trafficBy.get(row.id),domain=domainFacts(connectionBy.get(row.id),claimBy.get(row.id),now),published=!!row.version_id;
  const contact:ProjectDiagnostics['form']['contact']=row.contact_enabled!==1?'off':row.contact_blocked?'held':row.contact_publication===row.revision?'live':'needs_republish';
  const base:Omit<ProjectDiagnostics,'findings'>={projectId:row.id,name:row.name,
   publication:{state:published?'published':'unpublished',versionId:row.version_id,revision:row.revision,evidenceAt:iso(row.version_at)},
   health:{status:(h?.status??(published?'not_checked':'unpublished')) as HealthStatus,detail:h?.detail?String(h.detail).slice(0,300):null,checkedAt:h?.checkedAt??null,evidenceAt:h?.checkedAt??h?.startedAt??null},
   domain:{state:domain.state,hostname:domain.hostname,providerStatus:domain.providerStatus,certificateStatus:domain.certificateStatus,evidenceAt:domain.evidenceAt},
   form:{state:row.live_form?'live':row.form_enabled?'not_live':'not_enabled',contact,submissionsRetained:row.submissions,evidenceAt:null},
   traffic:{state:t?.state??'unavailable',requests:requests.get(row.id)??0,excludedRequests:t?.excludedRequests??0,missedMeasurements:t?.missedMeasurements??0,windowStart:traffic.telemetry.windowStart,windowEnd:traffic.telemetry.windowEnd,evidenceAt:asOf}};
  return {...base,findings:diagnose(base,{id:domain.commandId,kind:domain.commandKind})};
 });
 return {items,retentionDays:30,healthEvidenceMaxAgeHours:6};
}
