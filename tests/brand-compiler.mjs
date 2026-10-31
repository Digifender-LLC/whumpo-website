import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {checkSpecificationCompiler} from '../tools/check-specification-compiler.mjs';
import {checkServiceClientCompiler} from '../tools/check-service-client-compiler.mjs';
Error.stackTraceLimit=0;
// WH-091 / WH-070 levels 1 and 2: brand tokens in the specification, the contrast rule, section variants, and the D50 `$` fix.
await checkSpecificationCompiler();await checkServiceClientCompiler();
const bundle=await build({stdin:{contents:`export * from './src/project-specification/compiler';export * from './src/project-specification/v3/schema';export * from './src/brand-tokens';export * from './src/components';export {createContentSpecification} from './src/project-specification/v3/content';export {publishedHTML} from './src/published-html';export * from './src/project-specification/service-clients/compiler';export {SpecificationError} from './src/project-specification/v2/json';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const kitId='11111111-1111-4111-8111-111111111111',logoId='22222222-2222-4222-8222-222222222222';
const brand=(over={})=>({source:{kitId,version:1},light:{ink:'#1f2a44',paper:'#fbf8f1',accent:'#8a2c0d'},dark:{ink:'#f2efe6',paper:'#14161c',accent:'#f0a37f'},font:'editorial',radius:'round',density:'spacious',logo:null,...over});
const site={name:'Harbour Bakery',description:'Bread, daily.',theme:'ocean',headline:'Fresh bread',aboutTitle:'About us',aboutText:'We bake.',sections:[{heading:'Hours',text:'Open at 7.'}]};
const rejects=(fn,code)=>assert.throws(fn,e=>e instanceof m.SpecificationError&&e.code===code,code);
const rejectsAsync=(fn,code)=>assert.rejects(fn,e=>e instanceof m.SpecificationError&&e.code===code,code);

// 1. The contrast rule is exact and has plain-word reasons.
assert.ok(m.contrast('#000000','#ffffff')>20.9&&m.contrast('#777777','#777777')===1);
assert.deepEqual(m.brandProblems(brand()),[]);
const weak=m.brandProblems(brand({light:{ink:'#9a9a9a',paper:'#ffffff',accent:'#8a2c0d'}}));
assert.ok(weak.length&&weak.every(p=>/hard to read/.test(p.message)&&/4\.5 to 1/.test(p.message)),'plain-words reason');
assert.ok(m.brandProblems(brand({dark:{ink:'#444444',paper:'#14161c',accent:'#f0a37f'}})).some(p=>p.path==='dark.ink'&&/dark mode/.test(p.message)));
// Adjust: pure, deterministic, only moves failing colors, and the result passes.
const fixed=m.adjustColors({ink:'#9a9a9a',paper:'#ffffff',accent:'#8a2c0d'},'light');
assert.deepEqual(m.colorProblems(fixed,'light'),[]);assert.equal(fixed.paper,'#ffffff');assert.equal(fixed.accent,'#8a2c0d');
assert.deepEqual(m.adjustColors(fixed,'light'),fixed);
assert.deepEqual(m.colorProblems(m.deriveDark(brand().light),'dark'),[]);
// A background with no readable text color stays refused rather than silently changed.
assert.ok(m.colorProblems(m.adjustColors({ink:'#777777',paper:'#777777',accent:'#777777'},'light'),'light').length);

// 2. The specification refuses what the owner screen refuses.
const created=m.createContentSpecification({...site,photos:[],brand:brand()});
assert.deepEqual(created.design.brand,brand());
for(const [mutate,code] of [
 [b=>{b.light.ink='#9a9a9a';b.light.paper='#ffffff';},'LOW_CONTRAST'],[b=>{b.dark.accent='#222222';},'LOW_CONTRAST'],
 [b=>{b.light.ink='red';},'INVALID_COLOR'],[b=>{b.light.ink='#ABCDEF';},'INVALID_COLOR'],[b=>{b.light.ink='#1f2a44;}</style><script>';},'INVALID_COLOR'],
 [b=>{b.font='Comic Sans';},'INCOMPATIBLE'],[b=>{b.radius='9999px';},'INCOMPATIBLE'],[b=>{b.density='x';},'INCOMPATIBLE'],[b=>{b.extra=1;},'INVALID_SHAPE'],[b=>{delete b.dark;},'INVALID_SHAPE'],
 [b=>{b.logo={id:'../etc',alt:'x'};},'INVALID_TEXT'],[b=>{b.logo={id:logoId,alt:' '};},'INVALID_TEXT'],[b=>{b.source={kitId:'nope',version:1};},'INVALID_SHAPE']
]){
 const spec=structuredClone(created);const b=structuredClone(created.design.brand);mutate(b);spec.design.brand=b;
 rejects(()=>m.validateSpecification(spec),code);
 rejects(()=>m.changeSpecification(created,[{type:'design.setBrand',brand:b}]),code);
}
// 3. Render: variables only, light and dark, no owner text in CSS, deterministic.
const compiled=await m.compileProjectSpecification(created,m.currentCompilerLock());
const html=compiled.artifacts[0].html;
assert.match(html,/--ink:#1f2a44;--tint:#[0-9a-f]{6};--paper:#fbf8f1;--accent:#8a2c0d;--radius:28px;--space:1\.3/);
assert.match(html,/@media\(prefers-color-scheme:dark\)\{:root\{--ink:#f2efe6;/);assert.match(html,/color-scheme:light dark/);
assert.doesNotMatch(html,/<script|javascript:|@import|url\(/i);
assert.equal((await m.compileProjectSpecification(structuredClone(created),m.currentCompilerLock())).manifestDigest,compiled.manifestDigest);
const noDark=await m.compileProjectSpecification({...created,design:{...created.design,brand:brand({dark:null})}},m.currentCompilerLock());
assert.doesNotMatch(noDark.artifacts[0].html,/prefers-color-scheme/);assert.match(noDark.artifacts[0].html,/color-scheme:light;/);
const plain=await m.compileProjectSpecification(m.createContentSpecification({...site,photos:[]}),m.currentCompilerLock());
assert.match(plain.artifacts[0].html,/--accent:#123f4e/);assert.doesNotMatch(plain.artifacts[0].html,/prefers-color-scheme/);
// Logo renders from the project's own asset path only, with the owner's alt text escaped.
const logoSpec=m.changeSpecification(created,[{type:'design.setBrand',brand:brand({logo:{id:logoId,alt:'Harbour "Bakery" <logo>'}})}]).spec;
const logoHtml=(await m.compileProjectSpecification(logoSpec,m.currentCompilerLock())).artifacts[0].html;
assert.ok(logoHtml.includes(`<img class="logo" src="assets/${logoId}.jpg" alt="Harbour &quot;Bakery&quot; &lt;logo&gt;">`));

// 4. Edit operation: copy, review class, no-change and removal.
const change=await m.compileSpecificationChange(created,[{type:'design.setBrand',brand:null}],m.currentCompilerLock());
assert.equal(change.compiled.specification.design.brand,null);assert.deepEqual(change.requiredReviews,[]);
assert.ok(change.diff.some(d=>d.path.startsWith('/design/brand')));
rejects(()=>m.changeSpecification(created,[{type:'design.setBrand',brand:brand()}]),'NO_CHANGE');
const operation={type:'design.setBrand',brand:brand({font:'modern'})};const next=m.changeSpecification(created,[operation]).spec;
operation.brand.font='classic';assert.equal(next.design.brand.font,'modern','detached copy');

// 5. Section variants (composition level 2): closed set, default plain, rendered as classes from a fixed list.
const varied=m.changeSpecification(created,[{type:'pages.setSections',pageId:'home',sections:[{heading:'A',text:'a',variant:'callout'},{heading:'B',text:'b'},{heading:'C',text:'c',variant:'quote'},{heading:'D',text:'d',variant:'card'}]}]).spec;
assert.deepEqual(varied.pages[0].sections.map(s=>s.variant),['callout','plain','quote','card']);
const variedHtml=(await m.compileProjectSpecification(varied,m.currentCompilerLock())).artifacts[0].html;
for(const v of ['callout','quote','card'])assert.ok(variedHtml.includes(`class="feature feature-${v}"`));assert.ok(variedHtml.includes('class="feature"'));
rejects(()=>m.changeSpecification(created,[{type:'pages.setSections',pageId:'home',sections:[{heading:'A',text:'a',variant:'"><script>'}]}]),'INCOMPATIBLE');
rejects(()=>m.changeSpecification(created,[{type:'pages.setSections',pageId:'home',sections:[{heading:'A',text:'a',css:'x'}]}]),'INVALID_SHAPE');

// 6. D50: `$` patterns in owner text are copied literally in every replacement site.
const dollars={name:"Cash $& Co $' $`",description:"Pay $1 or $$ now $'",headline:"Win $& and $` and $'",aboutTitle:"About $&",aboutText:"Text $' end $$",sections:[{heading:"Deal $&",text:"Save $' or $` today $$"}]};
const dollarSpec=m.createContentSpecification({...dollars,theme:'clay',photos:[{id:logoId,alt:"Alt $& $'"}]});
const dollarHtml=(await m.compileProjectSpecification(dollarSpec,m.currentCompilerLock())).artifacts[0].html;
for(const literal of ["Win $&amp; and $` and $&#39;","About $&amp;","Text $&#39; end $$","Deal $&amp;","Save $&#39; or $` today $$",'alt="Alt $&amp; $&#39;"'])assert.ok(dollarHtml.includes(literal),literal);
assert.equal(dollarHtml.split('<h1>').length,2,'no replacement text duplicated the document');
assert.equal(dollarHtml.split('</main>').length,2);
const form={config_json:JSON.stringify({title:"Ask $& $'",description:"Hi $` there",buttonLabel:"Send $'",fields:[{key:'name',label:"Your $& name",type:'text'}]}),backend_publication_id:'33333333-3333-4333-8333-333333333333'};
const out=m.publishedHTML(dollarHtml,true,'44444444-4444-4444-8444-444444444444',form);assert.equal(out.split('</main>').length,2);assert.ok(out.includes('Get in touch'));assert.ok(out.includes('Ask $&amp; $&#39;'),'form text literal');
// 7. Readable ratios are never rounded up to a pass, and an unfixable background is left alone.
assert.equal(m.ratioText(4.496),'4.49');assert.equal(m.ratioText(4.5),'4.50');assert.equal(m.ratioText(12.0049),'12.00');
const nearly=m.colorProblems({ink:'#777777',paper:'#ffffff',accent:'#000000'},'light');assert.ok(nearly.some(p=>/contrast 4\.4\d to 1/.test(p.message)),'a 4.48 pairing reads 4.48, not 4.5: '+JSON.stringify(nearly));
const stuck={ink:'#777777',paper:'#777777',accent:'#777777'};{const adj=m.adjustColors(stuck,'light');assert.equal(adj.ink,stuck.ink,'no text color reaches 4.5 on this background, so the owner color is left alone (not forced to black)');assert.equal(adj.paper,stuck.paper);assert.ok(m.colorProblems(adj,'light').some(p=>p.path==='light.ink'));}
const mid={ink:'#9a9a9a',paper:'#8a8a8a',accent:'#8a2c0d'};const moved=m.adjustColors(mid,'light');assert.ok(moved.ink===mid.ink||m.colorProblems(moved,'light').every(p=>p.path!=='light.ink'),'a color is either fixed or left as the owner chose it, never forced to black');
assert.notEqual(m.adjustColors({ink:'#9a9a9a',paper:'#ffffff',accent:'#8a2c0d'},'light').ink,'#000000');

// 8. D50 in the service-client core (src line 68): owner form text in the inert preview copies literally.
{
 const hash=x=>createHash('sha256').update(x).digest('hex'),idn=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
 const config=m.siteConfig({name:'Garden',headline:'Care',description:'Near.',aboutTitle:'Work',aboutText:'Local.',theme:'forest',sections:[]}),pageHtml=m.renderSite(config),website={componentId:'site-page@1',config,html:pageHtml};
 const target={projectId:idn(1),website:{versionId:idn(2),digest:hash(pageHtml)},publication:{revision:1,versionId:idn(2)},contact:{revision:0,active:false},backend:{revision:1,reviewId:idn(3),versionId:idn(4),digest:hash('b')},form:{revision:0,reviewId:null,active:false}};
 const form={title:"Ask $& $' $`",description:"Hi $` $$ there",buttonLabel:"Send $'",fields:[{key:'name',label:"Your $& name",type:'text'}]};
 const out=await m.compileServiceClientArtifacts({schemaVersion:1,contact:{component:'contact-link@1'},statelessForm:{component:'stateless-form@1',config:form}},target,website,m.currentServiceClientLock());
 for(const a of out.artifacts){assert.equal(a.html.split('</main>').length,2,a.kind+' has one main');assert.equal(a.html.split('<!doctype').length,2,a.kind+' is one document');assert.ok(a.html.includes('Ask $&amp; $&#39; $`'),a.kind+' title literal');assert.ok(a.html.includes('Hi $` $$ there'),a.kind+' description literal');}
}
console.log('Brand compiler checks passed: contrast rule and adjustment, closed token shape, light and dark CSS variables, logo path, design.setBrand, section variants, and literal $ handling.');
