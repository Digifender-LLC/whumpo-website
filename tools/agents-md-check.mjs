import {existsSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const builtins=new Set(['install','i','add','audit','exec','dlx','update','remove','run','--version']);

// Named in AGENTS.md as things that must never be present.
const neverPresent=new Set(['google-services.json','.dev.vars','.env','.secrets']);
const bareFile=t=>/^\.?[A-Za-z_][\w-]*(?:\.[\w-]+)*$/.test(t)&&t.includes('.');

/** Problems in AGENTS.md text: backticked or linked paths that do not exist, cited pnpm scripts that are gone, pinned versions that drifted.
 * shortcut: a path is a backticked token or link target with a slash plus an extension or trailing slash, or a bare root file name such as README.md or .node-version; prose paths are not checked. */
export function checkAgentsMd(text,{exists,scripts,nodeVersion,pnpmVersion}){
 const problems=[];
 const spans=[...text.matchAll(/`([^`\n]+)`/g)].map(m=>m[1]);
 const links=[...text.matchAll(/\]\(([^)#\s]+)(?:#[^)\s]*)?(?:\s+"[^"]*")?\)/g)].map(m=>m[1]);
 for(const token of [...spans.flatMap(s=>s.split(/\s+/)),...links]){
  if(/[*:$~<>=@]|^\/|^\.\.\//.test(token)||neverPresent.has(token))continue;
  if(token.includes('/')?!/\.\w+$|\/$/.test(token):!bareFile(token))continue;
  if(!exists(token))problems.push(`path not found: ${token}`);
 }
 for(const span of spans)for(const m of span.matchAll(/(?:^|\s)pnpm (?:run )?([\w:.-]+)/g))
  if(!builtins.has(m[1])&&!Object.hasOwn(scripts,m[1]))problems.push(`pnpm script not found: ${m[1]}`);
 for(const m of text.matchAll(/node@(\d[\w.]*)/g))if(m[1]!==nodeVersion)problems.push(`node version ${m[1]} differs from .node-version ${nodeVersion}`);
 for(const m of text.matchAll(/pnpm@(\d[\w.]*)/g))if(m[1]!==pnpmVersion)problems.push(`pnpm version ${m[1]} differs from packageManager ${pnpmVersion}`);
 return [...new Set(problems)];
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
 const problems=checkAgentsMd(readFileSync(resolve(root,'AGENTS.md'),'utf8'),{exists:p=>existsSync(resolve(root,p)),scripts:pkg.scripts,
  nodeVersion:readFileSync(resolve(root,'.node-version'),'utf8').trim(),pnpmVersion:pkg.packageManager.replace('pnpm@','')});
 if(problems.length){console.error('AGENTS.md is stale:\n'+problems.map(p=>'- '+p).join('\n'));process.exit(1);}
 console.log('AGENTS.md names only paths, scripts and versions that exist.');
}
