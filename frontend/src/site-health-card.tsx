import {useRef,useState} from 'react';
import type {ProjectDiagnostics,SiteDiagnosticsFacts} from '../../src/site-diagnostics-shape';
import {Button} from './components/ui/button';
import {message,send} from './lib/api';

const when=(value:string|null)=>value?<time dateTime={value}>{new Date(value).toLocaleString()}</time>:<span>no evidence yet</span>;
const mark={ok:'OK',info:'Note',attention:'Needs attention'} as const;
const word=(value:string)=>value.replaceAll('_',' ');
/** Owner diagnostics. Publication, domain, form and traffic are separate rows with their own evidence time so a measurement gap
 * is never read as a site fault (or the reverse). Recommended commands are shown exactly as the owner would send them in Chat;
 * the one button runs the same owner health check as `/check-site` and nothing else. */
export function SiteHealthCard({facts,projectId,onChanged}:{facts:SiteDiagnosticsFacts;projectId:string|null;onChanged?:()=>void}){
 const [error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),lock=useRef(false);
 async function check(id:string){if(lock.current)return;lock.current=true;setBusy(id);setError('');try{await send(`/projects/${id}/health`);onChanged?.();}catch(e){setError(message(e));}finally{setBusy(null);lock.current=false;}}
 if(!facts.items.length)return <p className="text-sm text-muted-foreground">{projectId?'This project is not available.':'Projects appear here once you have one.'}</p>;
 return <div className="space-y-6">{facts.items.map(p=><ProjectHealth key={p.projectId} p={p} busy={busy===p.projectId} onCheck={onChanged&&p.publication.state==='published'?()=>void check(p.projectId):undefined}/>)}{error&&<p role="alert" className="text-sm">{error}</p>}
  <p className="text-xs text-muted-foreground">Checks describe one moment at the shared address and the saved records shown. They do not test visitor forms, browser layout, accessibility or availability from every location, and no visitor identifiers or form contents appear here. Health results are kept {facts.retentionDays} days; a healthy result older than {facts.healthEvidenceMaxAgeHours} hours is labeled stale. Traffic is retained {facts.retentionDays} days.</p></div>;
}
function ProjectHealth({p,busy,onCheck}:{p:ProjectDiagnostics;busy:boolean;onCheck?:()=>void}){
 const rows:[string,string,string|null,string][]=[
  ['Publication',p.publication.state==='published'?`Published · version ${p.publication.versionId} · revision ${p.publication.revision}`:'Not published',p.publication.evidenceAt,'Version saved'],
  ['Website check',word(p.health.status),p.health.evidenceAt,'Last check'],
  ['Domain',p.domain.state==='none'?'No custom domain':`${word(p.domain.state)}${p.domain.hostname?' · '+p.domain.hostname:''}${p.domain.certificateStatus?' · TLS '+word(p.domain.certificateStatus):''}`,p.domain.evidenceAt,'Last status'],
  ['Forms',`${word(p.form.state)} · contact ${word(p.form.contact)} · ${p.form.submissionsRetained} retained message(s)`,p.form.evidenceAt,'Last message'],
  ['Traffic',`${word(p.traffic.state)} · ${p.traffic.requests.toLocaleString()} counted · ${p.traffic.excludedRequests.toLocaleString()} automated excluded · ${p.traffic.missedMeasurements.toLocaleString()} missed`,p.traffic.evidenceAt,'Read']];
 return <section aria-label={p.name+' site health'} className="space-y-3 rounded-md bg-background p-4"><p className="font-semibold break-words">{p.name}</p>
  <dl className="space-y-2 text-sm">{rows.map(([label,value,at,evidence])=><div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">{label}</dt><dd className="text-right break-words">{value}<br/><span className="text-xs text-muted-foreground">{evidence}: {when(at)}</span></dd></div>)}</dl>
  <ul className="space-y-2 text-sm">{p.findings.filter(f=>f.severity!=='ok').map(f=><li key={f.code}><span className="font-medium">{mark[f.severity]} · {f.area}.</span> {f.message}{f.action&&<> <span className="block text-xs text-muted-foreground">{f.action.label}: <code>{f.action.command}</code></span></>}</li>)}</ul>
  {onCheck&&<Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={onCheck}>{busy?'Checking…':'Check this website now'}</Button>}
 </section>;
}
