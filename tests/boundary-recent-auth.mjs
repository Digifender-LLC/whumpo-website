// WH-004 finding B2 characterization: owner withdrawal controls such as unpublishing a site do NOT require recent
// authentication; the reviewed `confirm` control is accepted from a session whose passkey proof is an hour old. The
// owner decided on October 8, 2026 to correct docs/incident-runbooks.md (C10) to say so rather than add freshness.
// This test pins the documented behavior; if freshness is later added, change this test and the runbook together.
// Not in any tools/verify.mjs profile. Offline: disposable SQLite fixture, synthetic owner, no network.
// See docs/boundary-audit.md#b2.
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
 assert.equal(result.status,200,'An aged-proof session is accepted for the unpublish confirm; docs/incident-runbooks.md C10 documents that.');
 assert.equal(live,null,'The site went offline');
 console.log('B2 characterized: unpublish confirm needs a current session, not a recent passkey sign-in (documented in incident-runbooks.md C10).');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await fixture.close?.();}
