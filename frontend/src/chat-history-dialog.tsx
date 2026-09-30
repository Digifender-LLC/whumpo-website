import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,message} from './lib/api';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger} from './components/ui/dialog';

type History={turns:{id:string;revision:number;user_text:string;assistant_text:string;created_at:string;status:string}[];nextBefore:number|null};
export function ChatHistoryDialog({before}:{before:number}){
 const [open,setOpen]=useState(false),[positions,setPositions]=useState<number[]>([]);
 const cursor=positions.at(-1)??before;
 const history=useQuery({queryKey:['chat-history',cursor],queryFn:()=>api<History>('/chat/history?before='+cursor),enabled:open,staleTime:0});
 return <Dialog open={open} onOpenChange={value=>{setOpen(value);if(value)setPositions([before]);}}>
  <DialogTrigger asChild><Button variant="ghost" size="sm">Earlier messages</Button></DialogTrigger>
  <DialogContent className="max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
   <DialogHeader><DialogTitle>Earlier messages</DialogTitle><DialogDescription>Past messages are read-only. Return to Chat to request a new change.</DialogDescription></DialogHeader>
   <div key={cursor} className="min-h-0 overflow-y-auto space-y-6 pr-2" tabIndex={0} aria-label="Earlier conversation">
    {history.isPending?<p role="status">Loading earlier messages…</p>:history.error?<div role="alert"><p>{message(history.error)}</p><Button variant="outline" onClick={()=>void history.refetch()}>Try again</Button></div>:history.data?.turns.length?history.data.turns.map(turn=><article key={turn.id} className="space-y-3 text-sm"><time className="text-xs text-muted-foreground" dateTime={turn.created_at}>{new Date(turn.created_at).toLocaleString()}</time><div className="rounded-xl bg-secondary p-4"><p className="font-semibold mb-2">You</p><p className="whitespace-pre-wrap break-words">{turn.user_text}</p></div><div className="p-4"><p className="font-semibold mb-2">Whumpo</p><p className="whitespace-pre-wrap break-words">{turn.assistant_text||'No saved reply yet.'}</p></div></article>):<p>You’ve reached the beginning of this conversation.</p>}
   </div>
   <div className="flex justify-between gap-3 pt-3 border-t">
    <Button variant="outline" disabled={!history.data?.nextBefore||history.isFetching} onClick={()=>setPositions(p=>[...p,history.data!.nextBefore!])}>Older</Button>
    <Button variant="outline" disabled={positions.length<2||history.isFetching} onClick={()=>setPositions(p=>p.slice(0,-1))}>Newer</Button>
   </div>
  </DialogContent>
 </Dialog>;
}
