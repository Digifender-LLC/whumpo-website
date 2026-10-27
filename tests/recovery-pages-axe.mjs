// WH-208 automated axe checks for Support, Saved work, Site safety and Account security.
// Run directly: node tests/recovery-pages-axe.mjs
// It starts the shared identity browser harness in --recovery-axe mode, which runs the existing
// support, saved-work, site-safety and account-help journeys first and then calls recoveryPagesAxe().
// Synthetic fixture only; no live provider, remote binding or deploy.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const pages=[['Support','/workspace/support'],['Saved work','/workspace/saved-work'],['Site safety','/workspace/safety'],['Account security','/workspace/security']];
const widths=[390,1280],schemes=['light','dark'];
/** Known findings: serious/critical ones listed here are tracked, not failed. Fix in a follow-up, then delete the entry. */
export const allowlist=[
 // {rule:'color-contrast',page:'Support',reason:'WH-xxx: ...'}
];

export async function recoveryPagesAxe({page,origin,phase=()=>{}}){
 let rules=0,incomplete=0;const AxeBuilder=createRequire(import.meta.url)('@axe-core/playwright').default,rows=new Map(),blocking=[];
 for(const [name,path] of pages)for(const width of widths)for(const scheme of schemes){
  phase(`axe ${name} ${width}px ${scheme}`);
  await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:scheme});
  await page.goto(origin+path);await page.getByRole('main').first().waitFor();await page.waitForLoadState('networkidle');
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  rules+=result.passes.length;incomplete+=result.incomplete.length;
  for(const v of result.violations){
   const known=allowlist.find(a=>a.rule===v.id&&a.page===name&&(!a.impact||a.impact===v.impact));
   rows.set([name,width,scheme,v.id,v.impact].join('|'),{name,width,scheme,rule:v.id,impact:v.impact,count:v.nodes.length,status:known?'tracked: '+known.reason:['serious','critical'].includes(v.impact)?'FAIL':'listed',targets:v.nodes.map(n=>n.target.join(' ')).slice(0,5)});
  }
 }
 await page.emulateMedia({colorScheme:null});await page.setViewportSize({width:390,height:844});await page.goto(origin+'/workspace');await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();
 console.log('page | width | scheme | rule | impact | count | status');
 for(const r of rows.values())console.log([r.name,r.width,r.scheme,r.rule,r.impact,r.count,r.status].join(' | ')+'\n   e.g. '+r.targets.join(' ; '));
 console.log(`Axe recovery pages: ${pages.length*widths.length*schemes.length} page states, ${rows.size} finding groups; ${rules} passing rule checks; ${incomplete} incomplete (needs manual review).`);
 blocking.push(...[...rows.values()].filter(r=>r.status==='FAIL').map(r=>`${r.rule} (${r.impact}) on ${r.name} ${r.width}px ${r.scheme}: ${r.targets[0]}`));
 assert.deepEqual(blocking,[],'Serious/critical axe violations not in the allowlist');
}

if(process.argv[1]===fileURLToPath(import.meta.url))process.exit(spawnSync(process.execPath,['tests/workspace-identity-browser.mjs','--recovery-axe'],{stdio:'inherit'}).status??1);
