import {Sparkles} from 'lucide-react';
import type {Chat} from './lib/api';

export function FirstDraftCard({project,ai}:{project:NonNullable<Chat['firstDraft']>;ai:boolean;busy:boolean;onSend:(content:string)=>Promise<void>}){
 return <section aria-label="Start your first draft" className="mb-7 rounded-lg border bg-card p-5 sm:p-6">
  <div className="flex items-start gap-3"><Sparkles className="size-5 shrink-0 text-link mt-1"/><div className="min-w-0"><p className="text-xs text-muted-foreground mb-1">YOUR FIRST PROJECT</p><h2 className="font-bold text-lg break-words">{project.name}</h2><p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap break-words line-clamp-3">{project.purpose}</p></div></div>
  <p className="text-sm mt-4 leading-relaxed">{ai?'I have your brief. Tell me what you’d like to build first, or anything you want to add before we begin.':'Your brief is saved. Tell me about your idea below and we’ll take it one step at a time.'}</p>
  <p className="text-xs text-muted-foreground mt-3">Your project is private. Publishing and purchases need your approval.</p>
 </section>;
}
