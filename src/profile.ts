import {onboardingComplete} from './onboarding';
import {BillingError} from './billing';
import {cleanPhoto} from './files';
export async function readProfile(db:D1Database,user:string){
 const account=await db.prepare("SELECT email,password_hash!='passkey-only' AS passwordEnabled FROM users WHERE id=?").bind(user).first<{email:string;passwordEnabled:number}>();
 if(!account)throw new BillingError(404,'Account not found');
 const row=await db.prepare('SELECT revision,name,about_me,share_context,theme,avatar_id,photo IS NOT NULL AS hasPhoto FROM user_profiles WHERE user_id=?').bind(user).first<{revision:number;name:string;about_me:string;share_context:number;theme:string;avatar_id:string;hasPhoto:number}>();
 return {...(row??{revision:0,name:'',about_me:'',share_context:0,theme:'system',avatar_id:'cloud',hasPhoto:0}),onboardingComplete:await onboardingComplete(db,user),email:account.email,passwordEnabled:!!account.passwordEnabled};
}
async function ensure(db:D1Database,user:string){await db.prepare('INSERT OR IGNORE INTO user_profiles(user_id) VALUES(?)').bind(user).run();}
export async function updateProfile(db:D1Database,user:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new BillingError(400,'Invalid profile');
 const v=input as Record<string,unknown>,keys=Object.keys(v).filter(k=>k!=='revision');
 if(!Number.isSafeInteger(v.revision)||Number(v.revision)<0||!keys.length||keys.some(k=>!['name','about_me','share_context','theme','avatar_id'].includes(k)))throw new BillingError(400,'Invalid profile fields');
 for(const k of ['name','about_me'])if(k in v&&(typeof v[k]!=='string'||(v[k] as string).length>(k==='name'?80:1200)||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v[k] as string)))throw new BillingError(400,'Profile text is too long or contains unsupported characters');
 if('share_context'in v&&typeof v.share_context!=='boolean'||'theme'in v&&(typeof v.theme!=='string'||!['system','light','dark'].includes(v.theme)))throw new BillingError(400,'Invalid preference');
 if('avatar_id' in v&&(typeof v.avatar_id!=='string'||!['cloud','sun','moon','leaf','star','planet'].includes(v.avatar_id)))throw new BillingError(400,'Choose an available profile picture');
 await ensure(db,user);
 const args=keys.map(k=>k==='share_context'?(v[k]?1:0):v[k]);
 const r=await db.prepare(`UPDATE user_profiles SET ${keys.map(k=>k+'=?').join(',')}${'avatar_id'in v?',photo=NULL':''},revision=revision+1 WHERE user_id=? AND revision=?`).bind(...args,user,v.revision).run();
 if(r.meta.changes!==1)throw new BillingError(409,'Your profile changed elsewhere. Reload before saving.');
 return readProfile(db,user);
}
export async function updateProfilePhoto(db:D1Database,user:string,request:Request){
 const raw=request.headers.get('if-match');if(!raw||!/^\d{1,9}$/.test(raw))throw new BillingError(400,'Profile revision required');
 let photo:string|null=null;
 if(request.method!=='DELETE'){
  if(request.headers.get('content-type')!=='image/jpeg')throw new BillingError(415,'Use the profile photo picker');
  const reader=request.body?.getReader();if(!reader)throw new BillingError(400,'Choose a photo');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw new BillingError(413,'Prepared photo must be smaller than 32 KiB');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const clean=cleanPhoto(bytes);if(clean.width>256||clean.height>256)throw new BillingError(400,'Prepare a photo up to 256 pixels');
  photo=btoa(String.fromCharCode(...clean.bytes));
 }
 await ensure(db,user);
 const r=await db.prepare('UPDATE user_profiles SET photo=?,revision=revision+1 WHERE user_id=? AND revision=?').bind(photo,user,Number(raw)).run();
 if(r.meta.changes!==1)throw new BillingError(409,'Your profile changed elsewhere. Reload before saving.');
 return readProfile(db,user);
}
export async function profilePhoto(db:D1Database,user:string){
 const row=await db.prepare('SELECT photo FROM user_profiles WHERE user_id=?').bind(user).first<{photo:string|null}>();
 if(!row?.photo)throw new BillingError(404,'No profile photo');
 return new Response(Uint8Array.from(atob(row.photo),c=>c.charCodeAt(0)),{headers:{'content-type':'image/jpeg','cache-control':'private, no-store','content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'}});
}
/** Only explicitly shared text enters AI context. Photo, email and auth data stay out. */
export async function agentProfile(db:D1Database,user:string){
 return await db.prepare('SELECT name,about_me FROM user_profiles WHERE user_id=? AND share_context=1').bind(user).first<{name:string;about_me:string}>();
}
