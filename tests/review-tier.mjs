import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gateFiles,gateSuites,hasCleanStatus,isSafePath,parseNumstat,reviewTier,tiers} from '../tools/review-tier.mjs';
const f=(path,lines)=>({path,lines});
// Reviewer counts per tier.
assert.deepEqual(Object.fromEntries(Object.entries(tiers).map(([k,v])=>[k,v.reviewers])),{trivial:2,lite:4,full:7});
// Size bands on allowlisted paths.
assert.deepEqual(reviewTier([]),{tier:'trivial',reviewers:2,lines:0,unsafe:[]});
assert.equal(reviewTier([f('docs/a.md',10)]).tier,'trivial');
assert.deepEqual(reviewTier([f('docs/a.md',11)]),{tier:'lite',reviewers:4,lines:11,unsafe:[]});
assert.equal(reviewTier([f('docs/a.md',60),f('tests/x.mjs',40)]).tier,'lite');
assert.deepEqual(reviewTier([f('docs/a.md',101)]),{tier:'full',reviewers:7,lines:101,unsafe:[]});
// Safe allowlist: one path per rule.
for(const p of ['README.md','docs/notes.md','docs/roadmap/backlog.md','tests/chat.mjs'])assert.ok(isSafePath(p),p);
// Everything else is refused: one path per rule, plus each miss the reviewers found.
for(const p of ['src/chat.ts','src/security.ts','src/mobile/handoff.ts','src/email-change/x.ts','src/domain-purchase/x.ts','src/plans.ts','schema/platform.sql','tools/create-invite.mjs','tools/review-tier.mjs','.github/workflows/review-gate.yml','.github/workflows/ci.yml','.gitleaks.toml','.gitignore','SECURITY.md','AGENTS.md','CLAUDE.md','package.json','pnpm-lock.yaml','wrangler.jsonc','wrangler.sites.jsonc','android/gradle/wrapper/gradle-wrapper.jar','android/app/src/main/java/A.kt','frontend/app.ts','docs/legal/terms.md','docs/agent-review.md','docs/data-lifecycle.md','docs/deployment.md','docs/tenant-classification.md','docs/data-protection.md','docs/disaster-recovery.md','docs/identity-authority.md','docs/releases.md','docs/security-risk-actions.md','tests/sub/a.mjs','docs/boundary-audit.md','docs/diagram.png','tests/secret-custody.mjs','tests/deploy-ci.mjs','tests/boundary-x.mjs','tests/tenant-x.mjs','tests/verification-profiles.mjs','tests/review-tier.mjs','tests/agents-md-check.mjs','tests/fixtures/a.json'])
 assert.deepEqual(reviewTier([f(p,1)]),{tier:'full',reviewers:7,lines:1,unsafe:[p]},p);
// Rename, delete and binary rows (`--no-renames` turns a rename into a delete plus an add).
assert.deepEqual(parseNumstat('0\t30\t.github/workflows/ci.yml\n30\t0\t.github/workflows/ci.yml.off\n-\t-\tdocs/a.png\n3\t2\tdocs/a.md\n'),[f('.github/workflows/ci.yml',30),f('.github/workflows/ci.yml.off',30),{...f('docs/a.png',0),binary:true},f('docs/a.md',5)]);
assert.equal(reviewTier(parseNumstat('0\t30\t.github/workflows/ci.yml\n30\t0\t.github/workflows/ci.yml.off\n')).tier,'full');
assert.equal(reviewTier(parseNumstat('-\t-\tdocs/a.png\n')).tier,'full');
assert.equal(reviewTier(parseNumstat('0\t5\tsrc/removed.ts\n')).tier,'full');
// A binary row is never safe, even under an allowlisted name (a NUL-byte file still parses as JavaScript).
assert.deepEqual(parseNumstat('-\t-\ttests/chat.mjs\n'),[{path:'tests/chat.mjs',lines:0,binary:true}]);
for(const path of ['tests/chat.mjs','docs/notes.md','README.md'])assert.deepEqual(reviewTier(parseNumstat(`-\t-\t${path}\n`)),{tier:'full',reviewers:7,lines:0,unsafe:[path]},path);
// The gate list is derived from tools/verify.mjs and the imports of the suites it names.
const files={'tools/verify.mjs':"export const profiles={\n fast:['tests/a.mjs'],\n protection:['tests/b.mjs'],\n security:[],\n site:['tests/c.mjs'],\n app:[],\n};",
 'tests/a.mjs':"import x from './helper.mjs';import('../tools/t.mjs');",'tests/helper.mjs':"import {y} from './deep/h2.mjs';",'tests/deep/h2.mjs':'','tests/b.mjs':'','tests/c.mjs':''};
const gate=gateFiles(p=>files[p]??null);
assert.deepEqual([...gate].sort(),['tests/a.mjs','tests/b.mjs','tests/c.mjs','tests/deep/h2.mjs','tests/helper.mjs','tools/t.mjs']);
assert.equal(reviewTier([f('tests/helper.mjs',1)],gate).tier,'full');
assert.equal(reviewTier([f('tests/other.mjs',1)],gate).tier,'trivial');
assert.throws(()=>gateFiles(p=>p==='tools/verify.mjs'?'export const profiles={fast:[]}':null),/no protection profile/);
// Real repo: every suite in every profile, and everything those import, rates full, including the ones a hand list missed.
const real=gateFiles(p=>{try{return readFileSync(new URL('../'+p,import.meta.url),'utf8');}catch{return null;}});
for(const suite of gateSuites(readFileSync(new URL('../tools/verify.mjs',import.meta.url),'utf8')))assert.equal(reviewTier([f(suite,1)],real).tier,'full',suite);
for(const p of ['tests/connection-key-backup.mjs','tests/connection-oauth-outcomes.mjs','tests/github-refresh-custody.mjs','tests/github-grant-revocation.mjs','tests/github-grant-chat.mjs','tests/sqlite-d1.mjs','tests/current-site-fixture.mjs','tests/cms-cloudflare.mjs','tests/visitor-deletion-fixture.mjs'])
 assert.equal(reviewTier([f(p,1)],real).tier,'full',p);
// Commit status: the newest review:clean wins, and only success counts.
assert.ok(hasCleanStatus([{context:'ci',state:'failure'},{context:'review:clean',state:'success'}]));
assert.ok(!hasCleanStatus([{context:'review:clean',state:'failure'},{context:'review:clean',state:'success'}]));
assert.ok(!hasCleanStatus([{context:'review:clean',state:'pending'}])&&!hasCleanStatus([{context:'ci',state:'success'}])&&!hasCleanStatus([]));
console.log('Review tier: allowlist, reviewer counts, rename/delete/binary rows and commit-status approval passed.');
