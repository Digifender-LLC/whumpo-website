// WH-085 server side: photo list, upload, status and bytes. Each runs the web files.ts path unchanged (scanning, JPEG validation and metadata
// stripping in cleanPhoto, the 1 MiB bound, quotas and recovery keys) behind the M2 workspace gate; only the wire shape and error codes are mapped.
import {FileError} from '../photo-format';
import {listPhotos,readPhoto,readPhotoUpload,uploadPhoto} from '../files';
import {StorageLimitError} from '../storage-budget';
import type {IdentityPrincipal} from '../workspace-identity/authority';
import {MobileError,ok,type MobileEnvironment} from './transport';
import {workspace} from './workspace';

type Row=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const photo=(r:Row)=>({id:r.id,name:r.name,width:r.width,height:r.height,size:r.size,status:r.status,safetyStatus:r.safetyStatus});
/** A web file failure in the mobile vocabulary. Its message is plain by construction (no SQL, keys or provider text), so it is kept. */
function mapped(error:unknown):unknown{
 if(error instanceof StorageLimitError)return new MobileError('unavailable',{message:error.message});
 if(!(error instanceof FileError))return error;
 const message=error.message,s=error.status;
 if(s===404||s===423)return new MobileError('not_found'); // held or blocked media is indistinguishable from absent
 if(s===413)return new MobileError('payload_too_large');
 if(s===415)return new MobileError('unsupported_media_type');
 if(s===400)return new MobileError('invalid_request',);
 if(s===409&&message.includes('upload ID was already used'))return new MobileError('request_conflict',{message:'This upload ID was already used for another photo.'});
 return new MobileError('unavailable',{message}); // quota, removed photo, awaiting confirmation
}
const guarded=async<T>(run:()=>Promise<T>)=>{try{return await run();}catch(error){throw mapped(error);}};

export const photoList=(env:MobileEnvironment,p:IdentityPrincipal,projectId:string)=>workspace(env,p,true,(scoped,user)=>guarded(async()=>
 ok({items:((await listPhotos(scoped.DB,user,projectId)).files as Row[]).map(photo)})));

export const photoStatus=(env:MobileEnvironment,p:IdentityPrincipal,projectId:string,uploadId:string)=>workspace(env,p,true,(scoped,user)=>guarded(async()=>{
 const {photo:row}=await readPhotoUpload(scoped.DB,user,projectId,uploadId);
 if(!row)throw new MobileError('not_found'); // nothing committed: the app may resend the same bytes
 return ok({photo:photo(row)});
}));

export const photoUpload=(request:Request,env:MobileEnvironment,p:IdentityPrincipal,projectId:string,uploadId:string)=>workspace(env,p,true,(scoped,user)=>guarded(async()=>{
 // Only the three headers the web route reads cross: a native caller can never send a Chat handoff.
 const headers=new Headers({'x-whumpo-photo-handoff':'null'}); // the explicit direct-upload context
 for(const k of ['content-type','content-length','x-photo-name']){const v=request.headers.get(k);if(v!==null)headers.set(k,v);}
 const web=new Request('https://mobile.invalid/upload',{method:'PUT',headers,body:request.body,duplex:'half'} as RequestInit);
 return ok({photo:photo(await uploadPhoto(web,scoped,user,projectId,uploadId))});
}));

/** The web response unchanged: same bytes, digest check and headers (private, no-store, nosniff, sandbox CSP). */
export const photoBytes=(env:MobileEnvironment,p:IdentityPrincipal,id:string)=>workspace(env,p,true,(scoped,user)=>guarded(()=>readPhoto(scoped,user,id)));
