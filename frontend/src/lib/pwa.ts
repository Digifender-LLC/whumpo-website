type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>};
let pending:InstallEvent|null=null,started=false;
let state={available:false,installed:false};
const listeners=new Set<()=>void>();
function update(next:typeof state){state=next;listeners.forEach(listener=>listener());}
export const subscribeInstall=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const installSnapshot=()=>state;
export async function promptInstall(){
 const event=pending;if(!event)return 'unavailable';
 pending=null;update({...state,available:false});
 try{await event.prompt();return (await event.userChoice).outcome;}catch{return 'unavailable';}
}
export function initializePwa(){
 if(started)return;started=true;
 const display=matchMedia('(display-mode: standalone)');
 const installed=()=>display.matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
 const refresh=()=>update({available:!installed()&&pending!==null,installed:installed()});
 refresh();display.addEventListener('change',refresh);
 const theme=()=>document.querySelector('meta[name="theme-color"]')?.setAttribute('content',document.documentElement.classList.contains('dark')?'#0b172a':'#F8FAFC');
 theme();new MutationObserver(theme).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pending=event as InstallEvent;refresh();});
 window.addEventListener('appinstalled',()=>{pending=null;update({available:false,installed:true});});
 if(import.meta.env.PROD&&isSecureContext&&'serviceWorker' in navigator){
  // Registration is independent of account identity and sends no customer data.
  const register=()=>{void navigator.serviceWorker.register('/workspace-sw.js',{scope:'/workspace',updateViaCache:'none'}).catch(()=>{/* Browser installation remains available without offline support. */});};
  if(document.readyState==='complete')register();else window.addEventListener('load',register,{once:true});
 }
}
