import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {readInteractionIndex,type InteractionCursor} from '../../src/chat-interactions/history-shape';
import {ChatReply} from './chat-reply';
import {ChatRequest} from './chat-request';
import {ChatInteraction} from './chat-interaction';
import {ChatInteractionHistory,continuationLabel} from './chat-interaction-history';
import {APIError,api,message} from './lib/api';
import {Input} from './components/ui/input';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from './components/ui/dialog';
import {Tabs,TabsContent,TabsList,TabsTrigger} from './components/ui/tabs';

type History={turns:{id:string;revision:number;user_text:string;assistant_text:string;created_at:string;status:string;mode:string;interaction?:unknown}[];nextBefore:number|null};
type Props={before:number;owner:string;chatRevision:number;busy:boolean;onAnswerInChat:()=>void;onResumeVisible:(id:string)=>(()=>void)|null};
export function ChatHistoryDialog(props:Props){
 const [open,setOpen]=useState(false);
 const afterClose=useRef<(()=>void)|null>(null);
 return <Dialog open={open} onOpenChange={setOpen}>
  <DialogTrigger asChild><Button variant="ghost" size="sm">Find past messages</Button></DialogTrigger>
  <DialogContent onCloseAutoFocus={event=>{const resume=afterClose.current;afterClose.current=null;if(resume){event.preventDefault();resume();}}} className="max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden p-4 sm:p-6 [&>button:last-child]:size-11 [&>button:last-child]:grid [&>button:last-child]:place-items-center [&>button:last-child]:right-2 [&>button:last-child]:top-2">
   {open&&<HistoryContent {...props} onClose={resume=>{afterClose.current=resume??null;setOpen(false);}}/>}
  </DialogContent>
 </Dialog>;
}
function HistoryContent({before,owner,chatRevision,busy,onAnswerInChat,onResumeVisible,onClose}:Props&{onClose:(resume?:()=>void)=>void}){
 const [mode,setMode]=useState('messages'),[selected,setSelected]=useState<string|null>(null),[positions,setPositions]=useState<number[]>([before]),[draft,setDraft]=useState(''),[search,setSearch]=useState('');
 const [formPositions,setFormPositions]=useState<(InteractionCursor|null)[]>([null]);
 const heading=useRef<HTMLHeadingElement>(null),initial=useRef(true);
 useEffect(()=>{if(initial.current){initial.current=false;return;}heading.current?.focus();},[selected]);
 function openForm(id:string){const resume=onResumeVisible(id);if(resume){onClose(resume);return;}setSelected(id);}
 const answerInChat=()=>onClose(onAnswerInChat);
 return <>
  <DialogHeader className="pr-10 text-left"><DialogTitle ref={heading} tabIndex={-1}>{selected?'Continue your saved form':'Past messages & forms'}</DialogTitle><DialogDescription>{selected?'Read the current form before continuing. Your website still needs its separate save and publication reviews.':'Find past messages or unfinished forms. Opening either sends nothing to the agent.'}</DialogDescription></DialogHeader>
  {selected?<><Button variant="ghost" className="self-start min-h-11" onClick={()=>setSelected(null)}>Back to {mode==='forms'?'saved forms':'messages'}</Button><div className="min-h-0 overflow-y-auto overscroll-contain pr-1" aria-label="Current saved form"><ChatInteraction key={selected} id={selected} owner={owner} chatRevision={chatRevision} busy={busy} onAnswerInChat={answerInChat}/></div></>:<Tabs value={mode} onValueChange={setMode} className="min-h-0 flex flex-col gap-3">
   <TabsList className="grid grid-cols-2 h-auto shrink-0" aria-label="Find past work"><TabsTrigger value="messages" className="min-h-11">Messages</TabsTrigger><TabsTrigger value="forms" className="min-h-11">Saved forms</TabsTrigger></TabsList>
   <TabsContent value="messages" className="min-h-0 flex flex-col gap-3 mt-0">
    <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();setSearch(draft.trim());setPositions([before]);}}>
     <Input aria-label="Search saved messages" type="search" value={draft} onChange={event=>setDraft(event.target.value)} maxLength={100} placeholder="Find a project, idea, or decision…" className="min-h-11 flex-1 min-w-0"/>
     <Button type="submit" variant="outline" className="min-h-11">Search</Button>
     {search&&<Button type="button" variant="ghost" className="min-h-11" onClick={()=>{setDraft('');setSearch('');setPositions([before]);}}>Clear search</Button>}
    </form>
    <p className="text-xs text-muted-foreground">Searches message text without AI. Submitted form answers are shown with their original message.</p>
    <Messages key={positions.at(-1)+':'+search} owner={owner} cursor={positions.at(-1)!} search={search} onOpen={openForm} canGoNewer={positions.length>1} onOlder={n=>setPositions(p=>[...p,n])} onNewer={()=>setPositions(p=>p.slice(0,-1))}/>
   </TabsContent>
   <TabsContent value="forms" className="min-h-0 flex flex-col gap-3 mt-0"><p className="text-sm text-muted-foreground">Unfinished forms and preview requests, including those outside your recent Chat messages. Unsubmitted drafts expire after seven days of inactivity.</p><SavedForms key={JSON.stringify(formPositions.at(-1))} owner={owner} cursor={formPositions.at(-1)!} onOpen={openForm} canGoNewer={formPositions.length>1} onOlder={next=>setFormPositions(p=>[...p,next])} onNewer={()=>setFormPositions(p=>p.slice(0,-1))}/></TabsContent>
  </Tabs>}
 </>;
}
function Messages({owner,cursor,search,onOpen,canGoNewer,onOlder,onNewer}:{owner:string;cursor:number;search:string;onOpen:(id:string)=>void;canGoNewer:boolean;onOlder:(n:number)=>void;onNewer:()=>void}){
 const history=useQuery({queryKey:['chat-history',owner,cursor,search],queryFn:({signal})=>api<History>('/chat/history?before='+cursor+'&q='+encodeURIComponent(search),{signal}),staleTime:0,gcTime:0});
 return <><div className="min-h-0 overflow-y-auto overscroll-contain space-y-6 pr-1" tabIndex={0} aria-label="Earlier conversation">
  {history.isPending?<p role="status">Loading earlier messages…</p>:history.error?<div role="alert"><p>{message(history.error)}</p><Button variant="outline" onClick={()=>void history.refetch()}>Try again</Button></div>:history.data?.turns.length?history.data.turns.map(turn=><article key={turn.id} className="space-y-3 text-sm"><time className="text-xs text-muted-foreground" dateTime={turn.created_at}>{new Date(turn.created_at).toLocaleString()}</time><div className="rounded-xl bg-secondary p-4"><p className="font-semibold mb-2">You</p><div className="whitespace-pre-wrap break-words"><ChatRequest text={turn.user_text}/></div></div><div className="p-4"><p className="font-semibold mb-2">Whumpo</p><p className="whitespace-pre-wrap break-words"><ChatReply text={turn.assistant_text||'No saved reply yet.'}/></p></div>{turn.interaction!==undefined&&<ChatInteractionHistory value={turn.interaction} onOpen={onOpen}/>}</article>):<p role="status">{search?'No matching messages at this conversation position. Try different words or clear the search.':'You’ve reached the beginning of this conversation.'}</p>}
 </div><div className="flex justify-between gap-3 pt-3 border-t shrink-0"><Button variant="outline" className="min-h-11" disabled={!history.data?.nextBefore||history.isFetching} onClick={()=>onOlder(history.data!.nextBefore!)}>Older</Button><Button variant="outline" className="min-h-11" disabled={!canGoNewer||history.isFetching} onClick={onNewer}>Newer</Button></div></>;
}
function SavedForms({owner,cursor,onOpen,canGoNewer,onOlder,onNewer}:{owner:string;cursor:InteractionCursor|null;onOpen:(id:string)=>void;canGoNewer:boolean;onOlder:(cursor:InteractionCursor)=>void;onNewer:()=>void}){
 const forms=useQuery({queryKey:['chat-interaction-index',owner,cursor],queryFn:async({signal})=>{
  const value=readInteractionIndex(await api('/chat/interactions/v1/list',{method:'POST',body:JSON.stringify({version:1,projectId:null,limit:5,before:cursor}),signal}));
  if(!value)throw new APIError('Refresh Whumpo to read the current saved-form list.',409,'client_update_required');return value;
 },staleTime:0,gcTime:0});
 return <><div className="min-h-0 overflow-y-auto overscroll-contain space-y-3 pr-1" tabIndex={0} aria-label="Unfinished saved forms">
  {forms.isPending?<p role="status">Finding saved forms…</p>:forms.error?<div role="alert"><p>{message(forms.error)}</p><Button variant="outline" onClick={()=>void forms.refetch()}>Try again</Button></div>:forms.data?.items.length?forms.data.items.map(f=><article key={f.interactionId} className="rounded-xl border p-4 space-y-2"><h3 className="font-semibold text-sm break-words">{f.projectName??'Your workspace'}</h3><p className="text-sm">{f.continuation?continuationLabel(f.continuation.state,f.continuation.reason):f.hasDraft?'Draft answers saved':'Saved form'}</p><p className="text-xs text-muted-foreground">Started <time dateTime={f.createdAt}>{new Date(f.createdAt).toLocaleString()}</time></p><Button variant="outline" className="min-h-11" data-resume-id={f.interactionId} onClick={()=>onOpen(f.interactionId)}>Open saved form<span className="sr-only"> for {f.projectName??'your workspace'}</span></Button></article>):<p role="status">No unfinished forms. Completed and removed form records are in Messages.</p>}
 </div><div className="flex justify-between gap-3 pt-3 border-t shrink-0"><Button variant="outline" className="min-h-11" disabled={!forms.data?.nextBefore||forms.isFetching} onClick={()=>onOlder(forms.data!.nextBefore!)}>More forms</Button><Button variant="outline" className="min-h-11" disabled={!canGoNewer||forms.isFetching} onClick={onNewer}>Previous forms</Button></div></>;
}
