import {clearChatRecovery} from './lib/chat-recovery';
import {saveWelcomeProfile,saveWelcomeProgress,finishWelcome,type WelcomeDraft as Draft,type Welcome} from './lib/welcome-delivery';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {ArrowLeft,ArrowRight,Check,Sparkles} from 'lucide-react';
import {api,send,message,queryClient,type Profile} from './lib/api';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';
import {Label} from './components/ui/label';
import {ProfilePicturePicker,profilePicture,avatarChoices} from './profile-picture-picker';
import {welcomePrompts,welcomeStage,firstWelcomePrompt,type WelcomePrompt} from '../../src/welcome-prompts';
const themes=[['ocean','Fresh & bright','#60B5FF'],['clay','Warm & cozy','#e7ab89'],['forest','Calm & natural','#78b9a1']] as const;
export function Onboarding({profile}:{profile:Profile}){
 const state=useQuery({queryKey:['onboarding'],queryFn:()=>api<Welcome>('/onboarding')});
 if(state.isPending)return <main className="min-h-dvh grid place-items-center"><p role="status">Getting your welcome ready…</p></main>;
 if(state.error)return <main className="page-pad space-y-4"><h1 className="text-2xl font-bold">Let’s pick up where you left off.</h1><p role="alert">{message(state.error)}</p><Button onClick={()=>void state.refetch()}>Try again</Button></main>;
 if(state.data?.complete)return <main className="min-h-dvh grid place-items-center"><Button onClick={()=>void queryClient.invalidateQueries({queryKey:['session']})}>Open your workspace</Button></main>;
 return <WelcomeConversation profile={profile} initial={state.data!.state!}/>;
}
function WelcomeConversation({profile,initial}:{profile:Profile;initial:Draft}){
 const [draft,setDraft]=useState(initial),[name,setName]=useState(profile.name),[bio,setBio]=useState(profile.about_me),[share,setShare]=useState(!!profile.share_context),[busy,setBusy]=useState(false),[photoBusy,setPhotoBusy]=useState(false),[error,setError]=useState(''),[returnToReview,setReturnToReview]=useState(false);
 const navigate=useNavigate(),heading=useRef<HTMLHeadingElement>(null),mounted=useRef(false),lock=useRef(false),errorPanel=useRef<HTMLDivElement>(null);
 const prompt=draft.prompt??firstWelcomePrompt(draft.stage),index=welcomePrompts.indexOf(prompt),chapter=['profile','project','review'].indexOf(welcomeStage(prompt)),waiting=busy||photoBusy;
 useEffect(()=>{if(mounted.current){heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'center',behavior:'instant'});}mounted.current=true;},[prompt]);
 useEffect(()=>{if(error){const panel=errorPanel.current;if(panel&&(document.activeElement===document.body||panel.closest('form')?.contains(document.activeElement)))panel.focus();}},[error]);
 async function persist(nextPrompt:WelcomePrompt){
  const input={revision:draft.revision,stage:welcomeStage(nextPrompt),prompt:nextPrompt,project_name:draft.project_name,idea:draft.idea,audience:draft.audience,preferred_theme:draft.preferred_theme};
  const next=await saveWelcomeProgress(input,()=>send<Welcome>('/onboarding',input,'PUT'),()=>api<Welcome>('/onboarding'));
  if(next.complete){await queryClient.invalidateQueries({queryKey:['session']});return;}
  if(next.state)setDraft(next.state);
 }
 async function action(work:()=>Promise<void>){if(lock.current||photoBusy)return;lock.current=true;setBusy(true);setError('');try{await work();}catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}}
 async function proceed(){await action(async()=>{
  if(prompt==='name'){
   if(!name.trim())throw Error('What should we call you?');
   const changes={name:name.trim()};queryClient.setQueryData(['session'],await saveWelcomeProfile(profile,changes,()=>send<Profile>('/profile',{revision:profile.revision,...changes},'PATCH'),()=>api<Profile>('/profile')));
  }
  if(prompt==='bio'){const changes={about_me:bio.trim(),share_context:share};queryClient.setQueryData(['session'],await saveWelcomeProfile(profile,changes,()=>send<Profile>('/profile',{revision:profile.revision,...changes},'PATCH'),()=>api<Profile>('/profile')));}
  if(prompt==='idea'&&!draft.idea.trim())throw Error('Tell me a little about what you’d like to make.');
  if(prompt==='project-name'&&!draft.project_name.trim())throw Error('Give your project a working name. You can change it later.');
  if(prompt==='review'){
   await finishWelcome(()=>send<Welcome>('/onboarding/complete',{revision:draft.revision}),()=>api<Welcome>('/onboarding'));
   await navigate({to:'/workspace',search:{signup:false}});
   queryClient.setQueryData(['session'],await api<Profile>('/profile'));
   void queryClient.invalidateQueries({queryKey:['chat']});void queryClient.invalidateQueries({queryKey:['dashboard']});
  }else {await persist(returnToReview?'review':welcomePrompts[index+1]);setReturnToReview(false);}
 });}
 const go=(next:WelcomePrompt,fromReview=false)=>void action(async()=>{await persist(next);setReturnToReview(fromReview);});
 const questions:Record<WelcomePrompt,string>={name:'Hi, I’m Whumpo. What should I call you?',picture:`Nice to meet you, ${name.trim()||'friend'}. Pick a face for your space.`,bio:'Anything you’d like me to know about you?',idea:'What would you like us to make first?','project-name':'What shall we call your project?',audience:'Who are you making this for?',style:'What should it feel like?',review:'Shall we start your first project?'};
 const hints:Record<WelcomePrompt,string>={name:'Let’s get to know each other, then give your first idea a home.',picture:'Choose a little companion or use your own photo. You can change it whenever you like.',bio:'Your work, interests, or the kind of help you’re looking for. This one is optional.',idea:'A website, a small app, a home for your work—describe it in your own words.', 'project-name':'A working name is perfect. This doesn’t register a business or buy a domain.',audience:'Customers, your community, or just you. It’s okay if you’re still figuring this out.',style:'Pick a starting direction. We can explore colors and details together later.',review:'I’ll save a private project with this brief. Then we can build together in Chat.'};
 const answerRows=[
  {prompt:'name' as const,label:'Your name',value:profile.name},
  {prompt:'picture' as const,label:'Your picture',value:profile.hasPhoto?'Your uploaded photo':avatarChoices.find(([id])=>id===profile.avatar_id)?.[1]??'Cloud'},
  {prompt:'bio' as const,label:'About you',value:profile.about_me||'I’ll add this later'},
  {prompt:'idea' as const,label:'Your idea',value:draft.idea},
  {prompt:'project-name' as const,label:'Project name',value:draft.project_name},
  {prompt:'audience' as const,label:'Made for',value:draft.audience||'Still exploring'},
  {prompt:'style' as const,label:'Starting feel',value:themes.find(([id])=>id===draft.preferred_theme)?.[1]??'Fresh & bright'}
 ];
 const answered=answerRows.filter(row=>welcomePrompts.indexOf(row.prompt)<index);
 const optional=prompt==='bio'||prompt==='audience'||prompt==='style';
 const nextLabel=prompt==='review'?'Start my project':returnToReview?'Save and review':prompt==='picture'?'Use this picture':prompt==='bio'&&!bio.trim()||prompt==='audience'&&!draft.audience.trim()?'Skip for now':prompt==='style'?'Use this starting feel':'Continue';
 return <main className="min-h-dvh bg-background px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-xl">
  <div className="flex items-center justify-between gap-4"><Brand/><Button variant="ghost" className="min-h-11" disabled={waiting} onClick={()=>void action(async()=>{await send('/auth/logout');clearChatRecovery();queryClient.clear();location.assign('/workspace');})}>Sign out</Button></div>
  <ol aria-label="Welcome progress" className="mt-8 mb-6 flex gap-3">{['About you','Your first idea','Ready to begin'].map((label,i)=><li key={label} aria-current={chapter===i?'step':undefined} className="flex-1"><div className={'h-1.5 rounded-full mb-2 '+(i<=chapter?'bg-primary':'bg-muted')}/><span className={'text-xs '+(i===chapter?'font-semibold':'text-muted-foreground')}>{label}</span></li>)}</ol>
  <p className="text-xs text-muted-foreground mb-6">Guided welcome · no AI usage · answers save when you continue</p>
  {answered.length>0&&prompt!=='review'&&<details key={'answers-'+prompt} className="mb-6 rounded-2xl border bg-card px-4"><summary className="cursor-pointer py-3 text-sm font-medium min-h-11">Your answers so far <span className="text-muted-foreground">({answered.length})</span></summary><dl className="pb-3 space-y-3">{answered.map(row=><div key={row.prompt} className="flex items-start justify-between gap-3"><div className="min-w-0"><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="text-sm whitespace-pre-wrap break-words line-clamp-3">{row.value}</dd></div><Button type="button" variant="ghost" className="min-h-11 shrink-0" disabled={waiting} onClick={()=>go(row.prompt)} aria-label={'Edit '+row.label.toLowerCase()}>Edit</Button></div>)}</dl></details>}
  <div className="flex items-start gap-3 mb-6"><img src="/brand/avatars/cloud.svg" alt="" className="size-11 rounded-full shrink-0"/><div className="min-w-0 rounded-2xl rounded-tl-sm bg-secondary/60 p-4 sm:p-5"><p className="text-xs font-semibold text-primary mb-2">WHUMPO</p><h1 ref={heading} tabIndex={-1} className="text-xl sm:text-2xl font-bold tracking-tight break-words focus-visible:outline-2 focus-visible:outline-ring">{questions[prompt]}</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{hints[prompt]}</p></div></div>
  <form className="space-y-5 pb-8" onSubmit={e=>{e.preventDefault();void proceed()}} aria-label="Your welcome answer">
   <div className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4">
    {prompt==='name'&&<div className="space-y-2"><Label htmlFor="welcome-name">Your name</Label><Input id="welcome-name" value={name} onChange={e=>setName(e.target.value)} autoComplete="name" maxLength={80} required disabled={waiting} className="min-h-12" placeholder="What your friends call you"/></div>}
    {prompt==='picture'&&<ProfilePicturePicker profile={profile} disabled={busy} onBusy={setPhotoBusy}/>}
    {prompt==='bio'&&<><Label htmlFor="welcome-bio">A little about you <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="welcome-bio" value={bio} onChange={e=>setBio(e.target.value)} maxLength={1200} rows={4} disabled={waiting} placeholder="I’m a baker turning a weekend hobby into a small business…"/><label className="flex items-start gap-3 text-sm py-2"><input type="checkbox" checked={share} onChange={e=>setShare(e.target.checked)} disabled={waiting} className="mt-1 size-5 shrink-0"/><span>Use my name and bio to personalize the agent’s help.<span className="block text-xs text-muted-foreground mt-2 leading-relaxed">Optional. Shared text goes to the AI provider; the current test provider may use it for training. Your email and photo are never included.</span></span></label></>}
    {prompt==='idea'&&<><Label htmlFor="welcome-idea">Your first idea</Label><Textarea id="welcome-idea" value={draft.idea} onChange={e=>setDraft({...draft,idea:e.target.value})} maxLength={1000} rows={5} required disabled={waiting} placeholder="I’d love a website for my bakery where people can see the menu and get in touch…"/><div className="flex flex-wrap gap-2">{['A home for my portfolio','A website for my business','A useful little app'].map(idea=><Button key={idea} type="button" variant="outline" className="min-h-11 h-auto whitespace-normal text-left justify-start" disabled={waiting} onClick={()=>setDraft({...draft,idea})}>{idea}</Button>)}</div></>}
    {prompt==='project-name'&&<div className="space-y-2"><Label htmlFor="welcome-project">Working name</Label><Input id="welcome-project" value={draft.project_name} onChange={e=>setDraft({...draft,project_name:e.target.value})} maxLength={100} required disabled={waiting} className="min-h-12" placeholder="For example, Copper Oven"/></div>}
    {prompt==='audience'&&<div className="space-y-2"><Label htmlFor="welcome-audience">Who it’s for <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="welcome-audience" value={draft.audience} onChange={e=>setDraft({...draft,audience:e.target.value})} maxLength={1000} rows={3} disabled={waiting} placeholder="Neighbors looking for fresh bread and a friendly local bakery"/></div>}
    {prompt==='style'&&<fieldset disabled={waiting}><legend className="text-sm font-medium mb-3">A starting feel <span className="font-normal text-muted-foreground">(optional)</span></legend><div className="space-y-2">{themes.map(([value,label,color])=><label key={value} className={'flex min-h-14 items-center gap-3 rounded-xl border-2 p-3 cursor-pointer '+(draft.preferred_theme===value?'border-primary':'border-border')}><input type="radio" name="welcome-theme" value={value} checked={draft.preferred_theme===value} onChange={()=>setDraft({...draft,preferred_theme:value})} className="size-4"/><span style={{backgroundColor:color}} className="block size-8 rounded-lg shrink-0"/><span className="text-sm">{label}</span></label>)}</div></fieldset>}
    {prompt==='review'&&<><div className="flex items-center gap-3"><img src={profilePicture(profile)} alt="Your profile picture" className="size-12 rounded-full object-cover"/><div className="min-w-0"><p className="font-semibold break-words">{profile.name}</p><p className="text-xs text-muted-foreground">{profile.share_context?'Name and bio shared with your agent':'Name and bio kept out of AI context'}</p></div></div><dl className="space-y-3 border-t pt-3">{answerRows.filter(row=>row.prompt!=='picture'&&row.prompt!=='name').map(row=><div key={row.prompt} className="flex items-start justify-between gap-3"><div className="min-w-0"><dt className="text-xs text-muted-foreground">{row.label}</dt><dd className="mt-1 text-sm whitespace-pre-wrap break-words">{row.value}</dd></div><Button type="button" variant="ghost" className="min-h-11 shrink-0" disabled={waiting} onClick={()=>go(row.prompt,true)} aria-label={'Edit '+row.label.toLowerCase()}>Edit</Button></div>)}</dl><div className="flex flex-wrap gap-x-5"><Button type="button" variant="link" className="min-h-11 p-0" disabled={waiting} onClick={()=>go('name',true)}>Edit name</Button><Button type="button" variant="link" className="min-h-11 p-0" disabled={waiting} onClick={()=>go('picture',true)}>Edit picture</Button></div></>}
   </div>
   {prompt==='review'&&<div className="flex gap-3 text-sm text-muted-foreground"><Check className="size-5 shrink-0 text-primary"/><p>Your project starts private. No domain, paid service, or publication is created. You can change these details later.</p></div>}
   {error&&<div ref={errorPanel} tabIndex={-1} role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm space-y-2"><p>{error}</p><p>Your answer is still here. Reloading replaces it with your saved details.</p><Button type="button" variant="link" className="p-0 min-h-11 h-auto whitespace-normal text-left" disabled={waiting} onClick={()=>location.reload()}>Discard unsaved changes and reload</Button></div>}
   <div className="flex gap-3">{index>0&&<Button type="button" variant="outline" className="min-h-12 min-w-12 rounded-xl" disabled={waiting} onClick={()=>go(welcomePrompts[index-1])} aria-label="Previous welcome question"><ArrowLeft className="size-4"/></Button>}<Button className="flex-1 min-h-12 rounded-xl" disabled={waiting} type="submit">{busy?'Saving…':nextLabel}{prompt==='review'?<Sparkles className="size-4"/>:<ArrowRight className="size-4"/>}</Button></div>
   {optional&&<p className="text-xs text-center text-muted-foreground">You can change this in your {prompt==='bio'?'profile':'project details'} later.{prompt==='style'&&<> <Button type="button" variant="link" className="text-xs min-h-11" disabled={waiting} onClick={()=>go('review')}>Skip for now</Button></>}</p>}
  </form>
 </div></main>;
}
