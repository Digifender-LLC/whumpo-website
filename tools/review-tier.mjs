import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Same rules as docs/agent-review.md. Fails safe: every path is full tier unless it is on this short allowlist.
const policyDocs=/^docs\/(legal\/|agent-review\.md$|boundary-|data-lifecycle|data-protection\.md$|deployment\.md$|disaster-recovery\.md$|identity-authority\.md$|releases\.md$|security-risk-actions\.md$|tenant-)/;
const gateTests=/^tests\/(secret-custody|deploy-ci|boundary-|tenant-|verification-profiles|review-tier|agents-md-check|build-snapshot|release-|restore-|processing-boundaries|sqlite-authorizer)/;
export const isSafePath=p=>p==='README.md'||(/^docs\/.*\.md$/.test(p)&&!policyDocs.test(p))||(/^tests\/[^/]+\.mjs$/.test(p)&&!gateTests.test(p));
export const tiers={trivial:{maxLines:10,reviewers:2},lite:{maxLines:100,reviewers:4},full:{maxLines:Infinity,reviewers:7}};

/** files: [{path, lines}] where lines is additions plus deletions. Renames must arrive as a delete plus an add (`--no-renames`). */
export function reviewTier(files){
 const lines=files.reduce((n,f)=>n+f.lines,0);
 const unsafe=files.filter(f=>!isSafePath(f.path)).map(f=>f.path);
 const tier=unsafe.length||lines>tiers.lite.maxLines?'full':lines>tiers.trivial.maxLines?'lite':'trivial';
 return {tier,reviewers:tiers[tier].reviewers,lines,unsafe};
}

/** Parses `git diff --numstat --no-renames`. A binary file (`-`) counts as 0 lines, but is never on the allowlist. */
export function parseNumstat(text){
 return text.split('\n').filter(Boolean).map(row=>{const [a,d,...p]=row.split('\t');return {path:p.join('\t'),lines:(Number(a)||0)+(Number(d)||0)};});
}

/** statuses: GitHub commit statuses for the head SHA, newest first. Approval is the newest `review:clean` being `success`. */
export const hasCleanStatus=statuses=>statuses.find(s=>s.context==='review:clean')?.state==='success';

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv[2]==='--status'){
  const {GITHUB_REPOSITORY:repo,HEAD_SHA:sha,GITHUB_TOKEN:token}=process.env;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo||'')||!/^[0-9a-f]{40}$/.test(sha||'')||!token)throw Error('Needs GITHUB_REPOSITORY, HEAD_SHA and GITHUB_TOKEN.');
  const response=await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/statuses?per_page=100`,{headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json'}});
  if(!response.ok)throw Error(`Status lookup failed: ${response.status}`);
  if(!hasCleanStatus(await response.json())){console.error(`::error::No review:clean commit status on ${sha}. A new push clears it; the reviewers must pass this exact commit (docs/agent-review.md).`);process.exit(1);}
  console.log(`review:clean status present on ${sha}.`);
 }else{
  const base=process.argv[2];
  if(!/^[0-9a-f]{7,40}$/.test(base||''))throw Error('Usage: node tools/review-tier.mjs <base-sha> | --status');
  const result=reviewTier(parseNumstat(execFileSync('git',['diff','--numstat','--no-renames',base,'HEAD'],{encoding:'utf8',maxBuffer:64e6})));
  const summary=`## Review tier: ${result.tier}\n\n${result.lines} changed lines, ${result.reviewers}+ reviewers. See docs/agent-review.md.\n${result.unsafe.length?'\nNot on the safe-path allowlist:\n'+result.unsafe.map(p=>'- `'+p+'`').join('\n')+'\n':''}`;
  console.log(summary);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
 }
}
