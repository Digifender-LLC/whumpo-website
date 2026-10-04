// WH-132 restricted case review UI client: read-only over the existing operator API, role-gated, fresh passkey proof,
// audited. Disposable SQLite by default, actual local D1 with --d1. Synthetic placeholders only; no network.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
const d1=process.argv.includes('--d1');
const source=`export * as cases from './src/safety-cases.ts';export * as http from './src/safety-case-http.ts';export * as client from './frontend/src/lib/operator-safety.ts';
 export {essentialDestinations} from './frontend/src/lib/workspace-navigation.ts';export {resolveIdentity} from './src/workspace-identity/authority.ts';export {admitWorkspace} from './src/workspace-identity/admission.ts';export {newSessionToken,hashToken} from './src/security.ts';`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')),{cases:c,http,client}=m;
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('Unexpected network');};
const fixture=await databaseFixture(),{db}=fixture,env={DB:db,ENVIRONMENT:'test'};let checks=0;
const principal=token=>m.resolveIdentity(db,{version:1,client:'web',kind:'session',token});
async function operator(){const f=await workspaceFixture(db,m);return {id:f.account,fixture:f,token:f.token,p:await principal(f.token)};}
/** The page's fetch, routed into the real operator handler with a same-origin session cookie. */
const transport=session=>(url,init)=>http.handleSafetyCaseRequest(new Request('https://whumpo.com'+url,{...init,headers:{...init.headers,origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+session.token}}),env);
const read=(session,action,input={},reauth=async()=>{throw Error('unexpected reauthentication');})=>client.operatorSafetyRead(action,input,{fetch:transport(session),reauth});
try{
 // Only the four audited read actions exist in the client, and each is a real server action.
 assert.deepEqual([...client.operatorReadActions],['holds/list','cases/read','cases/audit','disclosures/read']);
 assert.ok(client.operatorReadActions.every(a=>http.safetyCaseActions.includes(a)));checks++;
 for(const write of http.safetyCaseActions.filter(a=>!client.operatorReadActions.includes(a)))assert.throws(()=>client.operatorReadBody(write,{}),/Only read actions/);checks++;
 for(const bad of [{caseId:'has space'},{caseId:''},{caseId:'x'.repeat(129)},{caseId:'ok',extra:'1'}])assert.throws(()=>client.operatorReadBody('cases/read',bad),/opaque identifier/);checks++;
 const page=await readFile('frontend/src/operator-safety.tsx','utf8');
 for(const write of http.safetyCaseActions.filter(a=>!client.operatorReadActions.includes(a)))assert.ok(!page.includes(`'${write}'`),'The page names no write action: '+write);checks++;
 assert.ok(!m.essentialDestinations.some(d=>d.view==='operator-safety'),'Not linked from customer navigation');checks++;

 const admin=await operator(),reviewer=await operator(),approver=await operator(),auditor=await operator(),customer=await workspaceFixture(db,m),subject=await workspaceFixture(db,m);
 await c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin',accountId:admin.id});
 for(const [id,op,role] of [['g-review',reviewer,'case_reviewer'],['g-approve',approver,'preservation_approver'],['g-audit',auditor,'case_auditor']])await c.grantSafetyCaseRole(db,admin.p,{grantId:id,operatorAccountId:op.id,role});
 await c.openSafetyCase(db,reviewer.p,{caseId:'case-ui',subjectUserId:subject.account,intakeRef:'intake-ui'});
 await c.placePreservationHold(db,approver.p,{holdId:'h-ui',caseId:'case-ui',legalBasisRef:'basis-ui',reviewDays:30});

 // An auditor reads holds, the case, its audit; an absent disclosure answers not_found.
 let r=await read(auditor,'holds/list');assert.equal(r.state,'ok');assert.deepEqual(r.result.map(h=>[h.id,h.caseId,h.scope]),[['h-ui','case-ui','account']]);checks++;
 r=await read(auditor,'cases/read',{caseId:'case-ui'});assert.equal(r.state,'ok');assert.equal(r.result.currentFinding,'uncertain_flag');assert.equal(r.result.holds[0].id,'h-ui');checks++;
 r=await read(auditor,'cases/audit',{caseId:'case-ui'});assert.equal(r.state,'ok');assert.ok(r.result.some(e=>e.action==='read_case'&&e.outcome==='allowed'));checks++;
 assert.equal((await read(auditor,'disclosures/read',{disclosureId:'d-absent',caseId:'case-ui'})).state,'not_found');checks++;
 assert.equal((await read(auditor,'cases/read',{caseId:'case-absent'})).state,'not_found');checks++;
 // A reviewer reads the case but not the hold list or audit (role-gated per section).
 assert.equal((await read(reviewer,'cases/read',{caseId:'case-ui'})).state,'ok');
 assert.equal((await read(reviewer,'holds/list')).state,'restricted');assert.equal((await read(reviewer,'cases/audit',{caseId:'case-ui'})).state,'restricted');checks++;
 // An ordinary customer session holds no role: every read is restricted and nothing leaks.
 for(const [action,input] of [['holds/list',{}],['cases/read',{caseId:'case-ui'}],['cases/audit',{caseId:'case-ui'}],['disclosures/read',{disclosureId:'d',caseId:'case-ui'}]]){
  const result=await read(customer,action,input);assert.deepEqual(result,{state:'restricted'});}
 checks++;
 // The case subject cannot see their own case (conflict of interest answers as absent) even if granted a role.
 await c.grantSafetyCaseRole(db,admin.p,{grantId:'g-subject',operatorAccountId:subject.account,role:'case_auditor'});
 assert.equal((await read(subject,'cases/read',{caseId:'case-ui'})).state,'not_found');assert.deepEqual((await read(subject,'holds/list')).result,[]);checks++;
 // A stale passkey proof runs the ordinary reauthentication once and retries the same read.
 const stale=await workspaceSession(db,m,{account:auditor.id,credential:auditor.fixture.credential},-700),session={token:stale.token};let reauths=0;
 r=await read(session,'cases/read',{caseId:'case-ui'},async()=>{reauths++;session.token=(await workspaceSession(db,m,{account:auditor.id,credential:auditor.fixture.credential})).token;});
 assert.equal(r.state,'ok');assert.equal(reauths,1);checks++;
 r=await read({token:stale.token},'cases/read',{caseId:'case-ui'},async()=>{reauths++;});assert.equal(r.state,'error');assert.equal(reauths,2,'Only one reauthentication per read');checks++;
 // Every read attempt, including refusals, is in the server audit; the review reads changed no case state.
 const audit=await c.readSafetyCaseAudit(db,auditor.p,{caseId:'case-ui'}),seen=new Set(audit.map(e=>e.action+':'+e.outcome+':'+e.reason));
 for(const expected of ['read_case:allowed:ok','read_case:denied:missing_role','read_audit:denied:missing_role','read_case:denied:conflict_of_interest'])assert.ok(seen.has(expected),expected);checks++;
 assert.equal((await db.prepare('SELECT count(*) n FROM safety_case_findings').first()).n,1);assert.equal((await db.prepare("SELECT count(*) n FROM safety_preservation_holds WHERE released_at IS NULL").first()).n,1);checks++;
 assert.equal(network,0);
 console.log(`Operator safety review passed (${d1?'local D1':'SQLite'}): ${checks} checks. Read-only client limited to holds/list, cases/read, cases/audit and disclosures/read; per-section role gating; customer and subject non-disclosure; one passkey reauthentication per stale read; audited refusals; no navigation link; no state change.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
