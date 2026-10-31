import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Same rules as docs/agent-review.md. Sensitive: auth, identity, money, secrets, schema, tenancy, deletion, deploy tooling, CI.
export const sensitivePaths=[
 /^\.github\//,/^\.gitleaks\.toml$/,/^schema\//,/^wrangler.*\.jsonc$/,/^SECURITY\.md$/,/^AGENTS\.md$/,
 /^tools\/(deploy|release|prepare-release|secret-custody|artifact-protection|build-snapshot|verify|database|current-schema|restore|schema-body)/,
 /^tests\/(secret-custody|deploy-ci|boundary-|tenant-)/,
 /^src\/(secrets|billing|stripe|turnstile|android-signing|connection|github-connection|cloudflare-connection|app-auth|app-owner-erasure|app-lifecycle|account-closure|workspace-identity|push-)/,
 /^src\/.*(auth|identity|session|passkey|crypt|keyring|tenant|erasure|webhook)/i,
 /^android\/.*(signing|\.gradle|AndroidManifest)/,
];
export const tiers={trivial:{maxLines:10,reviewers:2},lite:{maxLines:100,reviewers:4},full:{maxLines:Infinity,reviewers:7}};

/** files: [{path, lines}] where lines is additions plus deletions. */
export function reviewTier(files){
 const lines=files.reduce((n,f)=>n+f.lines,0);
 const sensitive=files.filter(f=>sensitivePaths.some(re=>re.test(f.path))).map(f=>f.path);
 const tier=sensitive.length||lines>tiers.lite.maxLines?'full':lines>tiers.trivial.maxLines?'lite':'trivial';
 return {tier,reviewers:tiers[tier].reviewers,lines,sensitive};
}

/** Parses `git diff --numstat`. A binary file (`-`) counts as 0 lines. */
export function parseNumstat(text){
 return text.split('\n').filter(Boolean).map(row=>{const [a,d,...p]=row.split('\t');return {path:p.join('\t').replace(/.*=> |[{}]/g,''),lines:(Number(a)||0)+(Number(d)||0)};});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const base=process.argv[2];
 if(!/^[0-9a-f]{7,40}$/.test(base||''))throw Error('Usage: node tools/review-tier.mjs <base-sha>');
 const result=reviewTier(parseNumstat(execFileSync('git',['diff','--numstat',base,'HEAD'],{encoding:'utf8',maxBuffer:64e6})));
 const summary=`## Review tier: ${result.tier}\n\n${result.lines} changed lines, ${result.reviewers}+ reviewers. See docs/agent-review.md.\n${result.sensitive.length?'\nSensitive paths:\n'+result.sensitive.map(p=>'- `'+p+'`').join('\n')+'\n':''}`;
 console.log(summary);
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
}
