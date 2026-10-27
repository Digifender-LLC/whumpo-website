import {SiteSafetyPage} from './site-safety';
import {SupportPage} from './support';
import {OperatorSafetyPage} from './operator-safety';
import {SavedChatTurn} from './saved-chat-turn';
import {SavedWorkPage} from './saved-work';
import {savedTurnFallback} from './lib/saved-work';
import {useChatLocation} from './use-chat-location';
import {AccountHelp,AccountHelpProvider,AccountSecurityPage} from './account-help';
import {parseLayout} from '../../src/workspace-view-contract';
import {SpecificationReviewDetails} from './specification-review-details';
import {ChatInteraction} from './chat-interaction';
import {GitHubGrantReviewCard} from './github-grant-review';
import {identityCeremony} from './lib/identity';
import {useChatRecovery} from './use-chat-recovery';
import {chatControl,type ChatControl} from '../../src/chat-controls';
import {AppMaintenanceCard} from './app-maintenance-card';
import {AppRestoreReviewCard} from './app-restore-review-card';
import {AppPageReviewCard} from './app-page-review-card';
import {ApplicationReviewCard} from './application-review-card';
import {ChatReply} from './chat-reply';
import {ChatHistoryDialog} from './chat-history-dialog';
import {FirstDraftCard} from './first-draft-card';
import {ChatRequest as ChatRequestMessage} from './chat-request';
import {TurnActions} from './chat-turn-actions';
import {Onboarding} from './onboarding';
import {profilePicture} from './profile-picture-picker';
import {useChatScroll} from './use-chat-scroll';
import {EssentialNavigation,MobileNavigation,useMobileViewport} from './mobile-workspace';
import {submitChat,canRecoverChat,matchesChatRequest,type ChatRequest} from './lib/chat-delivery';
import {presentWithAcknowledgment} from '../../web/ack-timing.js';
import {Children,lazy,useEffect,useRef,useState,createContext,useContext,type ReactNode} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {Link,useNavigate,useRouterState} from '@tanstack/react-router';
import {MessageCircle,LayoutDashboard,Settings,PanelTop,ArrowUp,Sparkles,LoaderCircle,ArrowRight} from 'lucide-react';
import {api,send,message,APIError,queryClient,type Profile,type Chat,type Turn,type Dashboard} from './lib/api';
import {Button} from './components/ui/button';
import {Textarea} from './components/ui/textarea';
import {Brand} from './components/brand';
import {ChatMessage} from './components/whumpo/chat-message';
import {IdentityGate} from './identity/flow';
import {providerReturn,chatLocationTarget,workspaceView,noteLocation,pageNavigationLabel,pageAccessibleName} from './lib/workspace-navigation';
import {DeferredArea} from './deferred-area';
import {QueryRecovery} from './query-recovery';
import {updatedReplies} from './lib/chat-announcements';
import {useWorkspaceTheme} from './lib/workspace-theme';
const DashboardPage=lazy(()=>import('./workspace-pages').then(module=>({default:module.DashboardPage})));
const SettingsPage=lazy(()=>import('./workspace-pages').then(module=>({default:module.SettingsPage})));
const ProfilePage=lazy(()=>import('./workspace-pages').then(module=>({default:module.ProfilePage})));
const ControlPage=lazy(()=>import('./workspace-pages').then(module=>({default:module.ControlPage})));
const Context=createContext<{profile:Profile;dashboard?:Dashboard;dashboardRead:{error:unknown;fetching:boolean;retry:()=>Promise<boolean>};sendMessage:(content:string)=>Promise<void>;runAction:(action:ChatControl)=>Promise<void>;runDomainAction:(action:ChatControl)=>Promise<string|undefined>;commandBusy:boolean;notify:(message:string)=>void}>({profile:null!,dashboardRead:{error:null,fetching:false,retry:async()=>false},sendMessage:async()=>{},runAction:async()=>{},runDomainAction:async()=>undefined,commandBusy:false,notify:()=>{}});
export const useWorkspace=()=>useContext(Context);
export function Workspace(){
 useMobileViewport();useWorkspaceTheme();
 const location=useRouterState({select:s=>s.location});noteLocation(location.pathname);
 return <IdentityGate signup={['1','true'].includes(new URLSearchParams(location.searchStr).get('signup')??'')}><AccountHelpProvider>{location.pathname==='/workspace/security'?<AccountSecurityPage/>:location.pathname==='/workspace/safety'?<SiteSafetyPage/>:location.pathname==='/workspace/saved-work'?<SavedWorkPage/>:location.pathname==='/workspace/support'?<SupportPage/>:location.pathname==='/workspace/operator-safety'?<OperatorSafetyPage/>:<WorkspaceProfile/>}</AccountHelpProvider></IdentityGate>;
}
function WorkspaceProfile(){
 const profile=useQuery({queryKey:['session'],queryFn:async()=>{
  const next=await api<Profile>('/profile'),previous=queryClient.getQueryData<Profile>(['session']);
  if(previous&&previous.accountId!==next.accountId)queryClient.removeQueries({predicate:q=>q.queryKey[0]!=='session'});
  return next;
 }});
 useEffect(()=>{if(profile.data&&!profile.data.onboardingComplete)document.title="Welcome — Whumpo";},[profile.data?.onboardingComplete]);
 if(profile.isPending)return <main className="min-h-dvh grid place-content-center justify-items-center gap-5"><LoaderCircle className="animate-spin size-6" aria-label="Opening your workspace"/><AccountHelp/></main>;
 if(profile.error)return <main className="page-pad space-y-4"><h1 className="text-2xl font-bold">Couldn’t open your workspace</h1><p role="alert">{message(profile.error)}</p><div className="flex flex-wrap gap-3"><Button onClick={()=>profile.refetch()}>Try again</Button><AccountHelp/></div></main>;
 if(!profile.data)return null;
 if(!profile.data.onboardingComplete)return <Onboarding profile={profile.data}/>;
 return <WorkspaceSession key={profile.data.accountId} account={profile.data}/>;
}
function WorkspaceSession({account}:{account:Profile}){
 const profile={data:account},scope=account.accountId;
 const location=useRouterState({select:s=>s.location}),view=workspaceView(location.pathname),navigate=useNavigate();
 const dashboard=useQuery({queryKey:['dashboard',scope],queryFn:async()=>{const value=await api<Dashboard>('/workspace/dashboard');return {...value,layout:parseLayout(value.layout)};}});
 const chat=useQuery({queryKey:['chat',scope],queryFn:()=>api<Chat>('/chat'),refetchInterval:q=>q.state.data?.turns.some(t=>t.status==='pending')?2500:false});
 const {draft,setDraft,pending,setPending,restored,storageFailed}=useChatRecovery(account.accountId);
 const [notice,setNotice]=useState(''),[deliverySupport,setDeliverySupport]=useState<string|null>(null),[chatProblem,setChatProblem]=useState<{text:string;support:string}|null>(null),[ack,setAck]=useState(''),[pendingText,setPendingText]=useState(restored?.content??''),[deliveryError,setDeliveryError]=useState(restored?'An interrupted request was recovered from this tab. We’ll check your saved conversation before you retry.':'');
 const composer=useRef<HTMLTextAreaElement>(null);
 const restoredPending=useRef(!!restored);
 // A restored request needs a read made after this mount. Returning from a fixed
 // page can find a still-fresh cached conversation, which would never refetch.
 useEffect(()=>{if(restoredPending.current)void chat.refetch();},[]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  if(!restoredPending.current||!pending.current||!chat.data||chat.error||!chat.isFetchedAfterMount)return;
  const request=pending.current;
  if(chat.data.turns.some(turn=>matchesChatRequest(turn,request))){
   setPending(null);setPendingText('');setDeliveryError('');setDraft(value=>value.trim()===request.content?'':value);setNotice('Your interrupted request is already saved in Chat.');restoredPending.current=false;
  }else setDeliveryError('Your interrupted request hasn’t been confirmed yet. Retry uses its original details and won’t start a second copy.');
 },[chat.data,chat.error,chat.isFetchedAfterMount,pending,setPending,setDraft]);
 const waitingForReply=!!chat.data?.turns.some(turn=>turn.status==='pending');
 const previousReplies=useRef<Chat['turns']|undefined>(undefined);
 const [replyNotice,setReplyNotice]=useState({key:0,text:''});
 useEffect(()=>{
  if(!chat.data)return;
  const updates=updatedReplies(previousReplies.current,chat.data.turns);
  previousReplies.current=chat.data.turns;
  if(updates.length)setReplyNotice(current=>({key:current.key+1,text:updates.length===1?'New reply from Whumpo in Chat.':`${updates.length} new replies from Whumpo in Chat.`}));
 },[chat.data]);
 const chatScroll=useChatScroll(view==='chat'&&!!profile.data,JSON.stringify([chat.data?.turns,ack,pendingText]));
 const mutation=useMutation({mutationFn:async(request:ChatRequest)=>presentWithAcknowledgment(submitChat(request,r=>r.action?send<Chat>('/chat/actions',{id:r.id,revision:r.revision,action:r.action}):send<Chat>('/chat',r),()=>api<Chat>('/chat')),{showAck:setAck,hideAck:()=>setAck(''),readAck:async()=>(await api<{ack:string|null}>('/chat/'+request.id+'/ack')).ack}),onSuccess:(result,request)=>{void queryClient.invalidateQueries({queryKey:['saved-chat-turn',scope]});setDeliveryError('');setDeliverySupport(null);setChatProblem(null);queryClient.setQueryData(['chat',scope],result);setPending(null);restoredPending.current=false;setPendingText('');setDraft(current=>current.trim()===request.content?'':current);void queryClient.invalidateQueries({queryKey:['github-grant-reviews']});void queryClient.invalidateQueries({queryKey:['connections']});void queryClient.invalidateQueries({queryKey:['dashboard']});void queryClient.invalidateQueries({queryKey:['billing']});void queryClient.invalidateQueries({queryKey:['domain-controls'],refetchType:'none'});},onError:error=>{void queryClient.invalidateQueries({queryKey:['saved-chat-turn',scope]});const support=error instanceof APIError?error.support??null:null;if(canRecoverChat(error)){setDeliveryError('The connection dropped before we could confirm your message. Retry checks the same request, without starting it again.');setDeliverySupport(support);}else{if(support)setChatProblem({text:message(error),support});else setNotice(message(error));setPending(null);restoredPending.current=false;setPendingText('');void queryClient.invalidateQueries({queryKey:['chat']});}}});
 // `/workspace` is the one Chat route; other views use their own path.
 const open=(target:string,project?:string)=>target==='chat'?navigate({to:'/workspace',search:{signup:false}}):navigate({to:'/workspace/$view',params:{view:target},search:{project}});
 const requestedLocation=chatLocationTarget(location.searchStr),locationParams=new URLSearchParams(location.searchStr),invalidChatLocation=!requestedLocation&&(locationParams.has('turn')||locationParams.has('interaction'));
 const chatLocation=useChatLocation(scope,requestedLocation,invalidChatLocation),openedInteraction=chatLocation.target?.kind==='interaction'?chatLocation.target.id:null,openedTurn=chatLocation.target?.kind==='turn'?chatLocation.target.id:null,focusedReturn=useRef<string|null>(null);
 async function openSavedForm(id:string){
  chatLocation.select({kind:'interaction',id});focusedReturn.current=null;
  void queryClient.invalidateQueries({queryKey:['chat-interaction',scope,id]});
  await navigate({to:'/workspace',search:{signup:false,interaction:id}});
 }
 async function openSavedTurn(id:string){
  chatLocation.select({kind:'turn',id});focusedReturn.current=null;
  void queryClient.invalidateQueries({queryKey:['saved-chat-turn',scope,id]});
  await navigate({to:'/workspace',search:{signup:false,turn:id}});
 }
 async function closeSavedItem(){
  chatLocation.select(null);focusedReturn.current=null;
  await navigate({to:'/workspace',search:{signup:false},replace:true});
  requestAnimationFrame(()=>composer.current?.focus());
 }
 async function sendMessage(content:string){content=content.trim();if(!content||mutation.isPending)return;await submitMessage(content,false);}
 async function runAction(action:ChatControl){const control=chatControl(action);if(!control)throw Error('This action is not available.');if(control.recentAuth)await identityCeremony('reauth');await submitMessage(control.label,false,control.action);}
 async function submitMessage(content:string,stayOnPage:boolean,action?:ChatControl){
  if(waitingForReply){setNotice('Whumpo is still working on your previous request.');if(action)throw Error('Wait for the current reply to finish.');return;}
  if(!chat.data||mutation.isPending){if(action)throw Error('Wait for the current message to finish.');return;}
  if(pending.current){setNotice('Resolve the previous message with Retry before sending another.');await open('chat');if(action)throw Error('Resolve the previous message with Retry first.');return;}
  const request={id:crypto.randomUUID(),revision:chat.data.state.revision,content,...(action?{action}:{})};setPending(request);setPendingText(content);
  setDeliveryError('');setChatProblem(null);if(!stayOnPage){if(view!=='chat')await open('chat');chatScroll.latest();if(!action)composer.current?.focus();}
  const result=await mutation.mutateAsync(request).catch(()=>undefined);
  // Uncertain delivery uses the same shared retry control and request ID as Chat.
  if(!result&&stayOnPage&&pending.current)await open('chat');
  if(!result&&action)throw Error(pending.current?'Delivery is uncertain. Use Retry in Chat to check this same action.':'The action was not accepted. Check the message in Chat.');
  return result?.turns.find(turn=>turn.id===request.id)?.assistant_text;
 }
 async function runDomainAction(action:ChatControl){
  const control=chatControl(action);if(!control||!['domainProof','checkDomainProof'].includes(control.action.type))throw Error('Choose a valid domain ownership action.');
  return submitMessage(control.label,true,control.action);
 }

 useEffect(()=>{const result=providerReturn(location.searchStr);if(result){setNotice(result.notice);void queryClient.invalidateQueries({queryKey:['connections']});void queryClient.invalidateQueries({queryKey:['connection-handoff']});void queryClient.invalidateQueries({queryKey:['dashboard']});if(result.view==='chat')void navigate({to:'/workspace',search:{signup:false,interaction:result.interactionId},replace:true});else void navigate({to:'/workspace/$view',params:{view:result.view},search:{},replace:true});}},[location.searchStr,navigate]);
 useEffect(()=>{
  if(view!=='chat'){focusedReturn.current=null;return;}
  const id=openedTurn??openedInteraction;if(!id||!openedTurn&&!chat.data)return;
  const target=scope+':'+(openedTurn?'turn:':'interaction:')+id;if(focusedReturn.current===target)return;
  // A restored read must not interrupt a newer answer or message being typed.
  if(document.activeElement?.matches('input,textarea,[contenteditable=true]')){focusedReturn.current=target;return;}
  const frame=requestAnimationFrame(()=>{const card=document.querySelector<HTMLElement>('['+(openedTurn?'data-saved-turn-id':'data-interaction-id')+'="'+CSS.escape(id)+'"]');if(card){focusedReturn.current=target;card.scrollIntoView({block:'center'});card.focus({preventScroll:true});}});
  return()=>cancelAnimationFrame(frame);
 },[openedInteraction,openedTurn,view,chat.data,scope]);
 useEffect(()=>{if(view!=='chat')document.querySelector('.workspace-main')?.scrollTo({top:0,behavior:'instant'});},[view,location.search.project]);
 useEffect(()=>{const field=composer.current;if(field){field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px';}},[draft,view,profile.data]);

 useEffect(()=>{document.title=(profile.data&&!profile.data.onboardingComplete?'Welcome':view==='cms'?'Publishing desk':view==='chat'?'Chat':view==='missing'?'Page not found':dashboard.data?.layout.tabs.find(t=>t.id===view)?.label??(view.startsWith('tab-')?'Your page':view.charAt(0).toUpperCase()+view.slice(1)))+' — Whumpo';},[view,profile.data?.onboardingComplete,dashboard.data?.layout.tabs]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),7000);return()=>clearTimeout(timer);},[notice]);
 const tab=dashboard.data?.layout.tabs.find(t=>t.id===view);const avatar=profilePicture(profile.data);
 return <Context.Provider value={{profile:profile.data,dashboard:dashboard.data,dashboardRead:{error:dashboard.error,fetching:dashboard.isFetching,retry:async()=>!(await dashboard.refetch()).error},sendMessage,runAction,runDomainAction,commandBusy:mutation.isPending||waitingForReply||!chat.data,notify:setNotice}}><div aria-live="polite" aria-atomic="true" className="sr-only"><span key={replyNotice.key}>{replyNotice.text}</span></div><a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-5 focus:py-3 focus:shadow-lg">Skip to workspace</a><div className="workspace-grid"><aside className="desktop-sidebar bg-card border-r flex flex-col p-3 sm:p-5 min-h-0 overflow-y-auto"><div className="px-1 py-4 mb-5 shrink-0"><Brand compact/></div><nav aria-label="Workspace" className="sidebar-nav flex flex-col gap-2 min-h-0 flex-1 overflow-y-auto"><Link aria-label="Chat" to="/workspace" search={{signup:false}} activeOptions={{exact:true}} className={'flex gap-3 items-center rounded-md px-3 py-3 text-sm '+(view==='chat'?'bg-secondary font-semibold':'')}><MessageCircle className="size-5 shrink-0"/><span className="sidebar-label">Chat</span></Link><Link aria-label="Dashboard" to="/workspace/$view" params={{view:'dashboard'}} className="flex gap-3 items-center rounded-md px-3 py-3 text-sm"><LayoutDashboard className="size-5 shrink-0"/><span className="sidebar-label">Dashboard</span></Link><p className="sidebar-label text-xs font-semibold tracking-[.16em] uppercase text-ink-muted mt-6 px-3 mb-2">Your pages</p>{dashboard.data?.layout.tabs.map(t=><Link key={t.id} aria-label={pageAccessibleName(t.label)} to="/workspace/$view" params={{view:t.id}} className="flex items-center gap-3 px-3 py-3 rounded-md text-sm"><PanelTop className="size-5 shrink-0"/><span className="sidebar-label min-w-0 break-words">{pageNavigationLabel(t.label)}</span></Link>)}{dashboard.data&&!dashboard.data.layout.tabs.length&&<div className="sidebar-extra mt-2 rounded-lg border border-dashed p-4"><Sparkles className="size-4 text-link mb-3"/><p className="text-xs font-semibold">Optional pages for your work.</p><p className="text-xs text-muted-foreground mt-2">Chat can do everything. Ask Whumpo for a page if you want one.</p><Button variant="link" className="px-0 h-auto text-xs mt-3" onClick={async()=>{await open('chat');setDraft('Help me build a custom page for my workflow.');requestAnimationFrame(()=>composer.current?.focus());}}>Ask Whumpo <ArrowRight className="size-3"/></Button></div>}</nav><EssentialNavigation/><div className="sidebar-footer shrink-0 pt-4 flex items-center justify-between gap-3"><Button asChild variant="quiet" size="icon" aria-label="Settings"><Link to="/workspace/$view" params={{view:'settings'}}><Settings className="size-5"/></Link></Button><Link to="/workspace/$view" params={{view:'profile'}} aria-label="Your profile" className="rounded-full border-2 border-background ring-1 ring-border overflow-hidden"><img src={avatar} alt="" width="38" height="38"/></Link></div></aside><MobileNavigation view={view} avatar={avatar}/><main id="workspace-content" data-recovery-surface tabIndex={-1} className="workspace-main min-w-0 min-h-0 overflow-auto">{view==='chat'?<div className="chat-view flex flex-col h-full"><div ref={chatScroll.scrollRef} onScroll={chatScroll.onScroll} className="chat-scroll min-h-0 overflow-y-auto flex-1 px-5 sm:px-10 pt-9"><div className="max-w-[800px] mx-auto" role="region" aria-label="Conversation"><QueryRecovery name="conversation" error={chat.error} fetching={chat.isFetching} hasData={!!chat.data} retry={async()=>!(await chat.refetch()).error}/><div className="chat-intro flex items-center gap-3 mb-9"><img src="/brand/whumpo-mascot.png" alt="" className="size-14 object-contain"/><div><h1 className="font-bold text-2xl">A little help for your next big idea.</h1><p className="text-xs text-muted-foreground">{chat.data?`${chat.data.stats.projects} projects · ${chat.data.stats.live} live`:"Your saved work stays private."}</p></div></div>{invalidChatLocation&&<p role="alert" className="text-sm mb-4">This saved Chat link is not valid. Find your message or form in past messages.</p>}{chatLocation.target&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-secondary/50 p-3 mb-4"><p className="text-sm">Your reopened Chat item is below.</p><Button variant="quiet" className="min-h-11" onClick={()=>void closeSavedItem().catch(error=>setNotice(message(error)))}>Close saved item</Button></div>}{openedTurn&&<SavedChatTurn key={scope+':'+openedTurn} owner={scope} id={openedTurn}>{t=><ChatTurnEntry t={t} scope={scope} revision={chat.data?.state.revision??0} busy={mutation.isPending||waitingForReply||!!pending.current||!chat.data||!!chat.error} onAction={runAction} onAnswerInChat={()=>composer.current?.focus()}/>}</SavedChatTurn>}{chat.data&&<>{!!chat.data?.turns.length&&<div className="mb-5"><ChatHistoryDialog before={Number(chat.data?.state.revision)+1} owner={scope} onOpenForm={id=>void openSavedForm(id).catch(error=>setNotice(message(error)))} onOpenTurn={id=>void openSavedTurn(id).catch(error=>setNotice(message(error)))}/></div>}<Bubble role="assistant" content={chat.data?.greeting??''}/>{openedInteraction&&!chat.data.turns.some(t=>t.interaction_id===openedInteraction)&&<ChatInteraction key={scope+':opened:'+openedInteraction} id={openedInteraction} owner={scope} chatRevision={chat.data.state.revision} busy={mutation.isPending||waitingForReply||!!pending.current} onAnswerInChat={()=>composer.current?.focus()}/>}{chat.data.turns.filter(t=>t.id!==openedTurn).map(t=><ChatTurnEntry key={t.id} t={t} scope={scope} revision={chat.data.state.revision} busy={mutation.isPending||waitingForReply||!!pending.current} onAction={runAction} onAnswerInChat={()=>composer.current?.focus()}/>)}{chat.data?.firstDraft&&<FirstDraftCard project={chat.data.firstDraft} ai={chat.data.mode==='ai'} busy={mutation.isPending||!!deliveryError||!!pendingText||!!chat.data.turns.some(t=>t.status==='pending')} onSend={content=>sendMessage(content).catch(e=>setNotice(message(e)))}/>}{pendingText&&!chat.data?.turns.some(t=>t.id===pending.current?.id)&&<Bubble role="user" content={<ChatRequestMessage text={pendingText}/>}/>} {ack&&<div role="status"><Bubble role="assistant" content={ack}/></div>}</>}</div></div><div className="chat-composer relative px-5 sm:px-10 pt-4 pb-5">{deliveryError&&<div role="alert" className="max-w-[800px] mx-auto mb-3 rounded-md border bg-card p-4 text-sm"><p>{deliveryError}</p>{pending.current?.action&&<p className="mt-2 font-medium">{chatControl(pending.current.action)?.label}</p>}<Button type="button" variant="secondary" size="sm" className="mt-3" disabled={mutation.isPending||restoredPending.current&&(!chat.isFetchedAfterMount||!!chat.error)} onClick={()=>{if(pending.current){setDeliveryError('');composer.current?.focus();void mutation.mutateAsync(pending.current).catch(()=>{});}}}>Retry message</Button>{deliverySupport&&<Button asChild variant="link" size="sm" className="mt-3 min-h-11 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'support'}} search={{ref:deliverySupport}}>Get help with this</Link></Button>}</div>}{chatProblem&&!deliveryError&&<div role="alert" className="max-w-[800px] mx-auto mb-3 rounded-md border bg-card p-4 text-sm"><p>{chatProblem.text}</p><div className="mt-3 flex flex-wrap gap-2"><Button asChild variant="secondary" size="sm" className="min-h-11 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'support'}} search={{ref:chatProblem.support}}>Get help with this</Link></Button><Button type="button" variant="quiet" size="sm" className="min-h-11" onClick={()=>{setChatProblem(null);composer.current?.focus();}}>Dismiss</Button></div></div>}<form className="max-w-[800px] mx-auto bg-surface-raised rounded-lg border border-line-strong shadow-sm p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring" onSubmit={e=>{e.preventDefault();void sendMessage(draft).catch(e=>setNotice(message(e)))}}><Textarea ref={composer} aria-label="Message Whumpo" enterKeyHint="enter" rows={2} onInput={e=>{const field=e.currentTarget;field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px'}} placeholder="Tell Whumpo what you need…" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&matchMedia('(min-width: 761px) and (pointer: fine)').matches){e.preventDefault();void sendMessage(draft).catch(e=>setNotice(message(e)))}}} className="border-0 bg-transparent shadow-none resize-none min-h-18 focus-visible:outline-none"/><div className="flex justify-between items-center pt-2">{chatScroll.away?<Button type="button" variant="quiet" size="sm" className="min-h-11 h-auto min-w-0 whitespace-normal" onClick={chatScroll.latest}><ArrowUp className="size-4 rotate-180"/>Latest messages</Button>:<Button type="button" variant="quiet" size="sm" className="min-h-11 h-auto min-w-0 whitespace-normal" disabled={mutation.isPending||waitingForReply||!!pending.current||!chat.data} onClick={()=>void sendMessage('What can you help me do with my project?')}>What can I ask?</Button>}<Button type="submit" size="icon" aria-label="Send message" disabled={mutation.isPending||waitingForReply||!!deliveryError||!draft.trim()||!chat.data} className="shrink-0">{mutation.isPending?<LoaderCircle className="size-4 animate-spin"/>:<ArrowUp className="size-5"/>}</Button></div></form>{(storageFailed||chatLocation.storageFailed)&&<p role="status" className="max-w-[800px] mx-auto mt-2 text-xs text-muted-foreground">This browser couldn’t save recovery details. Keep this tab open until your message finishes.</p>}<p className="text-[10px] text-muted-foreground text-center max-w-[800px] mx-auto mt-3">{!chat.data?'Your conversation will be available when the connection is restored.':chat.data.mode==='ai'?'Standard AI uses no credits. The testing model may use messages for training. Avoid confidential information.':'The assistant is temporarily unavailable. Saved work, site safety, support and account controls still work without it.'} {chat.data?.mode!=='ai'&&<><Link className="underline" to="/workspace/$view" params={{view:'saved-work'}} search={{}}>Open saved work</Link> · </>}<Link className="underline" to="/workspace/$view" params={{view:'support'}} search={{}}>Get help</Link></p></div></div>:<DeferredArea key={view} label="Opening your page…">{view==='profile'?<ProfilePage/>:view==='settings'?<SettingsPage/>:view==='dashboard'||tab?<DashboardPage tab={tab}/>:<ControlPage view={view}/>}</DeferredArea>}</main></div>{notice&&<div role="status" className="workspace-toast fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] rounded-md border bg-card px-5 py-3 shadow-lg text-sm">{notice}</div>}</Context.Provider>}
// Text turns use the design system ChatMessage bubble; review cards and controls sit beside it, not inside it.
function Bubble({role,content,children}:{role:'user'|'assistant';content:ReactNode;children?:ReactNode}){const text=typeof content==='string'||role==='user';return <div className="mb-7">{text?<ChatMessage from={role==='user'?'you':'whumpo'} label={role==='user'?'You':'Whumpo'}><div className="message-content">{role==='assistant'&&typeof content==='string'?<ChatReply text={content}/>:content}</div></ChatMessage>:<article className="min-w-0"><p className="mb-2 text-xs font-semibold text-ink-muted">Whumpo</p>{content}</article>}{Children.toArray(children).length>0&&<div className="mt-3 min-w-0">{children}</div>}</div>}

function ChatTurnEntry({t,scope,revision,busy,onAction,onAnswerInChat}:{t:Turn;scope:string;revision:number;busy:boolean;onAction:(action:ChatControl)=>Promise<void>;onAnswerInChat:()=>void}){return <div><Bubble role="user" content={<ChatRequestMessage text={t.user_text}/>}/><Bubble role="assistant" content={t.github_grant_review?<GitHubGrantReviewCard review={t.github_grant_review} busy={busy} onAction={onAction}/>:t.app_maintenance_review?<AppMaintenanceCard review={t.app_maintenance_review} busy={busy} onAction={onAction}/>:t.application_review?<ApplicationReviewCard review={t.application_review}/>:t.app_restore_review?<AppRestoreReviewCard review={t.app_restore_review} busy={busy} onAction={onAction}/>:t.app_page_review?<AppPageReviewCard review={t.app_page_review}/>:t.assistant_text||savedTurnFallback(t.status)}>{!!t.specification_review&&<SpecificationReviewDetails key={scope+':'+t.id} owner={scope} value={t.specification_review}/>}<TurnActions turn={t} onAction={onAction} busy={busy}/>{t.interaction_id&&<ChatInteraction key={scope+':'+t.interaction_id} id={t.interaction_id} owner={scope} chatRevision={revision} busy={busy} onAnswerInChat={onAnswerInChat}/>}</Bubble></div>;}
