import {BillingError} from './billing';
import {welcomePrompts,welcomeStage,firstWelcomePrompt,type WelcomePrompt,type WelcomeStage} from './welcome-prompts';
type Welcome={revision:number;stage:WelcomeStage;prompt:WelcomePrompt|null;project_id:string;project_name:string;idea:string;audience:string;preferred_theme:string;completed_at:string|null};
export async function onboardingComplete(db:D1Database,user:string){return !!await db.prepare('SELECT user_id FROM welcome_onboarding WHERE user_id=? AND completed_at IS NOT NULL UNION ALL SELECT owner_user_id FROM projects WHERE owner_user_id=? LIMIT 1').bind(user,user).first();}
export async function readOnboarding(db:D1Database,user:string){
 if(await onboardingComplete(db,user))return {complete:true};
 await db.prepare('INSERT OR IGNORE INTO welcome_onboarding(user_id,project_id) VALUES(?,?)').bind(user,crypto.randomUUID()).run();
 const state=await db.prepare('SELECT revision,stage,prompt,project_id,project_name,idea,audience,preferred_theme,completed_at FROM welcome_onboarding WHERE user_id=?').bind(user).first<Welcome>();
 return {complete:!!state?.completed_at,state:state?{...state,prompt:state.prompt&&welcomeStage(state.prompt)===state.stage?state.prompt:firstWelcomePrompt(state.stage)}:state};
}
export async function saveOnboarding(db:D1Database,user:string,input:Record<string,unknown>){
 const allowed=['revision','stage','prompt','project_name','idea','audience','preferred_theme'];
 if(Object.keys(input).some(k=>!allowed.includes(k))||!Number.isSafeInteger(input.revision)||Number(input.revision)<0||!['profile','project','review'].includes(String(input.stage))||!['ocean','clay','forest'].includes(String(input.preferred_theme)))throw new BillingError(400,'Choose valid welcome preferences');
 const prompt=input.prompt===undefined?firstWelcomePrompt(input.stage as WelcomeStage):input.prompt;
 if(!welcomePrompts.includes(prompt as WelcomePrompt)||welcomeStage(prompt as WelcomePrompt)!==input.stage)throw new BillingError(400,'Choose a valid welcome question');
 for(const [key,limit] of [['project_name',100],['idea',1000],['audience',1000]] as const)if(typeof input[key]!=='string'||input[key].length>limit||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input[key]))throw new BillingError(400,'Your project details are too long or contain unsupported characters');
 if(input.stage==='review'&&(!(input.project_name as string).trim()||!(input.idea as string).trim()))throw new BillingError(400,'Give your project a name and tell us what you want to build');
 await readOnboarding(db,user);
 const r=await db.prepare('UPDATE welcome_onboarding SET revision=revision+1,stage=?,prompt=?,project_name=?,idea=?,audience=?,preferred_theme=? WHERE user_id=? AND revision=? AND completed_at IS NULL').bind(input.stage,prompt,(input.project_name as string).trim(),(input.idea as string).trim(),(input.audience as string).trim(),input.preferred_theme,user,input.revision).run();
 if(r.meta.changes!==1)throw new BillingError(409,'Welcome details changed elsewhere. Reload the saved details before continuing');return readOnboarding(db,user);
}
export async function completeOnboarding(db:D1Database,user:string,input:Record<string,unknown>){
 if(Object.keys(input).some(k=>k!=='revision')||!Number.isSafeInteger(input.revision)||Number(input.revision)<0)throw new BillingError(400,'Choose the saved welcome revision');
 if(await onboardingComplete(db,user))return {complete:true};
 try{const r=await db.prepare("UPDATE welcome_onboarding SET revision=revision+1,stage='complete',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND revision=? AND stage='review' AND completed_at IS NULL").bind(user,input.revision).run();if(r.meta.changes!==1)throw Error('stale');}
 catch{if(await onboardingComplete(db,user))return {complete:true};throw new BillingError(409,'Your welcome is not ready yet. Check your name and saved project details, then try again');}
 return {complete:true};
}
