import {useState} from 'react';
import {displayChatRequest} from '../../src/first-draft-command';
import {useQuery} from '@tanstack/react-query';
import {api,message} from './lib/api';
import {Input} from './components/ui/input';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from './components/ui/dialog';

type History={turns:{id:string;revision:number;user_text:string;assistant_text:string;created_at:string;status:string}[];nextBefore:number|null};
export function ChatHistoryDialog({before}:{before:number}){
 const [open,setOpen]=useState(false),[positions,setPositions]=useState<number[]>([]),[draft,setDraft]=useState(''),[search,setSearch]=useState('');
 const cursor=positions.at(-1)??before;
 const history=useQuery({queryKey:['chat-history',cursor,search],queryFn:()=>api<History>('/chat/history?before='+cursor+'&q='+encodeURIComponent(search)),enabled:open,staleTime:0});
 return <Dialog open={open} onOpenChange={value=>{setOpen(value);if(value){setPositions([before]);setSearch('');setDraft('');}}}>
  <DialogTrigger asChild><Button variant="ghost" size="sm">Find past messages</Button></DialogTrigger>
  <DialogContent className="max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
   <DialogHeader><DialogTitle>Past messages</DialogTitle><DialogDescription>Past messages are read-only. Return to Chat to request a new change.</DialogDescription></DialogHeader>
   <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();setSearch(draft.trim());setPositions([before]);}}>
    <Input aria-label="Search saved messages" type="search" value={draft} onChange={event=>setDraft(event.target.value)} maxLength={100} placeholder="Find a project, idea, or decision…" className="min-h-11 flex-1 min-w-0"/>
    <Button type="submit" variant="outline" className="min-h-11">Search</Button>
    {search&&<Button type="button" variant="ghost" className="min-h-11" onClick={()=>{setDraft('');setSearch('');setPositions([before]);}}>Clear search</Button>}
   </form>
   <p className="text-xs text-muted-foreground">Searches saved messages by exact text, without AI. Letter case is ignored for English letters.</p>
   <div key={cursor+':'+search} className="min-h-0 overflow-y-auto space-y-6 pr-2" tabIndex={0} aria-label="Earlier conversation">
    {history.isPending?<p role="status">Loading earlier messages…</p>:history.error?<div role="alert"><p>{message(history.error)}</p><Button variant="outline" onClick={()=>void history.refetch()}>Try again</Button></div>:history.data?.turns.length?history.data.turns.map(turn=><article key={turn.id} className="space-y-3 text-sm"><time className="text-xs text-muted-foreground" dateTime={turn.created_at}>{new Date(turn.created_at).toLocaleString()}</time><div className="rounded-xl bg-secondary p-4"><p className="font-semibold mb-2">You</p><p className="whitespace-pre-wrap break-words">{displayChatRequest(turn.user_text)}</p></div><div className="p-4"><p className="font-semibold mb-2">Whumpo</p><p className="whitespace-pre-wrap break-words">{turn.assistant_text||'No saved reply yet.'}</p></div></article>):<p role="status">{search?'No matching messages at this conversation position. Try different words or clear the search.':'You’ve reached the beginning of this conversation.'}</p>}
   </div>
   <div className="flex justify-between gap-3 pt-3 border-t">
    <Button variant="outline" disabled={!history.data?.nextBefore||history.isFetching} onClick={()=>setPositions(p=>[...p,history.data!.nextBefore!])}>Older</Button>
    <Button variant="outline" disabled={positions.length<2||history.isFetching} onClick={()=>setPositions(p=>p.slice(0,-1))}>Newer</Button>
   </div>
  </DialogContent>
 </Dialog>;
}
