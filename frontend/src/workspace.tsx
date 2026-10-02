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
import {MobileNavigation,useMobileViewport} from './mobile-workspace';
import {submitChat,canRecoverChat,matchesChatRequest,type ChatRequest} from './lib/chat-delivery';
import {presentWithAcknowledgment} from '../../web/ack-timing.js';
import {lazy,useEffect,useRef,useState,createContext,useContext,type ReactNode} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {Link,useNavigate,useRouterState} from '@tanstack/react-router';
import {MessageCircle,LayoutDashboard,Settings,UserRound,PanelTop,ArrowUp,Plus,Sparkles,LoaderCircle,ArrowRight} from 'lucide-react';
import {api,send,message,APIError,queryClient,type Profile,type Chat,type Dashboard} from './lib/api';
import {Button} from './components/ui/button';
import {Textarea} from './components/ui/textarea';
import {Brand} from './components/brand';
import {IdentityGate} from './identity/flow';
import {providerReturn} from './lib/workspace-navigation';
import {DeferredArea} from './deferred-area';
import {QueryRecovery} from './query-recovery';
import {updatedReplies} from './lib/chat-announcements';
const DashboardPage=lazy(()=>import('./workspace-pages').then(module=>({default:module.DashboardPage})));
const SettingsPage=lazy(()=>import('./workspace-pages').then(module=>({default:module.SettingsPage})));
const ProfilePage=lazy(()=>import('./workspace-pages').then(module=>({default:module.ProfilePage})));
const ControlPage=lazy(()=>import('./workspace-pages').then(module=>({default:module.ControlPage})));
const Context=createContext<{profile:Profile;dashboard?:Dashboard;dashboardRead:{error:unknown;fetching:boolean;retry:()=>Promise<boolean>};sendMessage:(content:string)=>Promise<void>;runAction:(action:ChatControl)=>Promise<void>;runDomainAction:(action:ChatControl)=>Promise<string|undefined>;commandBusy:boolean;notify:(message:string)=>void}>({profile:null!,dashboardRead:{error:null,fetching:false,retry:async()=>false},sendMessage:async()=>{},runAction:async()=>{},runDomainAction:async()=>undefined,commandBusy:false,notify:()=>{}});
export const useWorkspace=()=>useContext(Context);
export function Workspace(){
 useMobileViewport();
 const location=useRouterState({select:s=>s.location});
 return <IdentityGate signup={['1','true'].includes(new URLSearchParams(location.searchStr).get('signup')??'')}><WorkspaceProfile/></IdentityGate>;
}
function WorkspaceProfile(){
 const profile=useQuery({queryKey:['session'],queryFn:async()=>{
  const next=await api<Profile>('/profile'),previous=queryClient.getQueryData<Profile>(['session']);
  if(previous&&previous.accountId!==next.accountId)queryClient.removeQueries({predicate:q=>q.queryKey[0]!=='session'});
  return next;
 }});
 useEffect(()=>{const theme=profile.data?.theme??'system',media=matchMedia('(prefers-color-scheme: dark)'),apply=()=>document.documentElement.classList.toggle('dark',theme==='dark'||theme==='system'&&media.matches);apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);},[profile.data?.theme]);
 useEffect(()=>{if(profile.data&&!profile.data.onboardingComplete)document.title="Welcome — Whumpo";},[profile.data?.onboardingComplete]);
 if(profile.isPending)return <div className="min-h-dvh grid place-items-center"><LoaderCircle className="animate-spin size-6" aria-label="Opening your workspace"/></div>;
 if(profile.error)return <main className="page-pad"><h1>Couldn’t open your workspace</h1><p role="alert">{message(profile.error)}</p><Button onClick={()=>profile.refetch()}>Try again</Button></main>;
 if(!profile.data)return null;
 if(!profile.data.onboardingComplete)return <Onboarding profile={profile.data}/>;
 return <WorkspaceSession key={profile.data.accountId} account={profile.data}/>;
}
function WorkspaceSession({account}:{account:Profile}){
 const profile={data:account},scope=account.accountId;
 const location=useRouterState({select:s=>s.location}),view=location.pathname.split('/')[2]||'chat',navigate=useNavigate();
 const dashboard=useQuery({queryKey:['dashboard',scope],queryFn:()=>api<Dashboard>('/workspace/dashboard')});
 const chat=useQuery({queryKey:['chat',scope],queryFn:()=>api<Chat>('/chat'),refetchInterval:q=>q.state.data?.turns.some(t=>t.status==='pending')?2500:false});
 const {draft,setDraft,pending,setPending,restored,storageFailed}=useChatRecovery(account.accountId);
 const [notice,setNotice]=useState(''),[ack,setAck]=useState(''),[pendingText,setPendingText]=useState(restored?.content??''),[deliveryError,setDeliveryError]=useState(restored?'An interrupted request was recovered from this tab. We’ll check your saved conversation before you retry.':'');
 const composer=useRef<HTMLTextAreaElement>(null);
 const restoredPending=useRef(!!restored);
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
 const mutation=useMutation({mutationFn:async(request:ChatRequest)=>presentWithAcknowledgment(submitChat(request,r=>r.action?send<Chat>('/chat/actions',{id:r.id,revision:r.revision,action:r.action}):send<Chat>('/chat',r),()=>api<Chat>('/chat')),{showAck:setAck,hideAck:()=>setAck(''),readAck:async()=>(await api<{ack:string|null}>('/chat/'+request.id+'/ack')).ack}),onSuccess:(result,request)=>{setDeliveryError('');queryClient.setQueryData(['chat',scope],result);setPending(null);restoredPending.current=false;setPendingText('');setDraft(current=>current.trim()===request.content?'':current);void queryClient.invalidateQueries({queryKey:['github-grant-reviews']});void queryClient.invalidateQueries({queryKey:['connections']});void queryClient.invalidateQueries({queryKey:['dashboard']});void queryClient.invalidateQueries({queryKey:['billing']});void queryClient.invalidateQueries({queryKey:['domain-controls'],refetchType:'none'});},onError:error=>{if(canRecoverChat(error)){setDeliveryError('The connection dropped before we could confirm your message. Retry checks the same request, without starting it again.');}else{setNotice(message(error));setPending(null);restoredPending.current=false;setPendingText('');void queryClient.invalidateQueries({queryKey:['chat']});}}});
 const open=(target:string,project?:string)=>navigate({to:'/workspace/$view',params:{view:target},search:{project}});
 function resumeVisibleForm(id:string){
  if(!chat.data?.turns.some(turn=>turn.interaction_id===id))return null;
  return ()=>{
   void queryClient.invalidateQueries({queryKey:['chat-interaction',scope,id]});
   requestAnimationFrame(()=>{const card=document.querySelector<HTMLElement>('[data-interaction-id="'+CSS.escape(id)+'"]');card?.scrollIntoView({block:'center'});card?.focus({preventScroll:true});});
  };
 }
 async function sendMessage(content:string){content=content.trim();if(!content||mutation.isPending)return;await submitMessage(content,false);}
 async function runAction(action:ChatControl){const control=chatControl(action);if(!control)throw Error('This action is not available.');if(control.recentAuth)await identityCeremony('reauth');await submitMessage(control.label,false,control.action);}
 async function submitMessage(content:string,stayOnPage:boolean,action?:ChatControl){
  if(waitingForReply){setNotice('Whumpo is still working on your previous request.');if(action)throw Error('Wait for the current reply to finish.');return;}
  if(!chat.data||mutation.isPending){if(action)throw Error('Wait for the current message to finish.');return;}
  if(pending.current){setNotice('Resolve the previous message with Retry before sending another.');await open('chat');if(action)throw Error('Resolve the previous message with Retry first.');return;}
  const request={id:crypto.randomUUID(),revision:chat.data.state.revision,content,...(action?{action}:{})};setPending(request);setPendingText(content);
  setDeliveryError('');if(!stayOnPage){await open('chat');chatScroll.latest();if(!action)composer.current?.focus();}
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

 useEffect(()=>{const result=providerReturn(location.searchStr);if(result){setNotice(result.notice);void queryClient.invalidateQueries({queryKey:[result.view]});void queryClient.invalidateQueries({queryKey:['dashboard']});void navigate({to:'/workspace/$view',params:{view:result.view},search:{},replace:true});}},[location.searchStr,navigate]);
 useEffect(()=>{if(view!=='chat')document.querySelector('.workspace-main')?.scrollTo({top:0,behavior:'instant'});},[view,location.search.project]);
 useEffect(()=>{const field=composer.current;if(field){field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px';}},[draft,view,profile.data]);

 useEffect(()=>{document.title=(profile.data&&!profile.data.onboardingComplete?'Welcome':view==='cms'?'Publishing desk':view==='chat'?'Chat':dashboard.data?.layout.tabs.find(t=>t.id===view)?.label??(view.startsWith('tab-')?'Your page':view.charAt(0).toUpperCase()+view.slice(1)))+' — Whumpo';},[view,profile.data?.onboardingComplete,dashboard.data?.layout.tabs]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),7000);return()=>clearTimeout(timer);},[notice]);
 const tab=dashboard.data?.layout.tabs.find(t=>t.id===view);const avatar=profilePicture(profile.data);
 return <Context.Provider value={{profile:profile.data,dashboard:dashboard.data,dashboardRead:{error:dashboard.error,fetching:dashboard.isFetching,retry:async()=>!(await dashboard.refetch()).error},sendMessage,runAction,runDomainAction,commandBusy:mutation.isPending||waitingForReply||!chat.data,notify:setNotice}}><div role="status" aria-live="polite" aria-atomic="true" className="sr-only"><span key={replyNotice.key}>{replyNotice.text}</span></div><a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-card focus:px-5 focus:py-3 focus:shadow-lg">Skip to workspace</a><div className="workspace-grid"><aside className="desktop-sidebar bg-card border-r flex flex-col p-3 sm:p-5 min-h-0"><div className="px-1 py-4 mb-7"><Brand compact/></div><nav aria-label="Workspace" className="sidebar-nav flex flex-col gap-2"><Link aria-label="Chat" to="/workspace" search={{signup:false}} activeOptions={{exact:true}} className={'flex gap-3 items-center rounded-xl px-3 py-3 text-sm '+(view==='chat'?'bg-secondary font-semibold':'')}><MessageCircle className="size-5 shrink-0"/><span className="sidebar-label">Chat</span></Link><Link aria-label="Dashboard" to="/workspace/$view" params={{view:'dashboard'}} className="flex gap-3 items-center rounded-xl px-3 py-3 text-sm"><LayoutDashboard className="size-5 shrink-0"/><span className="sidebar-label">Dashboard</span></Link><p className="sidebar-label text-[10px] font-semibold tracking-[.16em] text-muted-foreground mt-8 px-3 mb-2">YOUR PAGES</p>{dashboard.data?.layout.tabs.map(t=><Link key={t.id} aria-label={t.label} to="/workspace/$view" params={{view:t.id}} className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm"><PanelTop className="size-5 shrink-0"/><span className="sidebar-label truncate">{t.label}</span></Link>)}</nav>{dashboard.data&&!dashboard.data.layout.tabs.length&&<div className="sidebar-extra mt-2 rounded-2xl border border-dashed p-4"><Sparkles className="size-4 text-[#338cdf] mb-3"/><p className="text-xs font-semibold">A page made for your work.</p><p className="text-xs text-muted-foreground mt-2">Ask Whumpo to build a custom page around your workflow.</p><Button variant="link" className="px-0 h-auto text-xs mt-3" onClick={async()=>{await open('chat');setDraft('Help me build a custom page for my workflow.');requestAnimationFrame(()=>composer.current?.focus());}}>Ask Whumpo <ArrowRight className="size-3"/></Button></div>}<div className="sidebar-footer mt-auto pt-6 flex items-center justify-between gap-3"><Button asChild variant="ghost" size="icon" aria-label="Settings"><Link to="/workspace/$view" params={{view:'settings'}}><Settings className="size-5"/></Link></Button><Link to="/workspace/$view" params={{view:'profile'}} aria-label="Your profile" className="rounded-full border-2 border-background ring-1 ring-border overflow-hidden"><img src={avatar} alt="" width="38" height="38"/></Link></div></aside><MobileNavigation view={view} avatar={avatar}/><main id="workspace-content" data-recovery-surface tabIndex={-1} className="workspace-main min-w-0 min-h-0 overflow-auto">{view==='chat'?<div className="chat-view flex flex-col h-full"><div ref={chatScroll.scrollRef} onScroll={chatScroll.onScroll} className="chat-scroll min-h-0 overflow-y-auto flex-1 px-5 sm:px-10 pt-9"><div className="max-w-[800px] mx-auto" role="region" aria-label="Conversation"><QueryRecovery name="conversation" error={chat.error} fetching={chat.isFetching} hasData={!!chat.data} retry={async()=>!(await chat.refetch()).error}/>{chat.data&&<><div className="chat-intro flex items-center gap-3 mb-9"><img src="/brand/whumpo-mascot.png" alt="" className="size-14 object-contain"/><div><h1 className="font-extrabold text-2xl">A little help for your next big idea.</h1><p className="text-xs text-muted-foreground">{chat.data?.stats.projects??0} projects · {chat.data?.stats.live??0} live</p></div></div>{!!chat.data?.turns.length&&<div className="mb-5"><ChatHistoryDialog before={Number(chat.data?.state.revision)+1} owner={scope} chatRevision={chat.data.state.revision} busy={mutation.isPending||waitingForReply||!!pending.current} onAnswerInChat={()=>composer.current?.focus()} onResumeVisible={resumeVisibleForm}/></div>}<Bubble role="assistant" content={chat.data?.greeting??''}/>{chat.data?.turns.map(t=><div key={t.id}><Bubble role="user" content={<ChatRequestMessage text={t.user_text}/>}/><Bubble role="assistant" content={t.github_grant_review?<GitHubGrantReviewCard review={t.github_grant_review} busy={mutation.isPending} onAction={runAction}/>:t.app_maintenance_review?<AppMaintenanceCard review={t.app_maintenance_review} busy={mutation.isPending} onAction={runAction}/>:t.application_review?<ApplicationReviewCard review={t.application_review}/>:t.app_restore_review?<AppRestoreReviewCard review={t.app_restore_review} busy={mutation.isPending} onAction={runAction}/>:t.app_page_review?<AppPageReviewCard review={t.app_page_review}/>:t.assistant_text||(t.status==='pending'?'Whumpo is working on your request…':'No saved reply is available for this message.')}>{!!t.specification_review&&<SpecificationReviewDetails key={scope+':'+t.id} owner={scope} value={t.specification_review}/>}<TurnActions turn={t} onAction={runAction} busy={mutation.isPending||waitingForReply||!!pending.current}/>{t.interaction_id&&<ChatInteraction key={scope+':'+t.interaction_id} id={t.interaction_id} owner={scope} chatRevision={chat.data.state.revision} busy={mutation.isPending||waitingForReply||!!pending.current} onAnswerInChat={()=>composer.current?.focus()}/>}</Bubble></div>)}{chat.data?.firstDraft&&<FirstDraftCard project={chat.data.firstDraft} ai={chat.data.mode==='ai'} busy={mutation.isPending||!!deliveryError||!!pendingText||!!chat.data.turns.some(t=>t.status==='pending')} onSend={content=>sendMessage(content).catch(e=>setNotice(message(e)))}/>}{pendingText&&!chat.data?.turns.some(t=>t.id===pending.current?.id)&&<Bubble role="user" content={<ChatRequestMessage text={pendingText}/>}/>} {ack&&<div role="status"><Bubble role="assistant" content={ack}/></div>}</>}</div></div><div className="chat-composer relative px-5 sm:px-10 pt-4 pb-5">{deliveryError&&<div role="alert" className="max-w-[800px] mx-auto mb-3 rounded-xl border bg-card p-4 text-sm"><p>{deliveryError}</p>{pending.current?.action&&<p className="mt-2 font-medium">{chatControl(pending.current.action)?.label}</p>}<Button type="button" variant="outline" size="sm" className="mt-3" disabled={mutation.isPending||restoredPending.current&&(!chat.isFetchedAfterMount||!!chat.error)} onClick={()=>{if(pending.current){setDeliveryError('');composer.current?.focus();void mutation.mutateAsync(pending.current).catch(()=>{});}}}>Retry message</Button></div>}<form className="max-w-[800px] mx-auto bg-card rounded-2xl border shadow-[0_5px_25px_#0f2d5b06] p-3" onSubmit={e=>{e.preventDefault();void sendMessage(draft).catch(e=>setNotice(message(e)))}}><Textarea ref={composer} aria-label="Message Whumpo" enterKeyHint="enter" rows={2} onInput={e=>{const field=e.currentTarget;field.style.height='auto';field.style.height=Math.min(field.scrollHeight,160)+'px'}} placeholder="Tell Whumpo what you need…" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&matchMedia('(min-width: 761px) and (pointer: fine)').matches){e.preventDefault();void sendMessage(draft).catch(e=>setNotice(message(e)))}}} className="border-0 shadow-none resize-none min-h-18 focus-visible:ring-0"/><div className="flex justify-between items-center pt-2">{chatScroll.away?<Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={chatScroll.latest}><ArrowUp className="size-4 rotate-180"/>Latest messages</Button>:<Button type="button" variant="ghost" size="sm" disabled={mutation.isPending||waitingForReply||!!pending.current||!chat.data} onClick={()=>void sendMessage('What can you help me do with my project?')}>What can I ask?</Button>}<Button type="submit" size="icon" aria-label="Send message" disabled={mutation.isPending||waitingForReply||!!deliveryError||!draft.trim()||!chat.data} className="rounded-xl">{mutation.isPending?<LoaderCircle className="size-4 animate-spin"/>:<ArrowUp className="size-5"/>}</Button></div></form>{storageFailed&&<p role="status" className="max-w-[800px] mx-auto mt-2 text-xs text-muted-foreground">This browser couldn’t save recovery details. Keep this tab open until your message finishes.</p>}<p className="text-[10px] text-muted-foreground text-center max-w-[800px] mx-auto mt-3">{!chat.data?'Your conversation will be available when the connection is restored.':chat.data.mode==='ai'?'Standard AI uses no credits. The testing model may use messages for training. Avoid confidential information.':'The assistant is temporarily unavailable. Your saved work and Dashboard controls remain available.'}</p></div></div>:<DeferredArea key={view} label="Opening your page…">{view==='profile'?<ProfilePage/>:view==='settings'?<SettingsPage/>:view==='dashboard'||tab?<DashboardPage tab={tab}/>:<ControlPage view={view}/>}</DeferredArea>}</main></div>{notice&&<div role="status" className="workspace-toast fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] rounded-xl border bg-card px-5 py-3 shadow-lg text-sm">{notice}</div>}</Context.Provider>}
function Bubble({role,content,children}:{role:'user'|'assistant';content:ReactNode;children?:ReactNode}){return <article className={'mb-7 '+(role==='user'?'ml-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-secondary px-5 py-4':'pr-4')}><p className="text-[11px] text-muted-foreground font-semibold mb-2">{role==='user'?'You':'Whumpo'}</p><div className="message-content text-sm">{role==='assistant'&&typeof content==='string'?<ChatReply text={content}/>:content}</div>{children}</article>}
