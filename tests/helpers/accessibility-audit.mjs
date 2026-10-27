import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';

/** Uses this repo's pinned @axe-core/playwright (as recovery-pages-axe.mjs does).
 * WHUMPO_AXE is an optional override pointing at another install.
 * Synthetic fixture pages only. Reports stay private and include unresolved
 * checks so zero reported violations cannot imply complete conformance. */
export function accessibilityAudit(){
 const results=[];
 const packagePath=process.env.WHUMPO_AXE;
 const AxeBuilder=createRequire(import.meta.url)(packagePath||'@axe-core/playwright').default;
 return {
  async check(page,label){
   let timer,result;
   try{result=await Promise.race([new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Accessibility audit did not finish: '+label)),30000);})]);}finally{clearTimeout(timer);}
   results.push({label,url:page.url(),violations:result.violations,incomplete:result.incomplete,passes:result.passes.map(p=>p.id)});
   await writeFile('.secrets/usability-accessibility.json',JSON.stringify({at:new Date().toISOString(),engine:result.testEngine,results},null,2),{mode:0o600});
  },
  finish(){
   const failures=results.flatMap(r=>r.violations.map(v=>({page:r.label,rule:v.id,nodes:v.nodes.map(n=>n.target)})));
   assert.deepEqual(failures,[],'Automated accessibility findings; inspect the private report');
   console.log(`Axe audit passed ${results.length} synthetic page states; incomplete/manual checks remain in the private report.`);
  }
 };
}
