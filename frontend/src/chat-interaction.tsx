import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ChevronDown,ChevronUp,FileText,LoaderCircle} from 'lucide-react';
import {InteractionError,requireCurrentClient,validateAnswers,verifyEnvelope} from '../../src/chat-interactions/protocol';
import type {Answers,ClientCapabilities,InteractionRead,InteractionReceipt,Mutation} from '../../src/chat-interactions/types';
import {APIError,api,message,queryClient,send} from './lib/api';
import {canRecoverChat} from './lib/chat-delivery';
import {deliverInteraction,recoverInteraction} from './lib/interaction-delivery';
import {useInteractionRecovery} from './use-interaction-recovery';
import {Button} from './components/ui/button';
import {Textarea} from './components/ui/textarea';
import {Input} from './components/ui/input';

const client:ClientCapabilities={versions:[1],fieldTypes:['text','long-text'],bindings:['answer.value@1','interaction.answers@1','site.content@1','site.content-prepare@1']};
const route='/chat/interactions/v1/';
const receipt=(requestId:string)=>send<InteractionReceipt>(route+'receipt',{version:1,requestId});
function startingAnswers(form:InteractionRead):Answers{return form.submission?.answers??{...Object.fromEntries(form.envelope.definition.fields.filter(f=>f.default).map(f=>[f.id,f.default!.value])),...form.draft};}

/** Only the maintained content brief is admitted in this first client slice. */
export function ChatInteraction({id,owner,chatRevision,busy:chatBusy,onAnswerInChat}:{id:string;owner:string;chatRevision:number;busy:boolean;onAnswerInChat:()=>void}){
 const recovery=useInteractionRecovery(owner,id),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[fieldError,setFieldError]=useState<string|null>(null),[checked,setChecked]=useState(false),[discard,setDiscard]=useState(false);
 const section=useRef<HTMLElement>(null),restored=useRef(false);
 const query=useQuery({queryKey:['chat-interaction',owner,id],queryFn:async({signal})=>{
  let value:InteractionRead;
  try{value=await api<InteractionRead>(route+'read',{method:'POST',body:JSON.stringify({version:1,interactionId:id,client}),signal});}catch(error){if(error instanceof APIError&&[404,410].includes(error.status))return null;throw error;}
  const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
  if(value.version!==1||!Number.isSafeInteger(value.answerRevision)||value.answerRevision<0||!iso(value.observedAt)||!(value.draftRetainUntil===null||iso(value.draftRetainUntil))||!['open','submitted','canceled','superseded','expired'].includes(value.state))throw new APIError('Update Whumpo to open this form.',409,'client_update_required');
  await verifyEnvelope(value.envelope);await requireCurrentClient(value.envelope,client);
  if(value.envelope.id!==id||value.envelope.scope.accountId!==owner||value.envelope.scope.actorId!==owner||!value.envelope.scope.projectId||typeof value.projectName!=='string'||!value.projectName.trim()||value.projectName.length>100||value.envelope.definition.template!=='content-change@1'||value.envelope.definition.presentation!=='inline'||value.envelope.definition.cards.length)throw new APIError('This form needs a supported current template.',409,'client_update_required');
  validateAnswers(value.envelope.definition,value.draft,{partial:true});if(value.submission)validateAnswers(value.envelope.definition,value.submission.answers);
  return value;
 },staleTime:0,gcTime:0,refetchInterval:q=>['pending','unknown'].includes(q.state.data?.submission?.continuation.state??'')?5000:false});
 const form=query.data,local=recovery.value,pending=local?.pending??null;
 const answers=local?.answers??(form?startingAnswers(form):{}),collapsed=local?.dismissed??false;
 const conflict=!!(form&&local?.answers&&(local.definitionDigest!==form.envelope.definitionDigest||local.answerRevision!==form.answerRevision));
 const unavailable=query.data===null;
 const locked=busy||chatBusy||query.isFetching||!!pending||!!query.error||conflict||!form||form.state!=='open';
 const draftRecord=()=>({definitionDigest:form!.envelope.definitionDigest,answerRevision:form!.answerRevision,answers:local?.answers??null,updatedAt:local?.updatedAt??Date.now(),dismissed:collapsed,pending:null});
 function refreshChat(){void queryClient.invalidateQueries({queryKey:['chat',owner]});}
 async function settled(request:Mutation){
  if(!recovery.active.current)return;
  recovery.save(null);setChecked(false);setNotice(request.operation==='cancel'?'This form was discarded.':request.operation==='submit'?'Your answers are saved.':'Draft saved.');
  await query.refetch();refreshChat();
 }
 async function checkPending(request:Mutation){
  try{await recoverInteraction(request,receipt);await settled(request);}
  catch(error){if(recovery.active.current){setChecked(error instanceof APIError&&error.status===404);setNotice(error instanceof APIError&&error.status===404?'No saved receipt was found yet. Retry sends the exact original request.':'The request is still unconfirmed. Check its saved status before doing anything else.');}}
 }
 useEffect(()=>{
  const request=recovery.current.current?.pending;if(restored.current||!request)return;restored.current=true;
  void checkPending(request);
 // Restoration reads only. Never turn a restored record into a send instruction.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{
  if(unavailable&&recovery.current.current?.answers)recovery.save({...recovery.current.current,answers:null});
 },[unavailable,recovery.save,recovery.current]);
 function edit(key:string,value:string){if(!form||locked)return;recovery.save({...draftRecord(),answers:{...answers,[key]:value},updatedAt:Date.now()});setNotice('');setFieldError(null);}
 async function perform(action:()=>Promise<void>){if(busy)return;setBusy(true);setNotice('');try{await action();}catch(error){if(recovery.active.current){setNotice(error instanceof InteractionError?'Check the highlighted answer.':canRecoverChat(error)?'The request is unconfirmed. Check saved status; nothing will be sent automatically.':message(error));if(error instanceof InteractionError&&error.fieldId||error instanceof APIError&&error.fieldId){const key=error.fieldId!;setFieldError(key);requestAnimationFrame(()=>section.current?.querySelector<HTMLElement>('[data-field="'+CSS.escape(key)+'"]')?.focus());}}}finally{if(recovery.active.current)setBusy(false);}}
 async function followup(action:'continue'|'stop'|'reconcile',submissionId:string){
  try{await send(route+action,{version:1,submissionId,...(action==='continue'?{expectedChatRevision:chatRevision}:{})});}
  catch(error){if(!canRecoverChat(error))throw error;setNotice('The preview request is unconfirmed. Check saved status; it will not run again automatically.');}
  finally{if(recovery.active.current){await query.refetch();refreshChat();}}
 }
 async function transmit(request:Mutation,prepare:boolean){
  try{await deliverInteraction(request,r=>send<InteractionReceipt>(route+'mutate',r),receipt);}
  catch(error){
   if(!canRecoverChat(error)&&recovery.active.current){const saved=recovery.current.current;if(saved)recovery.save({...saved,pending:null});await query.refetch();}
   else if(recovery.active.current)setNotice('The connection dropped before confirmation. Check the saved status before retrying.');
   throw error;
  }
  await settled(request);
  if(prepare&&recovery.active.current)await followup('continue',request.requestId);
 }
 async function mutate(operation:Mutation['operation']){
  if(!form||locked)return;
  if(operation!=='cancel')validateAnswers(form.envelope.definition,answers,{partial:operation==='save-draft'});
  const base={version:1 as const,requestId:crypto.randomUUID(),interactionId:id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:form.answerRevision};
  const request:Mutation=operation==='cancel'?{...base,operation}:{...base,operation,answers};
  recovery.save({...draftRecord(),answers:operation==='cancel'?local?.answers??null:answers,pending:request});setChecked(false);
  await transmit(request,operation==='submit');
 }
 useEffect(()=>{
  if(!form?.draftRetainUntil)return;
  // Use the server observation interval, not a possibly skewed device wall clock.
  const timer=setTimeout(()=>{queryClient.setQueryData(['chat-interaction',owner,id],null);void query.refetch();},Math.max(0,Date.parse(form.draftRetainUntil)-Date.parse(form.observedAt)));
  return()=>clearTimeout(timer);
 },[form?.draftRetainUntil,form?.observedAt,owner,id]);
 const follow=form?.submission?.continuation;
 return <section ref={section} tabIndex={-1} data-interaction-id={id} aria-label="Website change brief" className="mt-4 rounded-2xl border bg-card p-4 sm:p-5 space-y-4 min-w-0">
  <header className="flex gap-3 items-start"><span className="rounded-xl bg-secondary p-2 shrink-0"><FileText className="size-5" aria-hidden="true"/></span><div className="min-w-0 flex-1"><h2 className="text-base font-semibold break-words">{form?.envelope.definition.title??'Website change brief'}</h2><p className="text-xs text-muted-foreground mt-1 break-words">{form?.projectName?'Project: '+form.projectName:'A private draft for your website'}</p></div>{form&&<Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={collapsed?'Resume form':'Collapse form'} aria-expanded={!collapsed} disabled={busy} onClick={()=>recovery.save({...draftRecord(),pending,dismissed:!collapsed})}>{collapsed?<ChevronDown className="size-4"/>:<ChevronUp className="size-4"/>}</Button>}</header>
  {unavailable&&<p className="text-sm">This form is no longer available. It may have been discarded or reached seven days of inactivity. Ask Whumpo for a new form.</p>}
  {query.isPending&&<p role="status" className="text-sm">Reading your saved form…</p>}
  {query.error&&<div role="alert" className="text-sm space-y-3"><p>{message(query.error)}</p>{!unavailable&&<Button variant="outline" disabled={busy||query.isFetching} onClick={()=>void query.refetch()}>Check saved form</Button>}</div>}
  {notice&&<p role="status" className="text-sm break-words">{notice}</p>}
  {recovery.storageFailed&&<p role="alert" className="text-sm">This browser couldn’t save recovery details. Keep this tab open until your request is confirmed.</p>}
  {pending&&<div className="rounded-xl border bg-secondary/50 p-3 space-y-3 text-sm"><p>An interrupted {pending.operation==='submit'?'answer submission':pending.operation==='cancel'?'discard request':'draft save'} needs a status check. Nothing is sent automatically.</p><div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>void perform(()=>checkPending(pending))}>Check saved status</Button>{checked&&<Button variant="outline" className="min-h-11" disabled={busy||chatBusy} onClick={()=>void perform(()=>transmit(pending,false))}>Retry original request</Button>}</div></div>}
  {form&&!collapsed&&!unavailable&&<>
   <p className="text-sm text-muted-foreground break-words">{form.envelope.definition.summary}</p>
   {conflict&&<div role="alert" className="rounded-xl border p-3 space-y-3 text-sm"><p>This form changed after your local edits. Your edits are shown below and have not overwritten the saved version.</p><Button variant="outline" className="min-h-11" disabled={busy||!!pending} onClick={()=>recovery.save(null)}>Use latest saved answers</Button></div>}
   <form noValidate onSubmit={event=>{event.preventDefault();void perform(()=>mutate('submit'));}} className="space-y-5">
    {form.envelope.definition.fields.map(field=>{
     const name='form-'+id+'-'+field.id,invalid=fieldError===field.id,description=name+'-help';
     const props={id:name,'data-field':field.id,'aria-describedby':description+(invalid?' '+name+'-error':''),'aria-invalid':invalid,required:field.required,readOnly:locked,value:String(answers[field.id]??''),maxLength:'maxLength'in field.constraints?field.constraints.maxLength:2000,onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>edit(field.id,event.target.value),autoComplete:'off',className:'min-h-11 text-base'};
     return <div key={field.id} className="space-y-2"><label htmlFor={name} className="block text-sm font-medium break-words">{field.label} <span className="text-xs font-normal text-muted-foreground">{field.required?'Required':'Optional'}</span></label>{field.type==='long-text'?<Textarea {...props} rows={3}/>:<Input {...props}/>}<p id={description} className="text-xs text-muted-foreground break-words">{field.help}{field.default&&<span className="block mt-1">Starting value: {field.default.provenance==='saved'?'saved website text':field.default.provenance==='user'?'your earlier answer':'a suggestion to review'}.</span>}</p>{invalid&&<p id={name+'-error'} role="alert" className="text-sm text-destructive">{String(answers[field.id]??'').trim()?'Check this answer’s length and format.':'Add an answer before preparing the preview.'}</p>}</div>;
    })}
    {form.state==='open'&&<><p className="text-xs text-muted-foreground">Your changes stay private. Preparing a preview saves these answers; saving the website and publishing each need a separate review.</p><div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11" disabled={locked}>{busy&&<LoaderCircle className="size-4 animate-spin"/>}Prepare preview</Button><Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={()=>void perform(()=>mutate('save-draft'))}>Save draft</Button></div><p className="text-xs text-muted-foreground">Edits stay in this browser until saved. Unsubmitted drafts are kept for seven days of inactivity.</p></>}
   </form>
   {form.state==='open'&&<div className="flex flex-wrap items-center gap-2 border-t pt-3"><Button type="button" variant="link" className="min-h-11 px-0" onClick={onAnswerInChat}>Answer in Chat</Button>{!discard?<Button variant="ghost" className="min-h-11 ml-auto" disabled={locked} onClick={()=>setDiscard(true)}>Discard form</Button>:<div className="w-full rounded-xl border p-3 space-y-2"><p className="text-sm">Discard this form and its unsent answers?</p><div className="flex flex-wrap gap-2"><Button variant="destructive" className="min-h-11" disabled={locked} onClick={()=>void perform(()=>mutate('cancel'))}>Discard this form</Button><Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>setDiscard(false)}>Keep editing</Button></div></div>}</div>}
   {form.state==='expired'&&<p className="text-sm">The answer window has closed. Ask Whumpo for a new form to continue.</p>}
   {form.state==='superseded'&&<p className="text-sm">A newer form continues this task. These earlier answers are read-only.</p>}
   {follow&&<div className="space-y-3 border-t pt-3 text-sm"><p>{follow.state==='succeeded'?'Your preview is ready in Chat. Review it before saving the website.':follow.state==='not-started'?'Your answers are saved. Preview preparation has not started.':follow.state==='failed'?follow.reason==='stopped'?'Preview preparation was stopped. Your submitted answers remain saved.':'A preview could not be prepared. Your answers are saved; ask Whumpo for a fresh form.':'Preview preparation is not yet confirmed. Checking status will not start another request.'}</p><div className="flex flex-wrap gap-2">{follow.state==='not-started'&&<><Button className="min-h-11" disabled={busy||chatBusy||!!pending} onClick={()=>void perform(()=>followup('continue',follow.id))}>Prepare saved answers</Button><Button variant="outline" className="min-h-11" disabled={busy||!!pending} onClick={()=>void perform(()=>followup('stop',follow.id))}>Stop preview preparation</Button></>}{['pending','unknown'].includes(follow.state)&&<Button variant="outline" className="min-h-11" disabled={busy||!!pending} onClick={()=>void perform(()=>followup('reconcile',follow.id))}>Resolve preview status</Button>}</div></div>}
  </>}
 </section>;
}
