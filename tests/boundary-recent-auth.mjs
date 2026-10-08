// WH-004 finding B2 reproduction: docs/incident-runbooks.md (C10) says owner withdrawal controls such as unpublishing
// a site need recent authentication, but the reviewed `confirm` control is accepted from a session whose passkey proof
// is an hour old. EXPECTED TO FAIL (exit 1) until the code or the runbook is corrected. Deliberately not in
// package.json scripts or any tools/verify.mjs profile. Offline: disposable SQLite fixture, synthetic owner, no
// network. See docs/boundary-audit.md#b2.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
// A review prepared by a Chat turn uses that turn's ID (see tests/publications.mjs).
const control=async(scope,user,action,turn=id())=>m.sendChatControl(scope,user,{id:turn,revision:(await m.readChat(scope,user)).state.revision,action});
try{
 const owner=await workspaceFixture(db,m),fresh=await owner.scope(),user=owner.account;
 const site=await createFixtureProject(fresh,user,'Runbook studio','Synthetic recent-auth check');
 // Publish with a fresh session (setup only).
 const publish={id:id(),revision:(await m.readChat(fresh,user)).state.revision,content:'/publish '+site.version};
 assert.equal((await m.sendChat(fresh,user,publish)).status,200);
 assert.equal((await control(fresh,user,{type:'confirm',kind:'site',reviewId:publish.id})).status,200);
 assert.ok((await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(site.project).first())?.version_id);
 // A same-owner session whose passkey proof is one hour old prepares and confirms taking the site offline.
 const aged=await (await workspaceSession(db,m,owner,-3600)).scope();
 const review=id();assert.equal((await control(aged,user,{type:'unpublish',projectId:site.project},review)).status,200);
 assert.equal((await db.prepare('SELECT kind FROM publication_actions WHERE id=?').bind(review).first())?.kind,'unpublish');
 const result=await control(aged,user,{type:'confirm',kind:'site',reviewId:review});
 const live=(await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(site.project).first())?.version_id??null;
 assert.ok(result.status===401&&live,`B2 reproduced: a session with a one-hour-old passkey proof unpublished the site (status ${result.status}, live version ${live}); docs/incident-runbooks.md C10 says recent authentication is required.`);
 console.log('B2 not reproduced: the withdrawal required recent authentication.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await fixture.close?.();}
