import {constants} from 'node:fs';
import {open,realpath,lstat} from 'node:fs/promises';
import {resolve,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

// POSIX operator files; no alternate permission model or writable checkout copy.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const denied=()=>new Error('Private operator file unavailable. Inspect local custody and permissions.');
export const contains=(a,b)=>{const r=relative(a,b);return !r||r!=='..'&&!r.startsWith('../')&&!isAbsolute(r);};
function checkoutRoots(){
 const output=execFileSync('git',['-C',root,'worktree','list','--porcelain','-z'],{encoding:'utf8',maxBuffer:1024*1024,stdio:['ignore','pipe','ignore']});
 const roots=output.split('\0').filter(line=>line.startsWith('worktree ')).map(line=>resolve(line.slice(9)));
 if(!roots.includes(root))throw denied();return roots;
}
export async function pathCheck(path,{external=false,parent=false}={}){
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||path.includes('\0'))throw denied();
 const target=parent?dirname(path):path;
 if(await realpath(target)!==target)throw denied();
 if(external&&checkoutRoots().some(r=>contains(r,path)))throw denied();
 if(parent){const stat=await lstat(target);if(!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw denied();}
}
export async function readPrivate(path,limit){
 await pathCheck(path);let file;
 try{
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const before=await file.stat();
  if(!before.isFile()||before.nlink!==1||before.uid!==process.getuid()||(before.mode&0o077)!==0||before.size<1||before.size>limit)throw denied();
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const {bytesRead}=await file.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)throw denied();offset+=bytesRead;}
  const after=await file.stat();
  if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.nlink!==1||(after.mode&0o077)!==0)throw denied();
  return bytes;
 }finally{await file?.close();}
}
export async function writePrivate(path,bytes){
 await pathCheck(path,{external:true,parent:true});let file;
 try{file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await file.writeFile(bytes);await file.sync();}
 finally{await file?.close();}
 const directory=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{await directory.sync();}finally{await directory.close();}
 // Never overwrite or delete an existing private artifact after an uncertain write.
}
