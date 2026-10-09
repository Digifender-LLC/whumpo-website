// WH-004 boundary registry check. Offline: parses dispatcher source with the TypeScript 7 syntax tree and
// compares it with docs/boundary-audit.json. No Worker, database, network or credential is used.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root,extractSurface,loadRegistry,registryProblems,summaryBlock,summaryStart,summaryEnd,reportPath,cellNames} from '../tools/boundary-audit.mjs';

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

// Registry mutations: privileged cells, anchors and finding links are enforced.
const clone=()=>structuredClone(registry);
const privileged=registry.families.findIndex(f=>f.privileged.length);
assert.ok(privileged>=0);
for(const cell of cellNames){
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

// The human report carries the generated matrix summary for the current registry.
const start=report.indexOf(summaryStart),end=report.indexOf(summaryEnd);
assert.ok(start>=0&&end>start,'docs/boundary-audit.md lacks the generated summary block');
assert.equal(report.slice(start,end+summaryEnd.length),summaryBlock(registry),'Run `node tools/boundary-audit.mjs summary` and update docs/boundary-audit.md.');

console.log(`Boundary audit registry: ${surface.routes.length} matcher occurrences, ${surface.controls.length} Chat controls, ${registry.families.length} families; 6 source and ${cellNames.length+5} registry mutations detected.`);
