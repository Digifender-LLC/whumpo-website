import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import type {PublicFormState,RecordsSetup,RecordsSummaryFacts} from '../../src/shared-modules/shape';
import {appointmentSetupView} from './lib/appointment-form';
import {APIError,api,message} from './lib/api';
import {Textarea} from './components/ui/textarea';
import {Button} from './components/ui/button';
import {Section} from './workspace-layout';
import {StateNote} from './view-states';
import {useWorkspace} from './workspace';
import {businessNameProblem} from '../../src/business-name';
import {Input} from './components/ui/input';
import {Field} from './workspace-layout';
import {ConfirmButton,ProjectSelect,QueryStatus,StaleProject,useProjectSelection} from './workspace-controls';

type Item=RecordsSummaryFacts['items'][number];
export const stages=['new','contacted','qualified','won','lost'] as const;
export type Stage=typeof stages[number];
export type Lead={stage:Stage;note:string;dueDate:string|null;revision:number};
export type LeadChanges=Partial<{stage:Stage;note:string;dueDate:string|null}>;
type RecordPage={resourceId:string;recordId:string;configRevision:number;fields:{key:string;label:string;type:string}[];leads:{editable:boolean};
 items:{entryId:string;revision:number;createdAt:string;updatedAt:string;submittedBy:'public'|'visitor'|'staff';visitorId:string|null;values:Record<string,unknown>;lead:Lead}[];next:string|null};
export type FormSending='inactive'|'spending-limit-unset'|'active'|'off'|'plan'|'no-recipient'|'contained';
export type Setup={delivery:'inactive'|'spending-limit-unset'|'active';forms:{instanceId:string;formId:string;notices:{owner:boolean;staff:boolean;receipt:boolean};businessName:string;revision:number;sending:FormSending;counts:{sent:number;waiting:number;notSent:number}}[]};
const sending:Record<FormSending,string>={inactive:'Not sending yet. Whumpo has not turned on email delivery.','spending-limit-unset':'Not sending yet. Whumpo has not set its monthly spending limit, so appointment emails are not queued or sent, and a request that arrives now is not emailed later.',
 active:'Sending is on for this form. Each email is checked again just before it goes out.',off:'All appointment emails are turned off for this form.',plan:'Not sending: appointment emails need Starter or a higher plan for this website.',contained:'Not sending: Whumpo has paused email for this website.','no-recipient':'Not sending yet: nobody can be reached. Verify your notification address in Dashboard → Contact inbox, or have staff or visitors verify theirs.'};
const nameProblem=businessNameProblem;
const states={inactive:'Disabled',active:'Active',suspended:'Suspended',migrating:'Migrating'} as const;
const who={public:'Anonymous form',visitor:'Visitor',staff:'Staff'} as const;
const total=(s:Item['schemas'][number])=>s.records.public+s.records.visitor+s.records.staff;
const stageLabel:Record<Stage,string>={new:'New',contacted:'Contacted',qualified:'Qualified',won:'Won',lost:'Lost'};
const noteLimit=2000;
/** The owner's own calendar date (not UTC): leads store a date only, so "overdue" is decided here, never on the server. */
export const localDate=(at=new Date())=>`${at.getFullYear()}-${String(at.getMonth()+1).padStart(2,'0')}-${String(at.getDate()).padStart(2,'0')}`;
export const overdue=(lead:Pick<Lead,'stage'|'dueDate'>,today:string)=>!!lead.dueDate&&lead.dueDate<today&&lead.stage!=='won'&&lead.stage!=='lost';
const shown=(v:unknown)=>typeof v==='boolean'?(v?'Yes':'No'):String(v);

const publicForm:Record<Exclude<PublicFormState,'none'>,string>={bound:'Bound to the live website version.',inactive:'Anonymous submissions are closed: this module is not active. Review activation in Chat to turn it on.',
 unavailable:'Anonymous submissions are closed: a module this form depends on is off, this module version is no longer current, the website content is held for safety review, or Whumpo has paused public forms for this website.',
 unpublished:'Anonymous submissions are closed: the website is not published. Publish it, then review activation.',stale:'Anonymous submissions are closed: the website changed after this module was activated. Review activation to bind the form to the live version.'};
/** Whether a public form is bound to the live website and, if not, why anonymous submissions are closed. Plain static text; no colour carries the meaning. */
export function PublicFormNote({state}:{state:PublicFormState}){
 return state==='none'?null:<p className="rounded-md border border-line bg-surface-raised p-3 text-body-sm break-words"><span className="font-medium">Public form: </span>{publicForm[state]}</p>;
}
/** WH-127 `records.summary@1` card: counts per records instance and schema, never a value. Opening the private records
 * panel is a navigation only; values are read there from the owner list route, not through Chat or this binding. */
export function RecordsSummaryCard({facts,projectId}:{facts:RecordsSummaryFacts;projectId:string}){
 if(!facts.items.length)return <div className="space-y-4"><StateNote title="No records module is registered for this project.">Add an appointment request form from Form records.</StateNote>
  <Button asChild variant="secondary" className="min-h-11"><Link to="/workspace/$view" params={{view:'records'}} search={{project:projectId}}>Open form records</Link></Button></div>;
 return <div className="space-y-4">{facts.items.map(i=><section key={i.localId} aria-label={i.localId+' records'} className="space-y-2 rounded-md bg-surface-sunken p-4 text-body-sm">
   <p className="font-semibold break-words">{i.localId} · {states[i.state]} · kept {i.retentionDays} days</p>
   <ul className="space-y-1">{i.schemas.map(s=><li key={s.recordId}>{s.recordId}: {total(s)} record{total(s)===1?'':'s'} ({s.records.public} anonymous, {s.records.visitor} visitor, {s.records.staff} staff)</li>)}</ul>
   {i.forms.length>0&&<p className="text-ink-muted">Forms: {i.forms.map(f=>`${f.formId} (${f.submit})`).join(', ')}</p>}
   <PublicFormNote state={i.publicForm}/>
  </section>)}
  <Button asChild variant="secondary" className="min-h-11"><Link to="/workspace/$view" params={{view:'records'}} search={{project:projectId}}>Open form records</Link></Button>
  <p className="text-caption text-ink-muted">Submitted values stay in the private records panel. They are not shown in Chat or sent to AI.</p>
 </div>;
}


/** WH-158 appointment email notices for one records form. Choosing only prepares an exact review in Chat (notificationSetupReview); the separate
 * confirmation there saves it. The status is for THIS form: whether it would send, and its own counts. Switches and counts only: no address and no submitted value. */
export function NoticeSetup({project,instance,form,submit,setup}:{project:string;instance:string;form:string;submit:string;setup:Setup}){
 const {runAction,commandBusy}=useWorkspace(),saved=setup.forms.find(f=>f.instanceId===instance&&f.formId===form),[error,setError]=useState('');
 const receiptBlocked=submit==='public',[on,setOn]=useState({...(saved?.notices??{owner:true,staff:false,receipt:false}),...(receiptBlocked?{receipt:false}:{})}),[name,setName]=useState(saved?.businessName??''),id=`${instance}-${form}`;
 const notices=(['owner','staff','receipt'] as const).filter(k=>on[k]),clean=name.trim().normalize('NFC'),problem=nameProblem(clean),shown=!!name&&!!problem;
 const rows=[['owner','Tell me when a request arrives','Email to your verified notification address. It only says a request arrived.'],['staff','Tell staff who opted in','Email to staff with a verified address. It only says a request arrived.'],['receipt','Email a receipt to the visitor',receiptBlocked?'Off: this form is open to anonymous visitors, and a receipt needs a signed-in visitor.':'Only for a signed-in visitor with a verified address who asks for it. Shows a reference, service and day.']] as const;
 const nothing=!notices.length&&!saved,why=commandBusy?'Another Chat request is running.':problem||(nothing?'Choose at least one notice.':'');
 async function review(){setError('');try{await runAction({type:'notificationSetupReview',projectId:project,instanceId:instance,formId:form,notices,businessName:clean});}catch(e){setError(message(e));}}
 return <section aria-labelledby={id+'-t'} className="space-y-4 rounded-md bg-surface-sunken p-4 text-body-sm">
  <h3 id={id+'-t'} className="font-semibold break-words">Appointment emails for “{form}”</h3>
  <p role="status" className="rounded-md border border-line bg-surface-raised p-3">{sending[saved?.sending??setup.delivery]}{saved?` Saved settings: revision ${saved.revision}.`:' No settings saved yet.'}{saved&&saved.counts.sent+saved.counts.waiting+saved.counts.notSent>0&&` Emails for this form so far: ${saved.counts.sent} sent, ${saved.counts.waiting} waiting, ${saved.counts.notSent} not sent.`}</p>
  {receiptBlocked&&saved?.notices.receipt&&<p role="note" className="rounded-md border border-line p-3">This form is now open to anonymous visitors, so its saved receipt cannot be sent. Reviewing from here turns the receipt off and keeps your other choices.</p>}
  <fieldset className="grid gap-3"><legend className="mb-1 font-medium">Choose notices</legend>
   {rows.map(([key,label,help])=><label key={key} className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 size-5 shrink-0" checked={on[key]} disabled={commandBusy||key==='receipt'&&receiptBlocked} aria-describedby={`${id}-${key}`} onChange={e=>setOn({...on,[key]:e.target.checked})}/><span><span className="block font-medium">{label}</span><span id={`${id}-${key}`} className="block text-ink-muted">{help}</span></span></label>)}
  </fieldset>
  <Field label="Business name shown in the emails"><Input value={name} onChange={e=>setName(e.target.value)} maxLength={80} autoComplete="organization" aria-invalid={shown} aria-describedby={id+'-name'}/></Field>
  <p id={id+'-name'} className={shown?'text-caption':'text-caption text-ink-muted'}>{shown?problem:'Plain text only: no link, domain name or email address.'}</p>
  <Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy||!!problem||nothing} aria-describedby={id+'-why'} onClick={()=>void review()}>Review in Chat</Button>
  {!!why&&!shown&&<p id={id+'-why'} className="text-caption text-ink-muted">{why}</p>}
  {error&&<p role="alert">{error}</p>}
  <p className="text-caption text-ink-muted">Saving only records these settings. Chat shows the exact review first; it sets up no sender or provider.</p>
 </section>;
}

/** WH-070 standard appointment request form: four steps, one typed button for the next one, and the public link once the form
 * is bound. Each button only prepares the exact review in Chat; saving and turning it on stay their own confirmations. */
export function AppointmentFormSetup({project,setup}:{project:string;setup:RecordsSetup|undefined}){
 const {runAction,commandBusy}=useWorkspace(),[error,setError]=useState(''),lock=useRef(false),view=appointmentSetupView(project,setup);
 if(!view)return null;
 async function run(){
  if(lock.current||!view?.action)return;lock.current=true;setError('');
  try{await runAction(view.action.control);}catch(e){setError(message(e));}finally{lock.current=false;}
 }
 const mark={done:'Done',next:'Next',waiting:'Later'} as const;
 return <section aria-labelledby="appointment-setup" className="space-y-3 rounded-md bg-surface-sunken p-4 text-body-sm">
  <h2 id="appointment-setup" className="font-semibold">Appointment request form</h2>
  <ol className="space-y-1">{view.steps.map(s=><li key={s.label} className="flex flex-wrap gap-x-2"><span className="w-12 shrink-0 font-medium">{mark[s.state]}</span><span className={s.state==='next'?'font-medium':'text-ink-muted'}>{s.label}</span></li>)}</ol>
  <p>{view.note}</p>
  {view.action&&<Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void run()}>{view.action.label}</Button>}
  {view.link&&<p>Public form: <a className="text-link underline break-all" href={view.link} target="_blank" rel="noopener noreferrer">{view.link}</a><span className="block text-caption text-ink-muted">If it says “This form isn’t open yet”, Whumpo has not yet switched on the check that lets the public send requests. Your form stays saved.</span></p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}

/** Owner records panel (workspace origin): every field of one schema, newest first, 50 per page, rendered as text only.
 * Data comes only from the owner routes; nothing here is written to Chat history or model context. Removal sends an
 * owner `records.remove` module request and reuses its request id until a result is confirmed. */
export function RecordsPanel(){
 const {project,stale,choose}=useProjectSelection('records');
 const summary=useQuery({queryKey:['module-records-summary',project],queryFn:()=>api<RecordsSummaryFacts&{notifications:Setup;appointment:RecordsSetup}>(`/projects/${project}/module-records`),enabled:!!project,gcTime:0});
 const [selected,setSelected]=useState('');
 const options=(summary.data?.items??[]).flatMap(i=>i.schemas.map(s=>({value:i.resourceId+'/'+s.recordId,label:`${i.localId} · ${s.recordId} (${total(s)})`})));
 const current=options.some(o=>o.value===selected)?selected:options[0]?.value??'';
 return <div className="space-y-6 max-w-[900px]"><ProjectSelect value={project} onChange={v=>{setSelected('');choose(v);}}/><StaleProject stale={stale}/>
  {project&&<><QueryStatus pending={summary.isPending} error={summary.error}/>
   {summary.data&&<AppointmentFormSetup project={project} setup={summary.data.appointment}/>}
   {summary.data&&!options.length&&<StateNote title="No records yet.">Once an appointment form is on, its requests appear here.</StateNote>}
   {options.length>0&&<label className="flex flex-col gap-2 text-body-sm font-medium">Records<select value={current} onChange={e=>setSelected(e.target.value)} className="h-11 px-3 border border-line rounded-md bg-surface-raised">{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
   {summary.data?.items.filter(i=>i.resourceId===current.split('/')[0]).map(i=><PublicFormNote key={i.resourceId} state={i.publicForm}/>)}
   {summary.data?.items.flatMap(i=>i.forms.filter(f=>i.resourceId+'/'+f.recordId===current).map(f=><NoticeSetup key={project+i.localId+f.formId+(summary.data!.notifications.forms.find(x=>x.instanceId===i.localId&&x.formId===f.formId)?.revision??0)} project={project} instance={i.localId} form={f.formId} submit={f.submit} setup={summary.data!.notifications}/>))}
   {current&&<RecordList key={project+current} project={project} resourceId={current.split('/')[0]} recordId={current.split('/')[1]} onChanged={()=>void summary.refetch()}/>}
  </>}
  <p className="text-caption text-ink-muted">Records, and the stages, notes and dates you add to them, are private to you. They expire with the record after the module's retention period and are not shown in Chat or sent to AI.</p>
 </div>;
}

function RecordList({project,resourceId,recordId,onChanged}:{project:string;resourceId:string;recordId:string;onChanged:()=>void}){
 const [cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),pending=useRef(new Map<string,string>()),[filter,setFilter]=useState({stage:'',due:''}),today=localDate();
 const query=new URLSearchParams({...cursor?{after:cursor}:{},...filter.stage?{stage:filter.stage}:{},...filter.due?{due:filter.due}:{},...filter.due==='overdue'?{today}:{}}).toString();
 const q=useQuery({queryKey:['module-records',project,resourceId,recordId,query],queryFn:()=>api<RecordPage>(`/projects/${project}/module-records/${resourceId}/${recordId}${query?'?'+query:''}`),gcTime:0});
 async function saveLead(entryId:string,revision:number,changes:LeadChanges){
  // One request id per exact change, kept until a result is confirmed, so a retry after an unclear failure reads the saved receipt back.
  const key=entryId+revision+JSON.stringify(changes),requestId=pending.current.get(key)??crypto.randomUUID();pending.current.set(key,requestId);
  try{await api(`/projects/${project}/modules`,{method:'POST',body:JSON.stringify({api:'whumpo-modules',version:1,operation:'leads.update',resourceId,configRevision:q.data!.configRevision,requestId,target:{recordId,entryId,revision,changes},input:null})});}
  catch(e){if(e instanceof APIError&&e.code==='stale_configuration')pending.current.delete(key);throw e;}
  pending.current.delete(key);await q.refetch();
 }
 async function remove(entryId:string){
  setError('');
  const requestId=pending.current.get(entryId)??crypto.randomUUID();pending.current.set(entryId,requestId);
  try{
   await api(`/projects/${project}/modules`,{method:'POST',body:JSON.stringify({api:'whumpo-modules',version:1,operation:'records.remove',resourceId,configRevision:q.data!.configRevision,requestId,target:{recordId,entryId},input:null})});
   pending.current.delete(entryId);await q.refetch();onChanged();
  }catch(e){setError(message(e));throw e;}
 }
 return <div className="space-y-4"><QueryStatus pending={q.isPending} error={q.error}/>
  <LeadFilters stage={filter.stage} due={filter.due} onChange={f=>{setFilter(f);setCursor(null);}}/>
  {q.data?.items.map(item=><Section key={item.entryId} title={who[item.submittedBy]+' · '+new Date(item.createdAt).toLocaleString()}>
   <p className="text-caption text-ink-muted">Reference {item.entryId.slice(0,8).toUpperCase()}</p>
   <dl className="space-y-2 text-body-sm">{q.data.fields.map(f=><div key={f.key} className="flex flex-wrap gap-x-3"><dt className="text-ink-muted">{f.label}</dt><dd className="whitespace-pre-wrap break-words">{Object.hasOwn(item.values,f.key)?shown(item.values[f.key]):'—'}</dd></div>)}</dl>
   <div className="mt-4"><LeadEditor key={item.entryId} id={'lead-'+item.entryId} lead={item.lead} editable={q.data.leads.editable} today={today} onSave={changes=>saveLead(item.entryId,item.lead.revision,changes)} onReload={()=>void q.refetch()}/></div>
   <div className="mt-4"><ConfirmButton label="Delete record" description="Permanently delete this record? It cannot be restored." run={()=>remove(item.entryId)}/></div>
  </Section>)}
  {q.data&&!q.data.items.length&&(filter.stage||filter.due?<StateNote title="No records match these filters.">Clear the filters to see every record.</StateNote>:<StateNote title={cursor?'No more records.':'No records yet.'}>{cursor?'':'Submitted form entries will appear here.'}</StateNote>)}
  {error&&<p role="alert" className="text-body-sm">{error}</p>}
  <div className="flex flex-wrap gap-2">{cursor&&<Button variant="secondary" onClick={()=>setCursor(null)}>Newest records</Button>}{q.data?.next&&<Button variant="secondary" onClick={()=>setCursor(q.data!.next)}>Older records</Button>}</div>
 </div>;
}

/** WH-093 lead filters for the owner list: visible labels, native selects, and a way back to every record. */
export function LeadFilters({stage,due,onChange}:{stage:string;due:string;onChange:(next:{stage:string;due:string})=>void}){
 const select='h-11 min-h-11 px-3 border border-line rounded-md bg-surface-raised';
 return <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-body-sm font-medium">Filter leads</legend>
  <div className="flex flex-col gap-2 text-body-sm"><label htmlFor="lead-filter-stage" className="font-medium">Stage</label><select id="lead-filter-stage" value={stage} onChange={e=>onChange({stage:e.target.value,due})} className={select}><option value="">All stages</option>{stages.map(x=><option key={x} value={x}>{stageLabel[x]}</option>)}</select></div>
  <div className="flex flex-col gap-2 text-body-sm"><label htmlFor="lead-filter-due" className="font-medium">Follow-up date</label><select id="lead-filter-due" value={due} onChange={e=>onChange({stage,due:e.target.value})} className={select}><option value="">Any</option><option value="set">Has a date</option><option value="none">No date</option><option value="overdue">Overdue</option></select></div>
  {(stage||due)&&<Button type="button" variant="secondary" className="min-h-11 sm:col-span-2 sm:justify-self-start" onClick={()=>onChange({stage:'',due:''})}>Clear filters</Button>}
 </fieldset>;
}

/** WH-093 lead editor for one record: stage, a private note and a follow-up date. Text carries the stage and "Overdue" (never colour alone).
 * Saving sends only what changed with the revision this editor was opened on; a stale revision shows a plain conflict message and a reload,
 * never a silent overwrite. Without Business the fields are read-only and say why. Owner-private: not shown in Chat or sent to AI. */
export function LeadEditor({id,lead,editable,today,onSave,onReload}:{id:string;lead:Lead;editable:boolean;today:string;onSave:(changes:LeadChanges)=>Promise<void>;onReload:()=>void}){
 const [stage,setStage]=useState<Stage>(lead.stage),[note,setNote]=useState(lead.note),[due,setDue]=useState(lead.dueDate??''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[saved,setSaved]=useState(false);
 // A newer saved revision (after our own save or a reload) updates each field the owner has not touched since the last one; a field with an unsaved draft keeps the draft, so a conflict reload never discards typing.
 const [seen,setSeen]=useState(lead),[last,setLast]=useState(lead);
 if(seen.revision!==lead.revision){setSeen(lead);setLast(lead);setConflict(false);if(stage===last.stage)setStage(lead.stage);if(note===last.note)setNote(lead.note);if((due||null)===last.dueDate)setDue(lead.dueDate??'');}
 const length=Array.from(note).length,tooLong=length>noteLimit,changes:LeadChanges={...stage!==lead.stage?{stage}:{},...note!==lead.note?{note}:{},...(due||null)!==lead.dueDate?{dueDate:due||null}:{}};
 const changed=Object.keys(changes).length>0,why=!editable?'':busy?'Saving.':tooLong?'Shorten the note to save.':!changed?'Change something to save.':'';
 const late=overdue(lead,today);
 async function save(){
  setError('');setSaved(false);setBusy(true);
  try{await onSave(changes);setSaved(true);}
  catch(e){if(e instanceof APIError&&e.code==='stale_configuration')setConflict(true);else setError(message(e));}
  finally{setBusy(false);}
 }
 return <fieldset className="space-y-4 rounded-md bg-surface-sunken p-4 text-body-sm"><legend className="px-1 font-semibold">Lead</legend>
  <p>Saved stage: <span className="font-medium">{stageLabel[lead.stage]}</span>{late&&<span className="font-medium"> · Overdue</span>}{lead.dueDate&&<span className="text-ink-muted"> · Follow up {lead.dueDate}</span>}</p>
  {!editable&&<p id={id+'-plan'} className="rounded-md border border-line bg-surface-raised p-3">Changing leads needs the Business plan. You can still read and export what you saved.</p>}
  <div className="grid gap-4 sm:grid-cols-2">
   <div className="flex flex-col gap-2"><label htmlFor={id+'-stage'} className="font-medium">Stage</label><select id={id+'-stage'} value={stage} disabled={!editable||busy} aria-describedby={editable?undefined:id+'-plan'} onChange={e=>{setStage(e.target.value as Stage);setSaved(false);}} className="h-11 min-h-11 px-3 border border-line rounded-md bg-surface-raised disabled:opacity-60">{stages.map(x=><option key={x} value={x}>{stageLabel[x]}</option>)}</select></div>
   <div className="flex flex-col gap-2"><label htmlFor={id+'-due'} className="font-medium">Follow-up date</label>
    <div className="flex flex-wrap gap-2"><Input id={id+'-due'} type="date" value={due} min="2020-01-01" max="2100-12-31" readOnly={!editable} disabled={busy} aria-describedby={id+'-due-help'} onChange={e=>{setDue(e.target.value);setSaved(false);}} className="w-auto min-w-0 flex-1"/>
     {due&&editable&&<Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={()=>{setDue('');setSaved(false);}}>Clear date</Button>}</div>
    <p id={id+'-due-help'} className="text-caption text-ink-muted">A date only, in your own calendar. Nothing is sent or scheduled.</p></div>
  </div>
  <div className="flex flex-col gap-2"><label htmlFor={id+'-note'} className="font-medium">Private note</label>
   <Textarea id={id+'-note'} value={note} rows={4} readOnly={!editable} disabled={busy} aria-invalid={tooLong} aria-describedby={id+'-note-help'} onChange={e=>{setNote(e.target.value);setSaved(false);}}/>
   <p id={id+'-note-help'} className={tooLong?'text-caption font-medium':'text-caption text-ink-muted'}>{tooLong?`This note is ${length-noteLimit} characters too long. Keep it to ${noteLimit.toLocaleString('en-US')}.`:`${length.toLocaleString('en-US')} of ${noteLimit.toLocaleString('en-US')} characters. Only you can see this.`}</p></div>
  {conflict?<div role="alert" className="space-y-2 rounded-md border border-line bg-surface-raised p-3"><p>This lead changed in another window, or the module was updated. Reload it. Your unsaved changes stay in the fields so you can decide what to keep.</p><Button type="button" variant="secondary" className="min-h-11" onClick={()=>{setConflict(false);onReload();}}>Reload lead</Button></div>
   :editable&&<div className="flex flex-wrap items-center gap-3"><Button type="button" className="min-h-11" disabled={busy||!changed||tooLong} aria-describedby={why?id+'-why':undefined} onClick={()=>void save()}>{busy?'Saving…':'Save lead'}</Button>
    {why&&<span id={id+'-why'} className="text-caption text-ink-muted">{why}</span>}</div>}
  {saved&&!changed&&<p role="status" className="font-medium">Lead saved.</p>}
  {error&&<p role="alert">{error}</p>}
 </fieldset>;
}
