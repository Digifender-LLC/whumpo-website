import {useLayoutEffect,useRef} from 'react';
import {Sparkles} from 'lucide-react';
import {takeArrival} from './journey/motion';
import type {Chat} from './lib/api';

export function FirstDraftCard({project,ai}:{project:NonNullable<Chat['firstDraft']>;ai:boolean;busy:boolean;onSend:(content:string)=>Promise<void>}){
 const heading=useRef<HTMLHeadingElement>(null);
 // Arriving from the welcome: the sketch lands here, so focus does too. Unlike the composer, this opens no phone keyboard over it.
 useLayoutEffect(()=>{if(takeArrival()&&document.activeElement===document.body)heading.current?.focus({preventScroll:true});},[]);
 return <section aria-label="Start your first draft" data-feel={project.preferred_theme} className="first-draft-card mb-7 rounded-lg border bg-surface-raised p-5 sm:p-6">
  <div className="flex items-start gap-3"><Sparkles className="size-5 shrink-0 text-link mt-1"/><div className="min-w-0"><p className="text-xs font-semibold tracking-[.16em] uppercase text-ink-muted mb-1">Your first project</p><h2 ref={heading} tabIndex={-1} className="font-bold text-lg break-words">{project.name}</h2><p className="mt-2 text-body-sm text-ink-muted whitespace-pre-wrap break-words line-clamp-3">{project.purpose}</p></div></div>
  <p className="text-body-sm mt-4 leading-relaxed">{ai?'I have your brief. Tell me what you’d like to build first, or anything you want to add before we begin.':'Your brief is saved. Tell me about your idea below and we’ll take it one step at a time.'}</p>
  <p className="text-caption text-ink-muted mt-3">Your project is private. Publishing and purchases need your approval.</p>
 </section>;
}
