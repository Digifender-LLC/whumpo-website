// WH-004 boundary registry check. Offline: parses dispatcher, scheduled-handler and operator-tool source with the
// TypeScript 7 syntax tree, reads wrangler*.jsonc, and compares them with docs/boundary-audit.json. No Worker,
// database, network, credential or tool is run.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root,extractSurface,loadRegistry,registryProblems,summaryBlock,summaryStart,summaryEnd,reportPath,surfaces} from '../tools/boundary-audit.mjs';

const registry=loadRegistry(),surface=extractSurface(),report=readFileSync(resolve(root,reportPath),'utf8');
const problems=registryProblems(registry,surface,{report});
assert.deepEqual(problems,[],'docs/boundary-audit.json is out of date:\n'+problems.join('\n'));

// The extractor must see the whole mounted surface, not a trivially empty one.
assert.ok(surface.routes.length>=150,`only ${surface.routes.length} route matchers were extracted`);
assert.ok(surface.controls.length>=30,`only ${surface.controls.length} Chat controls were extracted`);
for(const path of ['/api/stripe/webhook','/api/cloudflare/dns/review','/api/domain-hosting/review','/api/github/backups/review','/api/billing/portal','/api/auth/identity/v1/passkey/remove','/api/operator/safety-cases/v1/disclosures/approve'])
 assert.ok(surface.routes.some(r=>r.path===path),`${path} was not extracted`);
// A matcher inside a comment or string is not a route.
assert.ok(!surface.routes.some(r=>/whumpo-modules v1|Dashboard control/.test(r.path)));

// Mutation 1: an unregistered route stub in the platform dispatcher is reported with its location.
const indexSource=readFileSync(resolve(root,'src/index.ts'),'utf8');
const signature=indexSource.indexOf('async function handleWorkspace(');
assert.ok(signature>0,'mutation anchor: handleWorkspace not found in src/index.ts');
const bodyStart=indexSource.indexOf('{',indexSource.indexOf('Promise<Response>',signature))+1;
assert.ok(bodyStart>signature,'mutation anchor: handleWorkspace body not found');
const stub="\n  if(method==='DELETE'&&pathname==='/api/boundary-audit-unregistered')return json({});";
const mutated=extractSurface({overrides:{'src/index.ts':indexSource.slice(0,bodyStart)+stub+indexSource.slice(bodyStart)}});
const added=registryProblems(registry,mutated,{report});
assert.equal(added.length,1,added.join('\n'));
assert.match(added[0],/^unregistered route: src\/index\.ts exact \/api\/boundary-audit-unregistered \[DELETE\] \(src\/index\.ts:\d+/);

// Mutation 2: a new method on an already registered path is a different entry point.
const methodStub=indexSource.replace("if(method==='GET'&&pathname==='/api/workspace/dashboard')","if((method==='GET'||method==='DELETE')&&pathname==='/api/workspace/dashboard')");
assert.notEqual(methodStub,indexSource,'mutation anchor: dashboard route not found');
const widened=registryProblems(registry,extractSurface({overrides:{'src/index.ts':methodStub}}),{report});
assert.ok(widened.some(p=>p.startsWith('unregistered route: src/index.ts exact /api/workspace/dashboard [DELETE,GET]')),widened.join('\n'));
assert.ok(widened.some(p=>p.startsWith('registered route no longer mounted: src/index.ts exact /api/workspace/dashboard [GET]')),widened.join('\n'));

// Mutation 3: silently dropping the recent-authentication requirement of a typed control is reported.
const controlsSource=readFileSync(resolve(root,'src/chat-controls.ts'),'utf8');
const relaxed=controlsSource.replace("label:'Save the exact reviewed private website version.',recentAuth:true","label:'Save the exact reviewed private website version.',recentAuth:false");
assert.notEqual(relaxed,controlsSource,'mutation anchor: specificationApply control not found');
assert.deepEqual(registryProblems(registry,extractSurface({overrides:{'src/chat-controls.ts':relaxed}}),{report}),['Chat control specificationApply: registry says recentAuth true, source says false']);

// Mutation 4: a new sub-dispatcher action (identity switch case) is reported.
const identitySource=readFileSync(resolve(root,'src/workspace-identity/http.ts'),'utf8');
const identityStub=identitySource.replace("default:return respond(","case 'boundary-audit-stub':return respond({});\n   default:return respond(");
assert.notEqual(identityStub,identitySource,'mutation anchor: identity switch default not found');
const identity=registryProblems(registry,extractSurface({overrides:{'src/workspace-identity/http.ts':identityStub}}),{report});
assert.ok(identity.length===1&&identity[0].startsWith('unregistered route: src/workspace-identity/http.ts exact boundary-audit-stub [POST]'),identity.join('\n'));

// Mutation 5: removing a route's recent-authentication call, or moving a router ahead of the exact-Origin
// gate, is reported even though the set of paths is unchanged.
const unfreshed=indexSource.replace("await requireFreshWorkspace(env.DB,user.id);\n    return json(await startCloudflare(","return json(await startCloudflare(");
assert.notEqual(unfreshed,indexSource,'mutation anchor: Cloudflare start freshness call not found');
assert.deepEqual(registryProblems(registry,extractSurface({overrides:{'src/index.ts':unfreshed}}),{report}).map(p=>p.replace(/\(src\/index\.ts:\d+\)$/,'')),['src/index.ts exact /api/connections/cloudflare/start [POST]: registry says freshnessCall true, source says false ']);
const operatorCall='  const operator=await handleSafetyCaseRequest(request,env);if(operator)return operator;\n';
assert.ok(indexSource.includes(operatorCall),'mutation anchor: operator router call not found');
const reordered=indexSource.replace(operatorCall,'').replace('  const identity=await handleIdentityRequest(request,env);if(identity)return identity;\n','  const identity=await handleIdentityRequest(request,env);if(identity)return identity;\n'+operatorCall);
assert.ok(registryProblems(registry,extractSurface({overrides:{'src/index.ts':reordered}}),{report}).some(p=>p.startsWith('platform dispatch order changed')));

// Slice 2: the sites, apps and runtime Workers, Worker reachability, scheduled jobs and operator tools.
for(const path of ['/apps/:project/account/delete','/apps/:project/modules/upload','/apps/:project/modules','/execute'])
 assert.ok(surface.routes.some(r=>r.path===path),`${path} was not extracted`);
assert.ok(surface.routes.some(r=>r.file==='src/site-host.ts'&&r.kind==='regex'&&r.match.includes('backend')),'the public backend route was not extracted');
assert.ok(surface.routes.some(r=>r.kind==='job'&&r.match==='default photos'),'scheduled jobs were not extracted');
assert.ok(surface.routes.some(r=>r.kind==='tool'&&r.file==='tools/cms-cloudflare.mjs'),'remote-capable tools were not extracted');
assert.deepEqual(surface.workers.map(w=>[w.name,w.publicInternet]),[['whumpo-platform',true],['whumpo-sites',true],['whumpo-apps',false],['whumpo-runtime',false]]);
const mutate=(file,from,to)=>{const source=readFileSync(resolve(root,file),'utf8'),next=source.replace(from,to);assert.notEqual(next,source,`mutation anchor not found in ${file}: ${from}`);return registryProblems(registry,extractSurface({overrides:{[file]:next}}),{report});};
const strip=p=>p.replace(/ \([\w/.-]+:\d+(, path .*)?\)$/,'');
// Mutation 6: a new site-host route after the GET/HEAD refusal is reported with the methods that gate allows.
const siteGate="if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD'}});";
assert.deepEqual(mutate('src/site-host.ts',siteGate,siteGate+"\n  if(url.pathname==='/boundary-audit-stub')return new Response('stub');").map(strip),['unregistered route: src/site-host.ts exact /boundary-audit-stub [GET,HEAD]']);
// Mutation 7: removing that refusal widens every public serving route to any method.
const ungated=mutate('src/site-host.ts',siteGate,'');
assert.ok(ungated.includes('registered route no longer mounted: src/site-host.ts regex /^\\/s\\/([0-9a-f-]{36})\\/?$/ [GET,HEAD] (family site-root)'),ungated.join('\n'));
assert.ok(ungated.some(p=>p.startsWith('unregistered route: src/site-host.ts regex /^\\/s\\/([0-9a-f-]{36})\\/?$/ [ANY]')),ungated.join('\n'));
// Mutation 8: a new host dispatch on the customer domain is reported.
assert.deepEqual(mutate('src/site-host.ts',"if(project)url.pathname=","if(url.hostname==='admin.whumpo.site')return new Response('stub');\n  if(project)url.pathname=").map(strip),["unregistered host dispatch: src/site-host.ts host url.hostname==='admin.whumpo.site' [ANY]"]);
// Mutation 9: deleting the visitor gateway's Origin/Sec-Fetch-Site refusal flags every later gateway route.
const gatewayOrigin="  if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.has('origin')&&request.headers.get('origin')!==origin)||method==='POST'&&request.headers.get('origin')!==origin)return json({error:'Origin check failed'},403);\n";
const noOrigin=mutate('src/app-gateway.ts',gatewayOrigin,'');
assert.ok(noOrigin.some(p=>p.startsWith('src/app-gateway.ts exact account/delete [POST]: registry says beforeOriginGate false, source says true')),noOrigin.join('\n'));
assert.ok(noOrigin.length>=10&&noOrigin.every(p=>p.includes('beforeOriginGate')),noOrigin.join('\n'));
// Mutation 10: dropping the POST-only refusal inside the module upload handler admits GET as well.
const upload=mutate('src/app-gateway.ts',"if(path==='modules/upload'){\n   if(method!=='POST')return json({error:'Not found'},404);","if(path==='modules/upload'){");
assert.deepEqual(upload.map(strip).sort(),['registered route no longer mounted: src/app-gateway.ts exact modules/upload [POST] (family visitor-modules)','unregistered route: src/app-gateway.ts exact modules/upload [GET,HEAD,POST]']);
// Mutation 11: the runtime accepting any method on /execute is reported.
const runtime=mutate('src/runtime/worker.ts',"if(request.method!=='POST'||new URL(request.url).pathname!=='/execute')","if(new URL(request.url).pathname!=='/execute')");
assert.deepEqual(runtime.map(strip).sort(),['registered route no longer mounted: src/runtime/worker.ts exact /execute [POST] (family runtime-execute)','unregistered route: src/runtime/worker.ts exact /execute [ANY]']);
// Mutation 12: a public route or workers.dev URL on a service-binding-only Worker is reported.
const appsConfig=JSON.parse(readFileSync(resolve(root,'wrangler.apps.jsonc'),'utf8'));
const routed=registryProblems(registry,extractSurface({overrides:{'wrangler.apps.jsonc':JSON.stringify({...appsConfig,routes:[{pattern:'apps.whumpo.site/*',zone_name:'whumpo.site'}]})}}),{report});
assert.deepEqual(routed,['Worker whumpo-apps: registry says routes [], wrangler.apps.jsonc says ["apps.whumpo.site/*"]','Worker whumpo-apps: registry says publicInternet false, wrangler.apps.jsonc says true']);
const runtimeConfig=JSON.parse(readFileSync(resolve(root,'wrangler.runtime.jsonc'),'utf8'));
assert.ok(registryProblems(registry,extractSurface({overrides:{'wrangler.runtime.jsonc':JSON.stringify({...runtimeConfig,workers_dev:true})}}),{report}).includes('Worker whumpo-runtime: registry says publicInternet false, wrangler.runtime.jsonc says true'));
// Mutation 13: scheduled jobs: a new job, a provider job losing its configuration gate, and an unconfigured cron branch.
assert.deepEqual(mutate('src/index.ts',"{name:'photos',run:()=>cleanupPhotos(env)},","{name:'photos',run:()=>cleanupPhotos(env)},{name:'boundary_stub',run:()=>cleanupPhotos(env)},").map(strip),['unregistered scheduled job: src/index.ts job default boundary_stub [SCHEDULED]']);
assert.deepEqual(mutate('src/index.ts',"{name:'github',enabled:!!githubConfig(env),","{name:'github',").map(strip),['src/index.ts job default github [SCHEDULED]: registry says conditional true, source says false']);
assert.ok(mutate('src/index.ts',"if(_event.cron==='47 * * * *'){","if(_event.cron==='13 * * * *'){").includes('scheduled branch "13 * * * *" is not a configured cron in wrangler.jsonc'));
// Mutation 14: a new operator tool that reaches the Cloudflare API directly or through an import is reported; a
// URL that appears only in a comment is not a remote marker.
const tool=source=>registryProblems(registry,extractSurface({overrides:{'tools/boundary-audit-stub.mjs':source}}),{report}).map(strip);
assert.deepEqual(tool("await fetch('https://api.cloudflare.com/client/v4/accounts');\n"),['unregistered remote-capable tool: tools/boundary-audit-stub.mjs tool cloudflare-api [CLI]']);
assert.deepEqual(tool("import {cloudflareAccount} from './cms-cloudflare.mjs';\nconsole.log(cloudflareAccount);\n"),['unregistered remote-capable tool: tools/boundary-audit-stub.mjs tool via-import [CLI]']);
assert.deepEqual(tool("// https://api.cloudflare.com is documented here only.\nconsole.log('local');\n"),[]);

// Registry mutations: privileged cells, anchors and finding links are enforced.
const clone=()=>structuredClone(registry);
const privileged=registry.families.findIndex(f=>f.privileged.length);
assert.ok(privileged>=0);
for(const cell of surfaces['platform-api'].privileged){
 const r=clone();delete r.families[privileged].cells[cell];
 assert.ok(registryProblems(r,surface,{report}).some(p=>p.includes(`cell ${cell}: required for privileged family`)),`missing ${cell} was not reported`);
}
{
 const r=clone(),cell=r.families.flatMap(f=>Object.values(f.cells)).find(c=>c.tests?.length);
 cell.tests[0]={...cell.tests[0],file:'tests/does-not-exist.mjs'};
 assert.ok(registryProblems(r,surface,{report}).some(p=>p.includes('tests/does-not-exist.mjs does not exist')));
}
{
 const r=clone(),cell=r.families.flatMap(f=>Object.values(f.cells)).find(c=>c.enforcedAt?.length);
 cell.enforcedAt[0]={...cell.enforcedAt[0],contains:cell.enforcedAt[0].contains+' boundary-audit-drift'};
 assert.ok(registryProblems(r,surface,{report}).some(p=>p.includes('no longer contains')));
}
{
 const r=clone(),cell=r.families.flatMap(f=>Object.values(f.cells)).find(c=>c.state==='evidenced');
 cell.tests=[];
 assert.ok(registryProblems(r,surface,{report}).some(p=>p.includes('evidenced needs enforcedAt and tests anchors')));
}
{
 const r=clone();r.families[privileged].cells.authority={state:'gap',gapKind:'control',detail:'Synthetic control gap without a finding.'};
 assert.ok(registryProblems(r,surface,{report}).some(p=>p.includes('a control gap must name a recorded finding')));
}
{
 const r=clone(),moved=r.families.find(f=>f.entries?.length).entries.pop();
 assert.ok(registryProblems(r,surface,{report}).some(p=>p.startsWith('unregistered route: '+moved.file)));
}
{
 // Slice-2 surfaces must record tenant scoping and who can reach them.
 const r=clone(),visitor=r.families.find(f=>f.surface==='visitor');
 assert.ok(visitor,'no visitor family is registered');
 delete visitor.cells.tenant;delete visitor.reach;
 const p=registryProblems(r,surface,{report});
 assert.ok(p.some(x=>x.includes(`family ${visitor.id} cell tenant: required for`)),p.join('\n'));
 assert.ok(p.some(x=>x.includes(`family ${visitor.id}: reach (who can reach this family) is required`)),p.join('\n'));
}
{
 const r=clone();r.workers=r.workers.filter(w=>w.name!=='whumpo-runtime');
 assert.ok(registryProblems(r,surface,{report}).includes('unregistered Worker whumpo-runtime (wrangler.runtime.jsonc)'));
}

// WH-004 D2: every native /api/mobile/v1 matcher is the only entry of its own family, so each path carries its own evidence cells and a
// new path cannot ride on a sibling's. tests/boundary-mobile-paths.mjs executes the shared rules for each of those paths.
const mobileGrouped=r=>r.families.filter(f=>f.entries?.some(e=>e.file==='src/mobile/router.ts')&&f.entries.length!==1).map(f=>f.id);
assert.deepEqual(mobileGrouped(registry),[],'a mobile family groups more than one matcher');
assert.ok(registry.families.filter(f=>f.entries?.some(e=>e.file==='src/mobile/router.ts')).length>=24,'the per-path mobile families are missing');
{
 const r=clone(),[a,b]=r.families.filter(f=>f.entries?.[0]?.file==='src/mobile/router.ts');
 a.entries.push(...b.entries);b.entries=[];
 assert.deepEqual(mobileGrouped(r),[a.id],'grouping two mobile matchers in one family is reported');
}

// The human report carries the generated matrix summary for the current registry.
const start=report.indexOf(summaryStart),end=report.indexOf(summaryEnd);
assert.ok(start>=0&&end>start,'docs/boundary-audit.md lacks the generated summary block');
assert.equal(report.slice(start,end+summaryEnd.length),summaryBlock(registry),'Run `node tools/boundary-audit.mjs summary` and update docs/boundary-audit.md.');

console.log(`Boundary audit registry: ${surface.routes.length} matcher/job/tool occurrences across ${surface.workers.length} Workers, ${surface.controls.length} Chat controls, ${registry.families.length} families; 19 source/config mutations detected, 1 comment-only negative control ignored, and ${surfaces['platform-api'].privileged.length+7} registry mutations detected.`);
