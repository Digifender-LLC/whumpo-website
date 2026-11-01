type Step={element:HTMLElement;text:string}|null;
function step():Step{
 const element=Array.from(document.querySelectorAll<HTMLElement>('[data-identity-step]')).at(-1);
 return element?{element,text:element.textContent??''}:null;
}
/** Keep focus with an explicit identity action, unless the owner moves elsewhere. */
export function identityActionFocus(){
 const origin=document.activeElement instanceof HTMLElement?document.activeElement:null,before=step();
 let moved=false;
 const observe=(event:FocusEvent)=>{if(event.target!==origin&&event.target!==document.body)moved=true;};
 document.addEventListener('focusin',observe);
 return (active:()=>boolean)=>requestAnimationFrame(()=>{
  document.removeEventListener('focusin',observe);
  if(!active()||!origin||moved||![origin,document.body].includes(document.activeElement as HTMLElement))return;
  const error=document.querySelector<HTMLElement>('[data-identity-error]'),after=step();
  if(error){error.focus();return;}
  if(after&&(after.element!==before?.element||after.text!==before?.text)){const journey=!!after.element.closest('.journey');after.element.focus({preventScroll:journey});if(journey)after.element.scrollIntoView({block:'start',behavior:'instant'});return;}
  if(origin.isConnected&&!origin.matches(':disabled')&&document.activeElement===document.body)origin.focus();
 });
}
