// WH-004 finding B1 reproduction: one owner can exhaust a platform-wide review table and block every other
// owner's review preparation. EXPECTED TO FAIL (exit 1) until remediated. Deliberately not in package.json
// scripts or any tools/verify.mjs profile, so main stays green. Offline: disposable SQLite fixture, synthetic
// owners and projects, no network or credentials. See docs/boundary-audit.md#b1.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),raw=store.db,id=()=>crypto.randomUUID();
const prepare=(o,project)=>m.backendForms.prepareBackendForm(o.db,o.user,project,id(),null);
async function owner(){const user=id(),authority=await workspaceFixture(raw,m,user);return {user,db:await authority.scope()};}
async function project(o){
 const p=id(),now=new Date().toISOString();
 await o.db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic','Synthetic capacity fixture','draft',?,?)").bind(p,o.user,now,now).run();
 return p;
}
try{
 const attacker=await owner(),victim=await owner(),victimProject=await project(victim);
 // Baseline: the victim can prepare a "take my form offline" review (config null needs only ownership).
 await prepare(victim,victimProject);
 // The attacker uses only their own projects (10 of their 20) and never confirms anything.
 for(let p=0;p<10;p++){const own=await project(attacker);for(let n=0;n<100&&(await raw.prepare('SELECT count(*) n FROM backend_form_reviews').first()).n<1000;n++)await prepare(attacker,own);}
 assert.equal((await raw.prepare('SELECT count(*) n FROM backend_form_reviews').first()).n,1000);
 assert.equal((await raw.prepare('SELECT count(*) n FROM backend_form_reviews WHERE user_id=?').bind(victim.user).first()).n,1);
 let outcome='admitted';
 try{await prepare(victim,victimProject);}catch(error){outcome=`${error.status} ${error.message}`;}
 assert.equal(outcome,'admitted',`B1 reproduced: another owner's ${999} unconfirmed reviews block this owner's form review (${outcome}).`);
 console.log('B1 not reproduced: review capacity is isolated per tenant.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await store.close?.();}
