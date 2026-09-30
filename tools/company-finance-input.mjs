import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
/** Bound the private file read before JSON parsing; never print its contents or path on failure. */
export async function readCompanyFinance(path,now=Date.now()){
 const file=await open(path,'r');let bytes;
 try{if(!(await file.stat()).isFile())throw Error('Choose a regular finance summary file');const buffer=Buffer.alloc(65537);let used=0;while(used<buffer.length){const {bytesRead}=await file.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}if(used===0||used>65536)throw Error('Finance summary exceeds its bound');bytes=buffer.subarray(0,used);}finally{await file.close();}
 const code=await build({entryPoints:['src/fair-use-finance.ts'],bundle:true,format:'esm',platform:'node',write:false});const {companyFinanceReview}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 return {...companyFinanceReview(input,now),inputDigest:createHash('sha256').update(bytes).digest('hex')};
}
