import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import type {RecordsSummaryFacts} from '../../src/shared-modules/shape';
import {api,message} from './lib/api';
import {Button} from './components/ui/button';
import {Section} from './workspace-layout';
import {StateNote} from './view-states';
import {ConfirmButton,ProjectSelect,QueryStatus,StaleProject,useProjectSelection} from './workspace-controls';

type Item=RecordsSummaryFacts['items'][number];
type RecordPage={resourceId:string;recordId:string;configRevision:number;fields:{key:string;label:string;type:string}[];
 items:{entryId:string;revision:number;createdAt:string;updatedAt:string;submittedBy:'public'|'visitor'|'staff';visitorId:string|null;values:Record<string,unknown>}[];next:string|null};
const states={inactive:'Disabled',active:'Active',suspended:'Suspended',migrating:'Migrating'} as const;
const who={public:'Anonymous form',visitor:'Visitor',staff:'Staff'} as const;
const total=(s:Item['schemas'][number])=>s.records.public+s.records.visitor+s.records.staff;
const shown=(v:unknown)=>typeof v==='boolean'?(v?'Yes':'No'):String(v);

/** WH-127 `records.summary@1` card: counts per records instance and schema, never a value. Opening the private records
 * panel is a navigation only; values are read there from the owner list route, not through Chat or this binding. */
export function RecordsSummaryCard({facts,projectId}:{facts:RecordsSummaryFacts;projectId:string}){
 if(!facts.items.length)return <StateNote title="No records module is registered for this project.">Ask Whumpo in Chat to add a form that collects records.</StateNote>;
 return <div className="space-y-4">{facts.items.map(i=><section key={i.localId} aria-label={i.localId+' records'} className="space-y-2 rounded-md bg-surface-sunken p-4 text-body-sm">
   <p className="font-semibold break-words">{i.localId} · {states[i.state]} · kept {i.retentionDays} days</p>
   <ul className="space-y-1">{i.schemas.map(s=><li key={s.recordId}>{s.recordId}: {total(s)} record{total(s)===1?'':'s'} ({s.records.public} anonymous, {s.records.visitor} visitor, {s.records.staff} staff)</li>)}</ul>
   {i.forms.length>0&&<p className="text-ink-muted">Forms: {i.forms.map(f=>`${f.formId} (${f.submit})`).join(', ')}</p>}
  </section>)}
  <Button asChild variant="secondary" className="min-h-11"><Link to="/workspace/$view" params={{view:'records'}} search={{project:projectId}}>Open form records</Link></Button>
  <p className="text-caption text-ink-muted">Submitted values stay in the private records panel. They are not shown in Chat or sent to AI.</p>
 </div>;
}

/** Owner records panel (workspace origin): every field of one schema, newest first, 50 per page, rendered as text only.
 * Data comes only from the owner routes; nothing here is written to Chat history or model context. Removal sends an
 * owner `records.remove` module request and reuses its request id until a result is confirmed. */
export function RecordsPanel(){
 const {project,stale,choose}=useProjectSelection('records');
 const summary=useQuery({queryKey:['module-records-summary',project],queryFn:()=>api<RecordsSummaryFacts>(`/projects/${project}/module-records`),enabled:!!project,gcTime:0});
 const [selected,setSelected]=useState('');
 const options=(summary.data?.items??[]).flatMap(i=>i.schemas.map(s=>({value:i.resourceId+'/'+s.recordId,label:`${i.localId} · ${s.recordId} (${total(s)})`})));
 const current=options.some(o=>o.value===selected)?selected:options[0]?.value??'';
 return <div className="space-y-6 max-w-[900px]"><ProjectSelect value={project} onChange={v=>{setSelected('');choose(v);}}/><StaleProject stale={stale}/>
  {project&&<><QueryStatus pending={summary.isPending} error={summary.error}/>
   {summary.data&&!options.length&&<StateNote title="No records module is registered for this project.">Ask Whumpo in Chat to add a form that collects records.</StateNote>}
   {options.length>0&&<label className="flex flex-col gap-2 text-body-sm font-medium">Records<select value={current} onChange={e=>setSelected(e.target.value)} className="h-11 px-3 border border-line rounded-md bg-surface-raised">{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
   {current&&<RecordList key={project+current} project={project} resourceId={current.split('/')[0]} recordId={current.split('/')[1]} onChanged={()=>void summary.refetch()}/>}
  </>}
  <p className="text-caption text-ink-muted">Records are private to you and expire after the module's retention period. They are not shown in Chat or sent to AI.</p>
 </div>;
}

function RecordList({project,resourceId,recordId,onChanged}:{project:string;resourceId:string;recordId:string;onChanged:()=>void}){
 const [cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),pending=useRef(new Map<string,string>());
 const q=useQuery({queryKey:['module-records',project,resourceId,recordId,cursor],queryFn:()=>api<RecordPage>(`/projects/${project}/module-records/${resourceId}/${recordId}${cursor?'?after='+encodeURIComponent(cursor):''}`),gcTime:0});
 async function remove(entryId:string){
  setError('');
  const requestId=pending.current.get(entryId)??crypto.randomUUID();pending.current.set(entryId,requestId);
  try{
   await api(`/projects/${project}/modules`,{method:'POST',body:JSON.stringify({api:'whumpo-modules',version:1,operation:'records.remove',resourceId,configRevision:q.data!.configRevision,requestId,target:{recordId,entryId},input:null})});
   pending.current.delete(entryId);await q.refetch();onChanged();
  }catch(e){setError(message(e));throw e;}
 }
 return <div className="space-y-4"><QueryStatus pending={q.isPending} error={q.error}/>
  {q.data?.items.map(item=><Section key={item.entryId} title={who[item.submittedBy]+' · '+new Date(item.createdAt).toLocaleString()}>
   <dl className="space-y-2 text-body-sm">{q.data.fields.map(f=><div key={f.key} className="flex flex-wrap gap-x-3"><dt className="text-ink-muted">{f.label}</dt><dd className="whitespace-pre-wrap break-words">{Object.hasOwn(item.values,f.key)?shown(item.values[f.key]):'—'}</dd></div>)}</dl>
   <div className="mt-4"><ConfirmButton label="Delete record" description="Permanently delete this record? It cannot be restored." run={()=>remove(item.entryId)}/></div>
  </Section>)}
  {q.data&&!q.data.items.length&&<StateNote title={cursor?'No more records.':'No records yet.'}>{cursor?'':'Submitted form entries will appear here.'}</StateNote>}
  {error&&<p role="alert" className="text-body-sm">{error}</p>}
  <div className="flex flex-wrap gap-2">{cursor&&<Button variant="secondary" onClick={()=>setCursor(null)}>Newest records</Button>}{q.data?.next&&<Button variant="secondary" onClick={()=>setCursor(q.data!.next)}>Older records</Button>}</div>
 </div>;
}
