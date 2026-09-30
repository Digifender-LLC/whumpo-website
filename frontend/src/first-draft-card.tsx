import {ArrowRight,Sparkles} from 'lucide-react';
import {Button} from './components/ui/button';
import type {Chat} from './lib/api';

export function FirstDraftCard({project,ai,busy,onSend}:{project:NonNullable<Chat['firstDraft']>;ai:boolean;busy:boolean;onSend:(content:string)=>Promise<void>}){
 return <section aria-label="Start your first draft" className="mb-7 rounded-2xl border bg-card p-5 sm:p-6">
  <div className="flex items-start gap-3"><Sparkles className="size-5 shrink-0 text-primary mt-1"/><div className="min-w-0"><p className="text-xs text-muted-foreground mb-1">YOUR FIRST PROJECT</p><h2 className="font-bold text-lg break-words">{project.name}</h2><p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap break-words line-clamp-3">{project.purpose}</p></div></div>
  <p className="text-sm mt-4 leading-relaxed">{ai?'I have your brief. Choose a website draft to preview, or an app to build and test privately before you approve it.':'Your brief is saved. Start with a simple website preview, then build on it together.'}</p>
  <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mt-4"><Button className="min-h-12 h-auto whitespace-normal rounded-xl" disabled={busy} onClick={()=>void onSend(ai?'/first-draft '+project.id:'/build '+project.preferred_theme+' '+project.id)}>{ai?'Draft a website':'Make a starter preview'}<ArrowRight className="size-4"/></Button>{ai&&<Button variant="outline" className="min-h-12 h-auto whitespace-normal rounded-xl" disabled={busy} onClick={()=>void onSend('/first-app '+project.id)}>Build an app<ArrowRight className="size-4"/></Button>}<Button variant="ghost" className="min-h-12 rounded-xl" disabled={busy} onClick={()=>void onSend('/brief '+project.id)}>Read my saved brief</Button></div>
  <p className="text-xs text-muted-foreground mt-3">{ai?'Uses your AI allowance.':'No AI usage.'} Nothing is published or purchased. You can also tell me more below.</p>
 </section>;
}
