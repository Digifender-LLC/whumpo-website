import assert from 'node:assert/strict';
import {parseNumstat,reviewTier} from '../tools/review-tier.mjs';
const f=(path,lines)=>({path,lines});
assert.equal(reviewTier([f('docs/a.md',10)]).tier,'trivial');
assert.equal(reviewTier([f('docs/a.md',11)]).tier,'lite');
assert.equal(reviewTier([f('docs/a.md',60),f('docs/b.md',40)]).tier,'lite');
assert.equal(reviewTier([f('docs/a.md',101)]).tier,'full');
for(const path of ['.github/workflows/ci.yml','schema/platform.sql','src/billing.ts','src/workspace-identity/x.ts','tools/deploy.mjs','src/secrets.d.ts','wrangler.jsonc'])
 assert.deepEqual(reviewTier([f(path,1)]),{tier:'full',reviewers:7,lines:1,sensitive:[path]},path);
assert.equal(reviewTier([f('src/chat.ts',3)]).tier,'trivial');
assert.equal(reviewTier([]).tier,'trivial');
assert.deepEqual(parseNumstat('3\t2\tdocs/a.md\n-\t-\timg.png\n'),[f('docs/a.md',5),f('img.png',0)]);
console.log('Review tier: size bands, sensitive paths and numstat parsing passed.');
