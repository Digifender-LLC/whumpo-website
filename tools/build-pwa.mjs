import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// The fixed offline assets are public. Changing any bytes rotates the worker and its cache together.
export async function buildPwa(root){
 const paths=['workspace-sw.js','pwa/offline.html','pwa/offline.css','pwa/offline.js','brand/whumpo-mark-96.png'];
 const bytes=await Promise.all(paths.map(path=>readFile(new URL(path,root))));
 const hash=createHash('sha256');for(let i=0;i<paths.length;i++)hash.update(paths[i]+'\0').update(bytes[i]);
 const version=hash.digest('hex').slice(0,24),source=bytes[0].toString();
 if(!source.includes('__OFFLINE_VERSION__'))throw Error('Missing service worker cache version marker');
 await writeFile(new URL('workspace-sw.js',root),source.replace('__OFFLINE_VERSION__',version));
}
