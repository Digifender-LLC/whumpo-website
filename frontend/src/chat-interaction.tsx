import {ChatConnectionConsent} from './connection-consent';
import {isWorkspaceViewDefinition} from '../../src/chat-interactions/view-definition';
import {TemporaryViewComponent,viewLabels} from './workspace-view-components';
import {ProjectPhotoUpload} from './project-photo-upload';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from '@tanstack/react-router';
import {ChevronDown,ChevronUp,FileText,ImagePlus,LoaderCircle} from 'lucide-react';
import {InteractionError,requireCurrentClient,validateAnswers,verifyEnvelope,isFieldVisible} from '../../src/chat-interactions/protocol';
import type {Answers,ClientCapabilities,InteractionRead,InteractionReceipt,Mutation} from '../../src/chat-interactions/types';
import {APIError,api,message,queryClient,send} from './lib/api';
import {canRecoverChat} from './lib/chat-delivery';
import {deliverInteraction,recoverInteraction} from './lib/interaction-delivery';
import {useInteractionRecovery} from './use-interaction-recovery';
import {Button} from './components/ui/button';
import {ChatLookupConsent} from './lookup-consent-card';
import {lookupConsentCard,connectionIntakeProvider,isPhotoIntakeDefinition,isProjectIntakeTemplate,isSupportRequestDefinition,isSupportStatusDefinition,projectIntakeDefinition} from '../../src/chat-interactions/maintained';
import {ChatSupportRequests} from './chat-support-requests';
import {isInformationDefinition} from '../../src/chat-interactions/composition';
import {ChatInteractionCards} from './chat-interaction-cards';
import {ChatInteractionFields} from './chat-interaction-fields';
import {fieldAnswerSnapshot} from './lib/interaction-fields';
import type {Answer} from '../../src/chat-interactions/types';

const client:ClientCapabilities={versions:[1],fieldTypes:['text','long-text','resource','choice','multi-choice','boolean','number','date','datetime'],bindings:['answer.value@1','interaction.answers@1','site.content@1','site.content-prepare@1','agent.task-continue@1','owned.projects@1','owned.photos@1','project.status@1','project.photos@1','connection.github@1','connection.cloudflare@1','workspace.projects@1','account.usage@1','owner.activity@1','project.storage@1','project.traffic@1','cms.status@1','project.performance@1','workspace.reviews@1','project.guest-previews@1','project.site-health@1','module.instances@1','access.roles@1','records.summary@1','support.request@1','support.requests@1','connector.lookup-consent@1']};
const route='/chat/interactions/v1/';
const receipt=(requestId:string)=>send<InteractionReceipt>(route+'receipt',{version:1,requestId});
function startingAnswers(form:InteractionRead):Answers{return form.submission?.answers??form.draft??Object.fromEntries(form.envelope.definition.fields.filter(f=>f.default).map(f=>[f.id,f.default!.value]));}

/** Maintained templates and exact admitted information compositions only. */
export function ChatInteraction({id,owner,chatRevision,busy:chatBusy,onAnswerInChat}:{id:string;owner:string;chatRevision:number;busy:boolean;onAnswerInChat:()=>void}){
 const recovery=useInteractionRecovery(owner,id),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[fieldError,setFieldError]=useState<string|null>(null),[checked,setChecked]=useState(false),[discard,setDiscard]=useState(false),[resourceState,setResourceState]=useState<Record<string,boolean>>({});
 const onResourceReady=useCallback((fieldId:string,ready:boolean)=>setResourceState(previous=>previous[fieldId]===ready?previous:{...previous,[fieldId]:ready}),[]);
 const section=useRef<HTMLElement>(null),restored=useRef(false);
 const result=useRef<HTMLParagraphElement>(null),followResult=useRef<HTMLParagraphElement>(null),discardButton=useRef<HTMLButtonElement>(null),keepButton=useRef<HTMLButtonElement>(null);
 const query=useQuery({queryKey:['chat-interaction',owner,id],queryFn:async({signal})=>{
  let value:InteractionRead;
  try{value=await api<InteractionRead>(route+'read',{method:'POST',body:JSON.stringify({version:1,interactionId:id,client}),signal});}catch(error){if(error instanceof APIError&&[404,410].includes(error.status))return null;throw error;}
  const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
  if(value.version!==1||!Number.isSafeInteger(value.answerRevision)||value.answerRevision<0||!iso(value.observedAt)||!(value.draftRetainUntil===null||iso(value.draftRetainUntil))||!['open','submitted','canceled','superseded','expired'].includes(value.state))throw new APIError('Update Whumpo to open this form.',409,'client_update_required');
  await verifyEnvelope(value.envelope);await requireCurrentClient(value.envelope,client);
  const d=value.envelope.definition,content=d.template==='content-change@1',photo=isPhotoIntakeDefinition(d),custom=isInformationDefinition(d),connection=connectionIntakeProvider(d),lookup=!!lookupConsentCard(d),view=isWorkspaceViewDefinition(d),supportForm=isSupportRequestDefinition(d),supportView=isSupportStatusDefinition(d),scoped=content||photo||custom||(!!connection&&value.envelope.scope.projectId!==null)||(view&&d.workspaceView?.projectId!==null);
  if(value.envelope.id!==id||value.envelope.scope.accountId!==owner||value.envelope.scope.actorId!==owner||(!scoped&&!view&&!connection&&!lookup&&!supportForm&&!supportView&&!isProjectIntakeTemplate(d.template))||(scoped?(!value.envelope.scope.projectId||typeof value.projectName!=='string'||!value.projectName.trim()||value.projectName.length>100):(value.envelope.scope.projectId!==null||value.projectName!==null||d.continuationBinding!==(isProjectIntakeTemplate(d.template)?projectIntakeDefinition(d.template).continuationBinding:null)))||d.presentation!=='inline'||(!photo&&!view&&!connection&&!lookup&&!supportView&&(content?d.cards.length!==1||d.cards.some(c=>c.id!=='project-status'||c.binding!=='project.status@1'||c.display!=='status'||c.limit!==1||c.reviewId!==null):d.cards.length!==0))||((photo||view||connection||lookup||supportView)&&(value.draft!==null||value.submission!==null)))throw new APIError('This form needs a supported current template.',409,'client_update_required');
  if(value.draft!==null)validateAnswers(value.envelope.definition,value.draft,{partial:true});if(value.submission)validateAnswers(value.envelope.definition,value.submission.answers);
  return value;
 },staleTime:0,gcTime:0,refetchInterval:q=>['pending','unknown'].includes(q.state.data?.submission?.continuation?.state??'')?5000:false});
 const lastViewChatRevision=useRef(chatRevision);
 useEffect(()=>{
  if(lastViewChatRevision.current===chatRevision)return;
  lastViewChatRevision.current=chatRevision;
  if(query.data?.envelope.definition.workspaceView)void queryClient.invalidateQueries({queryKey:['chat-interaction',owner,id]});
 },[chatRevision,owner,id,query.data?.envelope.definition.workspaceView]);
 const form=query.data,local=recovery.value,pending=local?.pending??null;
 const answers=local?.answers??(form?startingAnswers(form):{}),collapsed=local?.dismissed??false;
 const conflict=!!(form&&local?.answers&&(local.definitionDigest!==form.envelope.definitionDigest||local.answerRevision!==form.answerRevision));
 const unavailable=query.data===null,content=form?.envelope.definition.template==='content-change@1';
 const resourceFields=form?.envelope.definition.fields.filter(f=>(f.type==='resource'||f.type==='attachment')&&isFieldVisible(f,answers))??[];
 const selection=resourceFields.length>0,resourceReady=resourceFields.every(f=>resourceState[f.id]===true);
 const locked=busy||chatBusy||query.isFetching||!!pending||!!query.error||conflict||!form||form.state!=='open';
 const draftRecord=()=>({definitionDigest:form!.envelope.definitionDigest,answerRevision:form!.answerRevision,answers:local?.answers??null,updatedAt:local?.updatedAt??Date.now(),dismissed:collapsed,pending:null});
 function refreshChat(){void queryClient.invalidateQueries({queryKey:['chat',owner]});}
 async function settled(request:Mutation){
  if(!recovery.active.current)return;
  recovery.save(null);setChecked(false);setNotice(request.operation==='cancel'?form?.envelope.definition.workspaceView?'This view was dismissed.':'This form was discarded.':request.operation==='submit'?(form&&isSupportRequestDefinition(form.envelope.definition)?'Your help request is saved for a platform operator.':'Your answers are saved.'):'Draft saved.');
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
 function edit(key:string,value:Answer|undefined){
  if(!form||locked)return;const next={...answers};
  // An unselected resource is absent, never an empty or invented resource ID.
  if(value===undefined||value===''&&form.envelope.definition.fields.find(f=>f.id===key)?.type==='resource')delete next[key];else next[key]=value;
  recovery.save({...draftRecord(),answers:next,updatedAt:Date.now()});setNotice('');setFieldError(null);
 }
 async function perform(action:()=>Promise<void>){
  if(busy)return;
  const origin=document.activeElement instanceof HTMLElement&&section.current?.contains(document.activeElement)?document.activeElement:null;
  let moved=false,errorField:string|null=null;
  const observeFocus=(event:FocusEvent)=>{if(event.target!==origin&&event.target!==document.body)moved=true;};
  document.addEventListener('focusin',observeFocus);setBusy(true);setNotice('');
  try{await action();}
  catch(error){if(recovery.active.current){
   setNotice(error instanceof InteractionError?'Check the highlighted answer.':error instanceof APIError&&error.code==='continuation_unavailable'?message(error):canRecoverChat(error)?'The request is unconfirmed. Check saved status; nothing will be sent automatically.':message(error));
   if(error instanceof InteractionError&&error.fieldId||error instanceof APIError&&error.fieldId){errorField=error.fieldId!;setFieldError(errorField);}
  }}
  finally{
   if(recovery.active.current)setBusy(false);
   requestAnimationFrame(()=>{
    document.removeEventListener('focusin',observeFocus);
    // A delayed reply must not steal focus after the user moved elsewhere.
    if(!recovery.active.current||!origin||moved||![origin,document.body].includes(document.activeElement as HTMLElement))return;
    if(errorField){section.current?.querySelector<HTMLElement>('[data-field="'+CSS.escape(errorField)+'"]')?.focus();return;}
    if(!origin.isConnected||origin.matches(':disabled'))(followResult.current??result.current??section.current)?.focus();
    else if(document.activeElement===document.body)origin.focus();
   });
  }
 }
 async function followup(action:'continue'|'stop'|'reconcile',submissionId:string){
  try{await send(route+action,{version:1,submissionId,...(action==='continue'?{expectedChatRevision:chatRevision}:{})});}
  catch(error){if(!canRecoverChat(error)||error instanceof APIError&&error.code==='continuation_unavailable')throw error;setNotice('The follow-up request is unconfirmed. Check saved status; it will not run again automatically.');}
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
  if(!form||locked||(operation!=='cancel'&&selection&&!resourceReady))return;
  const snapshot=fieldAnswerSnapshot(form.envelope.definition.fields,answers);
  if(operation!=='cancel')validateAnswers(form.envelope.definition,snapshot,{partial:operation==='save-draft'});
  const base={version:1 as const,requestId:crypto.randomUUID(),interactionId:id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:form.answerRevision};
  const request:Mutation=operation==='cancel'?{...base,operation}:{...base,operation,answers:snapshot};
  recovery.save({...draftRecord(),answers:operation==='cancel'?local?.answers??null:answers,pending:request});setChecked(false);
  await transmit(request,operation==='submit'&&form.envelope.definition.continuationBinding!==null);
 }
 useEffect(()=>{
  if(!form?.draftRetainUntil)return;
  // Use the server observation interval, not a possibly skewed device wall clock.
  const timer=setTimeout(()=>{queryClient.setQueryData(['chat-interaction',owner,id],null);void query.refetch();},Math.max(0,Date.parse(form.draftRetainUntil)-Date.parse(form.observedAt)));
  return()=>clearTimeout(timer);
 },[form?.draftRetainUntil,form?.observedAt,owner,id]);
 const modelFollow=form?.envelope.definition.continuationBinding==='agent.task-continue@1';
 const view=form&&isWorkspaceViewDefinition(form.envelope.definition)?form.envelope.definition.workspaceView:null;
 const follow=form?.submission?.continuation,photo=!!form&&isPhotoIntakeDefinition(form.envelope.definition),connection=form?connectionIntakeProvider(form.envelope.definition):null,lookup=!!form&&!!lookupConsentCard(form.envelope.definition);
 const supportForm=!!form&&isSupportRequestDefinition(form.envelope.definition),supportView=!!form&&isSupportStatusDefinition(form.envelope.definition);
 return <section ref={section} tabIndex={-1} data-interaction-id={id} aria-label={content?'Website change brief':form?.envelope.definition.title??'Saved Chat item'} className="mt-4 rounded-lg border bg-card p-4 sm:p-5 space-y-4 min-w-0">
  <header className="flex gap-3 items-start"><span className="rounded-md bg-secondary p-2 shrink-0">{photo?<ImagePlus className="size-5" aria-hidden="true"/>:<FileText className="size-5" aria-hidden="true"/>}</span><div className="min-w-0 flex-1"><h2 className="text-base font-semibold break-words">{form?.envelope.definition.title??'Saved Chat item'}</h2><p className="text-xs text-muted-foreground mt-1 break-words">{form?.projectName?'Project: '+form.projectName:'Details for your conversation'}</p></div>{form&&!view&&<Button variant="quiet" size="icon" className="min-h-11 min-w-11" aria-label={photo?(collapsed?'Resume uploader':'Collapse uploader'):(collapsed?'Resume form':'Collapse form')} aria-expanded={!collapsed} disabled={busy} onClick={()=>recovery.save({...draftRecord(),pending,dismissed:!collapsed})}>{collapsed?<ChevronDown className="size-4"/>:<ChevronUp className="size-4"/>}</Button>}</header>
  {unavailable&&<p className="text-sm">This Chat item is no longer available. It may have been dismissed or expired. Ask Whumpo for a new one.</p>}
  {query.isPending&&<p role="status" className="text-sm">Reading your saved Chat item…</p>}
  {query.error&&<div role="alert" className="text-sm space-y-3"><p>{message(query.error)}</p>{!unavailable&&<Button variant="secondary" disabled={busy||query.isFetching} onClick={()=>void query.refetch()}>Check saved form</Button>}</div>}
  {notice&&<p ref={result} tabIndex={-1} role="status" className="text-sm break-words">{notice}</p>}
  {recovery.storageFailed&&<p role="alert" className="text-sm">This browser couldn’t save recovery details. Keep this tab open until your request is confirmed.</p>}
  {pending&&<div className="rounded-md border bg-secondary/50 p-3 space-y-3 text-sm"><p>An interrupted {pending.operation==='submit'?'answer submission':pending.operation==='cancel'?'discard request':'draft save'} needs a status check. Nothing is sent automatically.</p><div className="flex flex-wrap gap-2"><Button variant="secondary" className="min-h-11" disabled={busy} onClick={()=>void perform(()=>checkPending(pending))}>Check saved status</Button>{checked&&<Button variant="secondary" className="min-h-11" disabled={busy||chatBusy} onClick={()=>void perform(()=>transmit(pending,false))}>Retry original request</Button>}</div></div>}
  {form&&!collapsed&&!unavailable&&<>
   {!photo&&<p className="text-sm text-muted-foreground break-words">{form.envelope.definition.summary}</p>}
   {content&&form.envelope.scope.projectId&&['open','submitted'].includes(form.state)&&!form.replacementInteractionId&&<ChatInteractionCards owner={owner} interactionId={id} digest={form.envelope.definitionDigest} projectId={form.envelope.scope.projectId}/>}
   {conflict&&<div role="alert" className="rounded-md border p-3 space-y-3 text-sm"><p>This form changed after your local edits. Your edits are shown below and have not overwritten the saved version.</p><Button variant="secondary" className="min-h-11" disabled={busy||!!pending} onClick={()=>recovery.save(null)}>Use latest saved answers</Button></div>}
   {photo&&form.envelope.scope.projectId&&form.state==='open'&&<ProjectPhotoUpload key={owner+form.envelope.scope.projectId} owner={owner} project={form.envelope.scope.projectId} handoff={{interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest}} disabled={locked}/>}
   {connection&&form.state==='open'&&!query.isFetching&&!query.error&&!pending&&<ChatConnectionConsent owner={owner} provider={connection} handoff={{interactionId:id,definitionDigest:form.envelope.definitionDigest}} disabled={locked}/>}
   {view&&form.state==='open'&&!query.isFetching&&!query.error&&!pending&&<div className="space-y-5">{view.widgets.map(kind=><section key={kind} aria-label={viewLabels[kind]} className="rounded-md border p-3 space-y-3"><h3 className="text-sm font-semibold">{viewLabels[kind]}</h3><TemporaryViewComponent owner={owner} interactionId={id} digest={form.envelope.definitionDigest} kind={kind} projectId={view.projectId}/></section>)}</div>}
   {supportView&&form.state==='open'&&!query.isFetching&&!query.error&&!pending&&<ChatSupportRequests owner={owner} interactionId={id} digest={form.envelope.definitionDigest}/>}
   {lookup&&form.state==='open'&&!query.isFetching&&!query.error&&!pending&&<ChatLookupConsent interactionId={id} digest={form.envelope.definitionDigest} disabled={locked}/>}
   {!photo&&!view&&!connection&&!lookup&&!supportView&&<form noValidate onSubmit={event=>{event.preventDefault();void perform(()=>mutate('submit'));}} className="space-y-5">
    <ChatInteractionFields fields={form.envelope.definition.fields} answers={answers} owner={owner} interactionId={id} digest={form.envelope.definitionDigest} locked={locked} fieldError={fieldError} onChange={edit} onResourceReady={onResourceReady}/>
    {form.state==='open'&&<><p className="text-xs text-muted-foreground">{supportForm?'Only you can send this. Sending saves it for a platform operator. We reply on business days. Nothing else changes. Responses appear in Chat and on the Support page.':content?'Your changes stay private. Preparing a preview saves these answers; saving the website and publishing each need a separate review.':modelFollow?form.envelope.definition.template==='project-brief@1'?'Saving continues this plan with Whumpo. The follow-up can create your project and first private website draft. Publishing requires your approval.':'Saving shares these answers with Whumpo and continues this website task. Changes to an existing website still need your review; publishing always needs approval.':'Saving shares these answers with Whumpo for this conversation. It does not create a project or change your sites.'}</p><div className="flex flex-wrap gap-2"><Button type="submit" className="min-h-11" disabled={locked||(selection&&!resourceReady)}>{busy&&<LoaderCircle className="size-4 animate-spin"/>}{supportForm?'Send to support':content?'Prepare preview':modelFollow?'Save and continue':'Save answers'}</Button><Button type="button" variant="secondary" className="min-h-11" disabled={locked||(selection&&!resourceReady)} onClick={()=>void perform(()=>mutate('save-draft'))}>Save draft</Button></div><p className="text-xs text-muted-foreground">Edits stay in this browser until saved. Unsubmitted drafts are kept for seven days of inactivity.</p></>}
   </form>}
   {(view||connection||lookup||supportView)&&form.state==='open'&&<div className="flex flex-wrap items-center gap-2 border-t pt-3"><Button variant="link" className="min-h-11 px-0" onClick={onAnswerInChat}>Back to Chat</Button><Button variant="quiet" className="min-h-11 ml-auto" disabled={locked} onClick={()=>void perform(()=>mutate('cancel'))}>{connection?'Dismiss connection controls':lookup?'Decline lookup':supportView?'Dismiss support view':'Dismiss view'}</Button></div>}
   {!view&&!connection&&!lookup&&!supportView&&form.state==='open'&&<div className="flex flex-wrap items-center gap-2 border-t pt-3"><Button type="button" variant="link" className="min-h-11 px-0" onClick={onAnswerInChat}>{photo?'Back to Chat':'Answer in Chat'}</Button>{!discard?<Button ref={discardButton} variant="quiet" className="min-h-11 ml-auto" disabled={locked} onClick={()=>{setDiscard(true);requestAnimationFrame(()=>keepButton.current?.focus());}}>{photo?'Dismiss uploader':'Discard form'}</Button>:<div role="group" aria-labelledby={'form-'+id+'-discard'} className="w-full rounded-md border p-3 space-y-2"><p id={'form-'+id+'-discard'} className="text-sm">{photo?'Close this photo uploader? Saved photos and unconfirmed upload recovery details are kept.':'Discard this form and its unsent answers?'}</p><div className="flex flex-wrap gap-2"><Button variant="destructive" className="min-h-11" disabled={locked} onClick={()=>void perform(()=>mutate('cancel'))}>{photo?'Dismiss this uploader':'Discard this form'}</Button><Button ref={keepButton} variant="secondary" className="min-h-11" disabled={busy} onClick={()=>{setDiscard(false);requestAnimationFrame(()=>discardButton.current?.focus());}}>{photo?'Keep uploader open':'Keep editing'}</Button></div></div>}</div>}
   {form.state==='expired'&&<p className="text-sm">{view||supportView?'This temporary view has expired. Ask Whumpo for a fresh overview.':'The answer window has closed. Ask Whumpo for a new form to continue.'}</p>}
   {(form.state==='superseded'||form.replacementInteractionId)&&<p className="text-sm">{view?'A newer view continues this task. Open the updated overview in Chat.':'A newer form continues this task. These earlier answers are read-only.'}</p>}
   {form.state==='submitted'&&supportForm&&<div className="space-y-3 border-t pt-3 text-sm"><p>Your help request is saved for a platform operator. Ask Whumpo about its status any time; responses also appear on the Support page.</p><div className="flex flex-wrap gap-2"><Button variant="secondary" className="min-h-11" onClick={onAnswerInChat}>Continue in Chat</Button><Button asChild variant="link" className="min-h-11 px-0"><Link to="/workspace/$view" params={{view:'support'}} search={{}}>Open Support</Link></Button></div></div>}
   {form.state==='submitted'&&!supportForm&&!form.replacementInteractionId&&!content&&!follow&&<div className="space-y-3 border-t pt-3 text-sm"><p>Your answers are saved for Chat. Tell Whumpo what you’d like to do next.</p><Button variant="secondary" className="min-h-11" onClick={onAnswerInChat}>Continue in Chat</Button></div>}
   {follow&&<div className="space-y-3 border-t pt-3 text-sm"><p ref={followResult} tabIndex={-1}>{follow.state==='succeeded'?modelFollow?'Whumpo’s follow-up is ready in Chat. Review any preview before approving changes or publishing.':'Your preview is ready in Chat. Review it before saving the website.':follow.state==='not-started'?modelFollow?'Your answers are saved. The task follow-up has not started.':'Your answers are saved. Preview preparation has not started.':follow.state==='failed'?follow.reason==='stopped'?'The follow-up was stopped. Your submitted answers remain saved.':modelFollow?'The task follow-up could not finish. Your answers are saved; ask Whumpo to continue with a fresh form.':'A preview could not be prepared. Your answers are saved; ask Whumpo for a fresh form.':modelFollow?'The task follow-up is not yet confirmed. Checking status will not send another model request.':'Preview preparation is not yet confirmed. Checking status will not start another request.'}</p><div className="flex flex-wrap gap-2">{follow.state==='not-started'&&<><Button className="min-h-11" disabled={busy||chatBusy||!!pending} onClick={()=>void perform(()=>followup('continue',follow.id))}>{modelFollow?'Continue task':'Prepare saved answers'}</Button><Button variant="secondary" className="min-h-11" disabled={busy||!!pending} onClick={()=>void perform(()=>followup('stop',follow.id))}>{modelFollow?'Stop follow-up':'Stop preview preparation'}</Button></>}{['pending','unknown'].includes(follow.state)&&<Button variant="secondary" className="min-h-11" disabled={busy||!!pending} onClick={()=>void perform(()=>followup('reconcile',follow.id))}>{modelFollow?'Check task status':'Resolve preview status'}</Button>}</div></div>}
  </>}
 </section>;
}
