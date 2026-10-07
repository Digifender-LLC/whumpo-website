import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import type {RecordsSetupFacts,RecordsSummaryFacts} from '../../src/shared-modules/shape';
import {api,message} from './lib/api';
import {useWorkspace} from './workspace';
import {Button} from './components/ui/button';
import {Section} from './workspace-pages';
import {ConfirmButton,ProjectSelect,QueryStatus,StaleProject,useProjectSelection} from './workspace-controls';

type Item=RecordsSummaryFacts['items'][number];
type RecordPage={resourceId:string;recordId:string;configRevision:number;removal?:'contact';fields:{key:string;label:string;type:string}[];
 items:{entryId:string;revision:number;createdAt:string;updatedAt:string;submittedBy:'public'|'visitor'|'staff';visitorId:string|null;values:Record<string,unknown>;attachments:{fileId:string}[]}[];next:string|null};
const states={inactive:'Disabled',active:'Active',suspended:'Suspended',migrating:'Migrating'} as const;
const who={public:'Anonymous form',visitor:'Visitor',staff:'Staff'} as const;
const total=(s:Item['schemas'][number])=>s.records.public+s.records.visitor+s.records.staff;
const shown=(v:unknown)=>typeof v==='boolean'?(v?'Yes':'No'):String(v);

/** WH-127 `records.summary@1` card: counts per records instance and schema, never a value. Opening the private records
 * panel is a navigation only; values are read there from the owner list route, not through Chat or this binding. */
export function RecordsSummaryCard({facts,projectId}:{facts:RecordsSummaryFacts;projectId:string}){
 return <div className="space-y-4">{facts.items.map(i=><section key={i.resourceId} aria-label={i.localId+' records'} className="space-y-2 rounded-md bg-background p-4 text-sm">
   <p className="font-semibold break-words">{i.localId} · {states[i.state]} · kept {i.retentionDays} days</p>
   <ul className="space-y-1">{i.schemas.map(s=><li key={s.recordId}>{s.recordId}: {total(s)} record{total(s)===1?'':'s'} ({s.records.public} anonymous, {s.records.visitor} visitor, {s.records.staff} staff)</li>)}</ul>
   {i.forms.length>0&&<p className="text-muted-foreground">Forms: {i.forms.map(f=>`${f.formId} (${f.submit})`).join(', ')}</p>}
  </section>)}
  <Button asChild variant="secondary" className="min-h-11"><Link to="/workspace/$view" params={{view:'records'}} search={{project:projectId}}>Open form records</Link></Button>
  <p className="text-xs text-muted-foreground">Submitted values stay in the private records panel. They are not shown in Chat or sent to AI.</p>
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
   {summary.data&&<EnquirySetup key={project} facts={summary.data.setup} project={project} active={summary.data.items.some(i=>i.localId===summary.data!.setup.instanceId&&i.state==='active')}/>}
   {summary.data&&!options.length&&<p className="text-sm text-muted-foreground">No form records are set up for this project yet.</p>}
   {options.length>0&&<label className="flex flex-col gap-2 text-sm font-medium">Records<select value={current} onChange={e=>setSelected(e.target.value)} className="h-11 px-3 border rounded-md bg-card">{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
   {current&&<RecordList key={project+current} project={project} resourceId={current.split('/')[0]} recordId={current.split('/')[1]} onChanged={()=>void summary.refetch()}/>}
  </>}
  <p className="text-xs text-muted-foreground">Saved records expire after their configured retention period. Staff and visitors can only read what the form allows. Submitted values stay out of Chat and AI.</p>
 </div>;
}

/** Fixed template authoring controls hand off to the existing exact Chat review; no visitor values are sent. */
function EnquirySetup({facts,project,active}:{facts:RecordsSetupFacts;project:string;active:boolean}){
 const {runAction,commandBusy}=useWorkspace(),lock=useRef(false),[selected,setSelected]=useState(''),[error,setError]=useState('');
 const attachment=facts.attachmentCollections.find(c=>c.instanceId+'/'+c.collectionId===selected)??null;
 async function review(activate:boolean){
  if(lock.current)return;lock.current=true;setError('');
  try{await runAction(activate?{type:'moduleActivationReview',projectId:project,instanceId:facts.instanceId!,action:'activate'}:{type:'recordsModuleReview',projectId:project,attachment});}
  catch(e){setError(message(e));}finally{lock.current=false;}
 }
 return <Section title="Visitor enquiries"><div className="space-y-3 text-sm">
  {facts.state==='website-required'&&<p>Save a private website configuration before setting up enquiries.</p>}
  {facts.state==='access-required'&&<p>Set up and activate current <Link to="/workspace/$view" params={{view:'visitors'}} search={{project}} className="underline">visitor access</Link> first.</p>}
  {facts.state==='unavailable'&&<p>Enquiry setup is unavailable for the current configuration.</p>}
  {facts.state==='not-configured'&&<>
   <p>Set up a private enquiry form for signed-in visitors with Name and Message fields, up to 300 characters each. You and authorized staff can read enquiries; visitors can read their own. Records expire after 90 days.</p>
   <label className="flex flex-col gap-2 font-medium">Optional photo attachments<select className="h-11 px-3 border rounded-md bg-card" value={attachment?selected:''} onChange={e=>setSelected(e.target.value)}>
    <option value="">No attachments</option>{facts.attachmentCollections.map(c=><option key={c.instanceId+'/'+c.collectionId} value={c.instanceId+'/'+c.collectionId}>{c.instanceId} · {c.collectionId}</option>)}
   </select></label>
   <p className="text-muted-foreground">Attachments require the visitor's own approved uploads in an active collection. Saving and activation are separate reviews in Chat.</p>
   <Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void review(false)}>Set up visitor enquiries</Button>
  </>}
  {(facts.state==='saved'||facts.state==='registered')&&<>
   <p>{facts.state==='registered'&&active?'Visitor enquiries are active.':'The enquiry configuration is saved. Review its activation to enable submissions.'} This setup does not publish a visitor page or grant anyone access.</p>
   {(facts.state==='saved'||!active)&&<Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void review(true)}>Review enquiry activation</Button>}
  </>}
  {error&&<p role="alert">{error}</p>}
 </div></Section>;
}

function RecordList({project,resourceId,recordId,onChanged}:{project:string;resourceId:string;recordId:string;onChanged:()=>void}){
 const [cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),pending=useRef(new Map<string,string>());
 const q=useQuery({queryKey:['module-records',project,resourceId,recordId,cursor],queryFn:()=>api<RecordPage>(`/projects/${project}/module-records/${resourceId}/${recordId}${cursor?'?after='+encodeURIComponent(cursor):''}`),gcTime:0});
 async function remove(entryId:string){
  setError('');
  const requestId=pending.current.get(entryId)??crypto.randomUUID();pending.current.set(entryId,requestId);
  try{
   if(q.data!.removal==='contact')await api(`/contact-messages/${entryId}`,{method:'DELETE'});
   else await api(`/projects/${project}/modules`,{method:'POST',body:JSON.stringify({api:'whumpo-modules',version:1,operation:'records.remove',resourceId,configRevision:q.data!.configRevision,requestId,target:{recordId,entryId},input:null})});
   pending.current.delete(entryId);await q.refetch();onChanged();
  }catch(e){setError(message(e));throw e;}
 }
 return <div className="space-y-4"><QueryStatus pending={q.isPending} error={q.error}/>
  {q.data?.items.map(item=><Section key={item.entryId} title={who[item.submittedBy]+' · '+new Date(item.createdAt).toLocaleString()}>
   <dl className="space-y-2 text-sm">{q.data.fields.map(f=><div key={f.key} className="flex flex-wrap gap-x-3"><dt className="text-muted-foreground">{f.label}</dt><dd className="whitespace-pre-wrap break-words">{Object.hasOwn(item.values,f.key)?shown(item.values[f.key]):'—'}</dd></div>)}</dl>
   {item.attachments.length>0&&<section aria-label="Attachments" className="mt-4 grid gap-3 sm:grid-cols-2">{item.attachments.map((attachment,index)=><a key={attachment.fileId} href={'/api/files/'+attachment.fileId} target="_blank" rel="noopener noreferrer" className="block rounded-lg border p-2"><img src={'/api/files/'+attachment.fileId} alt={'Submitted attachment '+(index+1)} loading="lazy" className="max-h-60 w-full object-contain"/></a>)}</section>}
   <div className="mt-4"><ConfirmButton label="Delete record" description="Permanently delete this record? It cannot be restored." run={()=>remove(item.entryId)}/></div>
  </Section>)}
  {q.data&&!q.data.items.length&&<p className="text-sm text-muted-foreground">{cursor?'No more records.':'No records yet.'}</p>}
  {error&&<p role="alert" className="text-sm">{error}</p>}
  <div className="flex flex-wrap gap-2">{cursor&&<Button variant="secondary" onClick={()=>setCursor(null)}>Newest records</Button>}{q.data?.next&&<Button variant="secondary" onClick={()=>setCursor(q.data!.next)}>Older records</Button>}</div>
 </div>;
}
