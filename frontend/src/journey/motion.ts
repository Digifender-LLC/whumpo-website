import {useLayoutEffect,useRef} from 'react';
import {flushSync} from 'react-dom';

/** forward and back are travel. update changes part of a step in place, morph leaves the step alone, arrive hands off to Chat. */
export type JourneyMove='forward'|'back'|'update'|'morph'|'arrive';
// Mirrors --duration-slow and --ease-enter. Web Animations cannot read custom properties in keyframe options.
export const arrival={duration:400,easing:'cubic-bezier(0,0,0,1)'};
export const calm=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

let latest:ViewTransition|null=null,welcoming=false,arriving=false;
// Browsers morph a shared element by animating its size, which runs on the main thread. These two change size, so they scale instead.
const resizing=[['journey-mascot','.journey-mascot'],['journey-project','.journey-sketch,.first-draft-card']] as const;
const resizingRects=()=>resizing.map(([,selector])=>document.querySelector(selector)?.getBoundingClientRect());
/** Identity finished and the welcome is loading: keep the journey frame instead of the workspace spinner. */
export const noteWelcoming=()=>{welcoming=true;};
export const isWelcoming=()=>welcoming;
/** Set just before Chat replaces the welcome; the first draft card takes focus once. */
export const noteArrival=()=>{arriving=true;welcoming=false;};
export const takeArrival=()=>{const was=arriving;arriving=false;return was;};

/**
 * Commits one journey change. The commit is the data; the transition only decorates it, so a skipped,
 * interrupted or unsupported transition still leaves the right screen. Resolves once the new step is in the DOM.
 * Reduced motion skips the transition and commits directly.
 */
export async function journeyMove(commit:()=>void,move:JourneyMove='forward'){
 const root=document.documentElement;
 if(typeof document.startViewTransition!=='function'||calm()){commit();return;}
 root.dataset.journeyMove=move;
 const before=resizingRects();
 // The extra task lets TanStack Query's timer-scheduled observers commit before the new state is captured.
 const transition=document.startViewTransition(async()=>{flushSync(commit);await new Promise(done=>setTimeout(done));});
 latest=transition;
 // A newer move or a hidden tab skips this one. That is normal, and the commit above still runs.
 transition.ready.then(()=>resizingRects().forEach((last,index)=>{
  const first=before[index];
  if(first&&last?.width&&last.height&&(first.x!==last.x||first.y!==last.y||first.width!==last.width||first.height!==last.height))root.animate({transform:[`translate(${first.x}px,${first.y}px) scale(${first.width/last.width},${first.height/last.height})`,`translate(${last.x}px,${last.y}px)`]},{duration:arrival.duration,easing:'cubic-bezier(.2,0,0,1)',pseudoElement:`::view-transition-group(${resizing[index][0]})`});
 })).catch(()=>{});
 void transition.finished.catch(()=>{}).finally(()=>{if(latest===transition)delete root.dataset.journeyMove;});
 await transition.updateCallbackDone;
}

/**
 * Entrance for a step's children. Plain Web Animations on the live DOM, so it runs without View Transitions,
 * never holds input, and leaves no styles behind: cancelling restores the finished layout.
 * Pass null where nothing should animate. An update enters only what is marked data-journey-enter.
 */
export function useStepEntrance(step:string|null){
 const ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const move=document.documentElement.dataset.journeyMove,children=[...(move==='update'?ref.current?.querySelectorAll('[data-journey-enter]'):ref.current?.children)??[]].slice(0,5);
  if(step===null||move==='morph')return;
  const offset=move==='back'?-14:20,running=children.map((child,index)=>calm()
   ?child.animate({opacity:[0,1]},{duration:150})
   :child.animate([{opacity:0,transform:`translateY(${offset}px)`},{opacity:1,transform:'none'}],{...arrival,delay:110+index*40,fill:'backwards'}));
  return()=>running.forEach(animation=>animation.cancel());
 },[step]);
 return ref;
}
