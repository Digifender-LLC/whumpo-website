import type {Profile} from './api';
import type {WelcomePrompt,WelcomeStage} from '../../../src/welcome-prompts';
export type WelcomeDraft={revision:number;stage:WelcomeStage;prompt:WelcomePrompt;project_name:string;idea:string;audience:string;preferred_theme:string};
export type Welcome={complete:boolean;state?:WelcomeDraft};

/** A lost response is checked with a read; this function never repeats a write. */
async function readAfterSave<T>(write:()=>Promise<T>,read:()=>Promise<T>,matches:(saved:T)=>boolean):Promise<T>{
 try{return await write();}catch(error){
  const status=error&&typeof error==='object'&&'status'in error?error.status:undefined;
  if(typeof status==='number'&&status!==408&&status!==409&&status<500)throw error;
  try{const saved=await read();if(matches(saved))return saved;}catch{/* Preserve the original failure and the customer's local answer. */}
  throw error;
 }
}
export function saveWelcomeProfile(previous:Pick<Profile,'accountId'|'revision'>,changes:{name:string}|{about_me:string;share_context:boolean;measurement_consent?:boolean},write:()=>Promise<Profile>,read:()=>Promise<Profile>){
 return readAfterSave(write,read,saved=>!!previous.accountId&&saved.accountId===previous.accountId&&saved.revision===previous.revision+1&&('name'in changes?saved.name===changes.name:saved.about_me===changes.about_me&&saved.share_context===Number(changes.share_context)&&(changes.measurement_consent===undefined||saved.measurement_consent===Number(changes.measurement_consent))));
}
export function saveWelcomeProgress(input:WelcomeDraft,write:()=>Promise<Welcome>,read:()=>Promise<Welcome>){
 return readAfterSave(write,read,saved=>!saved.complete&&!!saved.state&&saved.state.revision===input.revision+1&&saved.state.stage===input.stage&&saved.state.prompt===input.prompt&&(['project_name','idea','audience'] as const).every(key=>saved.state![key]===input[key].trim())&&saved.state.preferred_theme===input.preferred_theme);
}
export function finishWelcome(write:()=>Promise<Welcome>,read:()=>Promise<Welcome>){
 return readAfterSave(write,read,saved=>saved.complete===true);
}
