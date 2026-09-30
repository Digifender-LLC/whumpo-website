import {analyzeWordPress} from './cms-wordpress-analysis';
import {cmsConnection} from './cms-status';
import {CMSProjectError} from './cms-error';
import {captureCMSWordPressSource,readCMSWordPressSource,uploadCMSWordPressSource} from './cms-wordpress-sources';
export async function analyzeCMSWordPress(bytes:Uint8Array){try{return await analyzeWordPress(bytes);}catch{throw new CMSProjectError(400,'This file could not be analyzed. Use a standard UTF-8 WordPress export up to 1 MiB and 100 items, with unique item IDs and no entity declarations.');}}
export async function inspectCMSWordPress(db:D1Database,files:R2Bucket,user:string,project:string,id:string){
 const row=await readCMSWordPressSource(db,user,id);if(row.project_id!==project)throw new CMSProjectError(404,'Source file is not in this publishing space');
 const {source,bytes}=await captureCMSWordPressSource(db,files,user,id);return {source,report:{...await analyzeCMSWordPress(bytes),sourceRetained:true}};
}
/** Ownership precedes consuming the timed, bounded body; valid analysis precedes storage admission. */
export async function uploadCMSWordPressRequest(request:Request,db:D1Database,files:R2Bucket,user:string,project:string,id:string,env:Record<string,unknown>){
 await cmsConnection(db,user,project,env);
 if(request.headers.has('content-encoding')||request.headers.get('content-type')!=='application/xml')throw new CMSProjectError(415,'Use an uncompressed WordPress XML export');
 if(Number(request.headers.get('content-length'))>1048576)throw new CMSProjectError(413,'WordPress exports must be at most 1 MiB');
 let name:string;try{name=decodeURIComponent(request.headers.get('x-source-name')??'');}catch{throw new CMSProjectError(400,'Invalid export filename');}
 const reader=request.body?.getReader();if(!reader)throw new CMSProjectError(400,'Choose a WordPress export');
 let timer:ReturnType<typeof setTimeout>|undefined,size=0,complete=false;const chunks:Uint8Array[]=[];
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new CMSProjectError(408,'Source upload timed out. Retry the same file and request.'));void reader.cancel().catch(()=>{});},15000);});
 try{while(true){const part=await Promise.race([reader.read(),timeout]);if(part.done)break;size+=part.value.length;if(size>1048576)throw new CMSProjectError(413,'WordPress exports must be at most 1 MiB');chunks.push(part.value);}complete=true;}
 finally{if(timer!==undefined)clearTimeout(timer);if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 await analyzeCMSWordPress(bytes);
 return uploadCMSWordPressSource(db,files,user,project,id,name,bytes,env);
}
