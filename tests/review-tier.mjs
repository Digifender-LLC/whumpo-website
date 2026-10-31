import assert from 'node:assert/strict';
import {hasCleanStatus,isSafePath,parseNumstat,reviewTier,tiers} from '../tools/review-tier.mjs';
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
assert.deepEqual(parseNumstat('0\t30\t.github/workflows/ci.yml\n30\t0\t.github/workflows/ci.yml.off\n-\t-\tdocs/a.png\n3\t2\tdocs/a.md\n'),[f('.github/workflows/ci.yml',30),f('.github/workflows/ci.yml.off',30),f('docs/a.png',0),f('docs/a.md',5)]);
assert.equal(reviewTier(parseNumstat('0\t30\t.github/workflows/ci.yml\n30\t0\t.github/workflows/ci.yml.off\n')).tier,'full');
assert.equal(reviewTier(parseNumstat('-\t-\tdocs/a.png\n')).tier,'full');
assert.equal(reviewTier(parseNumstat('0\t5\tsrc/removed.ts\n')).tier,'full');
// Commit status: the newest review:clean wins, and only success counts.
assert.ok(hasCleanStatus([{context:'ci',state:'failure'},{context:'review:clean',state:'success'}]));
assert.ok(!hasCleanStatus([{context:'review:clean',state:'failure'},{context:'review:clean',state:'success'}]));
assert.ok(!hasCleanStatus([{context:'review:clean',state:'pending'}])&&!hasCleanStatus([{context:'ci',state:'success'}])&&!hasCleanStatus([]));
console.log('Review tier: allowlist, reviewer counts, rename/delete/binary rows and commit-status approval passed.');
