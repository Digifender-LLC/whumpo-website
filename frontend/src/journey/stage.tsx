import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {Brand} from '../components/brand';
import {arrival,calm} from './motion';
import './journey.css';

export const journeyChapters=['Account','Passkeys','Recovery kit','About you','Your first idea','Ready to begin'] as const;
const star='M12 1c1.3 6.7 4.3 9.7 11 11-6.7 1.3-9.7 4.3-11 11-1.3-6.7-4.3-9.7-11-11 6.7-1.3 9.7-4.3 11-11z';
const Spark=({className}:{className?:string})=><svg viewBox="0 0 24 24" aria-hidden="true" className={className}><path d={star}/></svg>;

/** Signup, account setup and the welcome share this one layout, so moving between them changes content, not the page. */
export function JourneyFrame({world,action,children}:{world:ReactNode;action?:ReactNode;children:ReactNode}){
 return <div className="journey auth-screen">
  <header className="journey-bar"><Brand/>{action}</header>
  <aside className="journey-world" aria-hidden="true">{world}</aside>
  <main className="journey-main">{children}</main>
 </div>;
}

/** The sky beside the form. Decorative: everything here repeats something the person typed or the step already says. beat is what the mascot reacts to. */
export function JourneyWorld({stars=0,caption,sketch,scene='mascot',beat}:{stars?:number;caption?:ReactNode;sketch?:ReactNode;scene?:'mascot'|'sketch'|'review';beat?:string}){
 const mascot=useRef<HTMLImageElement>(null),seen=useRef(beat);
 useLayoutEffect(()=>{
  if(seen.current===beat)return;
  seen.current=beat;if(calm())return;
  const nod=mascot.current?.animate({transform:['none','translateY(-5%) rotate(-5deg)','none']},{duration:arrival.duration,easing:'ease-in-out'});
  return()=>nod?.cancel();
 },[beat]);
 return <div className="journey-scene" data-scene={scene}>
  {sketch}
  <div className="journey-mascot">
   <img ref={mascot} src="/brand/whumpo-mascot-640.webp" width={640} height={533} alt="" decoding="async"/>
   {[0,1,2].map(index=><Spark key={index} className={index<stars?'journey-star journey-star-on':'journey-star'}/>)}
  </div>
  {caption&&<div className="journey-caption">{caption}</div>}
 </div>;
}

let shown=0; // Survives the remount between account setup and the welcome.
/** Progress is derived from saved state only: chapter is where the person is, done is the real share of it finished. */
export function JourneyRail({chapter,done=0}:{chapter:number;done?:number}){
 const value=(chapter+done)/journeyChapters.length,fill=useRef<HTMLDivElement>(null),spark=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const from=shown;shown=value;
  if(from===value||calm())return;
  const running=[fill.current?.animate({transform:[`scaleX(${from})`,`scaleX(${value})`]},arrival),spark.current?.animate({transform:[`translateX(${from*100}%)`,`translateX(${value*100}%)`]},arrival)];
  // Finishing a chapter is the earned moment. A pulse, not a bounce: this rail also runs on security screens.
  if(value>from&&Math.floor(value*journeyChapters.length)>Math.floor(from*journeyChapters.length))running.push(spark.current?.firstElementChild?.animate({transform:['scale(1)','scale(1.7)','scale(1)'],opacity:[1,.9,1]},{duration:400,delay:240,easing:'ease-in-out'}));
  return()=>running.forEach(animation=>animation?.cancel());
 },[value]);
 return <div className="journey-rail">
  <p className="text-caption text-ink-muted">Step {chapter+1} of {journeyChapters.length}: <span className="font-semibold text-ink">{journeyChapters[chapter]}</span></p>
  <div className="journey-rail-bar">
   <div className="journey-rail-track"><div ref={fill} className="journey-rail-fill" style={{transform:`scaleX(${value})`}}/></div>
   <div ref={spark} className="journey-rail-spark" style={{transform:`translateX(${value*100}%)`}}><Spark/></div>
  </div>
  <ol aria-label="Setup progress" className="sr-only">{journeyChapters.map((label,index)=><li key={label} aria-current={index===chapter?'step':undefined}>{label}{index<chapter?' (done)':index===chapter?' (current)':''}</li>)}</ol>
 </div>;
}

type SketchLine='brand'|'greeting'|'headline'|'tagline';
/** One line of the sketch: placeholder until there is text, and redrawn once when the first text lands. */
function Line({slot,text,bars=1}:{slot:SketchLine;text:string;bars?:number}){
 return <span key={text?'text':'bar'} data-slot={slot} dir="auto" className={text?'journey-draw':undefined}>{text||Array.from({length:bars},(_,index)=><i key={index}/>)}</span>;
}
/** The first draft's palette and proportions (src/components.ts) at miniature size: typed answers inside fixed template labels, built one line at a time. */
export function ProjectSketch({person,photo,name,idea,audience,feel,active}:{person:string;photo:string;name:string;idea:string;audience:string;feel:string;active?:SketchLine}){
 return <figure className="journey-sketch" data-feel={feel} data-active={active}>
  <div className="journey-sketch-top"><Line slot="brand" text={name.trim()}/><span className="journey-sketch-tag">Sketch from your answers</span></div>
  <div className="journey-sketch-body">
   <div className="journey-sketch-greeting"><img src={photo} alt=""/><Line slot="greeting" text={person.trim()&&`Hi, I’m ${person.trim()}.`}/></div>
   <Line slot="headline" text={idea.trim()} bars={2}/>
   <Line slot="tagline" text={audience.trim()&&`Made for ${audience.trim()}`}/>
  </div>
 </figure>;
}

/** Held while the welcome loads, so finishing account setup never drops to a blank page. */
export function JourneyPending({label,action,chapter=3}:{label:string;action:ReactNode;chapter?:number}){
 return <JourneyFrame action={action} world={<JourneyWorld/>}><JourneyRail chapter={chapter}/><div className="journey-step"><p role="status" className="text-ink-muted">{label}</p></div></JourneyFrame>;
}
