import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
const manifest=JSON.parse(await readFile('dist/.vite/manifest.json','utf8'));
const entries=Object.entries(manifest);
const root=entries.find(([,entry])=>entry.isEntry)?.[0];
const workspace=entries.find(([key])=>key.endsWith('/workspace.tsx'))?.[0];
const pages=entries.find(([key])=>key.endsWith('/workspace-pages.tsx'))?.[0];
assert.ok(root&&workspace&&pages,'Build must retain both deferred workspace boundaries');
function graph(key,result=new Set()){
 if(result.has(key))return result;
 assert.ok(manifest[key],`Missing manifest entry ${key}`);result.add(key);
 for(const dependency of manifest[key].imports??[])graph(dependency,result);
 return result;
}
const initial=graph(root),chat=new Set([...initial,...graph(workspace)]);
assert.ok(!initial.has(workspace),'Landing must not eagerly load the workspace');
assert.ok(!chat.has(pages),'Opening Chat must not eagerly load secondary controls');
assert.ok(manifest[root].dynamicImports.includes(workspace));
assert.ok(manifest[workspace].dynamicImports.includes(pages));
for(const entry of Object.values(manifest)){
 for(const file of [entry.file,...entry.css??[],...entry.assets??[]])assert.ok((await stat('dist/'+file)).size>0);
 for(const dependency of [...entry.imports??[],...entry.dynamicImports??[]])assert.ok(manifest[dependency]);
}
async function size(keys){let raw=0,gzip=0;for(const key of keys){const bytes=await readFile('dist/'+manifest[key].file);raw+=bytes.length;gzip+=gzipSync(bytes).length;}return {bytes:raw,gzipBytes:gzip};}
console.log(JSON.stringify({landing:await size(initial),chat:await size(chat),allJavaScript:await size(entries.filter(([,e])=>e.file.endsWith('.js')).map(([key])=>key))},null,2));
console.log('Loading checks passed: separate route/control downloads, complete static and dynamic asset graphs.');
