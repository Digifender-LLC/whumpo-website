// Server-authored help is available without model requests or usage reservations.
const guides:Record<string,string>={
 websites:`Websites
Tell me what you want to put online, or describe a change to an existing site. /ask YOUR_QUESTION asks the agent a question.

Start: /new begins a project; /skip skips optional brief questions; /brief shows your preferences; /cancel exits setup.
Find: /projects lists services; /project PROJECT_ID shows details; /versions lists saved versions; /inspect VERSION_ID shows saved content.
Build: /build creates a private preview from a reusable layout. /build clay or /build forest changes its theme. AI edits use ordinary language or /edit YOUR_REQUEST.
Review: /diff VERSION_ID compares with the live version; add BASELINE_ID to compare two saved versions.
Publish: /publish, /restore VERSION_ID and /unpublish prepare publication changes. Only /confirm applies the reviewed change.
Export: /export downloads saved website source; add VERSION_ID to choose a version.
Remove: /delete-version VERSION_ID reviews removing an unused version; /confirm-version-delete REVIEW_ID confirms.
Check: /health reads saved checks; /check-site PROJECT_ID checks a published page and photo responses.

Photos: /help photos · Articles: /help cms · Domains: /help domains`,
 photos:`Photos
/files opens private project photos. /photos lists photo IDs in chat.
/photo PHOTO_ID adds a photo to a private website draft without AI units.
/delete-photo PHOTO_ID prepares removal of an unused photo. Use the confirmation offered in its review.

Uploads currently support bounded JPEG photos. A photo in a private draft becomes public only through reviewed publication.`,
 cms:`CMS articles
Use /cms to find CMS projects and /cms-publications PROJECT_ID to find current publication IDs and history.

Write and preview
/cms-drafts PROJECT_ID — list saved content request IDs.
/cms-draft PROJECT_ID posts|pages | title | body text — create a private article.
/cms-read PROJECT_ID REQUEST_ID — read current content and its revision token.
/cms-edit PROJECT_ID REQUEST_ID REVISION | title | full body text — stage an edit using the revision you just read. A live article stays online unchanged.
/cms-preview PROJECT_ID REQUEST_ID — open your latest private preview.

Publish and replace
/publish-cms PROJECT_ID REQUEST_ID — freeze the article and destination for review, including the current public version when replacing a live article.
/cms-publication REVIEW_ID — read that review.
/confirm-cms-publish REVIEW_ID — publish that exact review, or recover its result. The old article stays online until a replacement succeeds.

Abandon edits or take an article offline
/discard-cms PUBLICATION_ID — review discarding staged changes while keeping the live article.
/cms-discard-review REVIEW_ID — read the discard review.
/confirm-cms-discard REVIEW_ID — apply or recover that discard.
/unpublish-cms PUBLICATION_ID — review taking the article offline while retaining content.
/cms-unpublish-review REVIEW_ID — read the unpublish review.
/confirm-cms-unpublish REVIEW_ID — apply or recover that unpublish.

Recover saved work
/cms-retry PROJECT_ID REQUEST_ID recovers a creation receipt.
/cms-edits PROJECT_ID REQUEST_ID lists edit receipts; /cms-retry-edit PROJECT_ID EDIT_REQUEST_ID recovers one.
Reuse the saved request or review ID after an interrupted operation. Do not create a replacement request just to retry.

Set up a CMS
/setup-cms PROJECT_ID | title | optional tagline prepares an isolated EmDash request. /cms-review REVIEW_ID reads it; /confirm-cms REVIEW_ID queues approved provisioning. /check-cms PROJECT_ID checks an initialized instance. Provisioning still requires an operator; setup does not publish a website.`,
 domains:`Domains and hosting
/domains shows domain ownership requests. /domain HOSTNAME PROJECT_ID prepares a TXT ownership proof; /verify-domain CLAIM_ID checks it. Ownership verification does not change hosting. /hosting shows hosting connections.
/review-hosting CLAIM_ID prepares hosting; /confirm-hosting CONNECTION_ID authorizes it; /check-hosting CONNECTION_ID checks DNS and TLS; /disconnect-hosting CONNECTION_ID stops routing and removes the provider hostname.

With a connected Cloudflare account:
/dns-zones lists authorized zones. /dns lists DNS reviews and hosting connection IDs.
/review-dns CLAIM_ID ZONE_ID prepares a TXT ownership proof.
/review-routing CONNECTION_ID ZONE_ID prepares a website-routing CNAME.
/confirm-dns REVIEW_ID authorizes the exact change; /check-dns REVIEW_ID checks its result without resending.

Provider configuration and consent are required. Domain purchasing is not enabled. /help accounts explains optional connections.`,
 accounts:`Connected accounts and sign-in
/connections shows connection guidance. “connect github” or “connect cloudflare” starts the supported connection flow when configured. Manage consent and disconnection in Details → Connected accounts.
GitHub can store reviewed source backups; Cloudflare can manage reviewed DNS changes in authorized zones. These accounts are optional for starting a Whumpo project.

/security or /passkeys opens sign-in guidance. Details → Passkeys & recovery manages passkeys and recovery using recent sign-in and device confirmation.
Never paste passwords, API keys or recovery codes into chat.

GitHub backups: /help backups`,
 billing:`Plans and usage
/plans shows available plan information; /usage shows usage and allowances.
/credits shows credit settings. /credits on opts into spending available credits beyond your plan allowance; /credits off disables that choice.
/activity shows recorded workspace activity.

Payments and credit purchases are not enabled yet. Help and guided commands do not consume AI units. Some operations, such as private backend tests, have separate limits.`,
 backends:`Private backend functions and data
Ask the agent to create a pure JavaScript function for an existing project.
/backends PROJECT_ID lists private drafts; /backend VERSION_ID reads source.
/test-backend VERSION_ID JSON runs a non-sensitive example; /backend-result RECEIPT_ID reads its saved result.

/backend-publication PROJECT_ID reads public endpoint status.
/publish-backend VERSION_ID SUCCESSFUL_TEST_RECEIPT_ID reviews publication; /unpublish-backend PROJECT_ID reviews taking it offline.
/backend-publication-review REVIEW_ID reads the exact code/review; /confirm-backend-publication REVIEW_ID applies it.
/backend-state PROJECT_ID reads private JSON data.
/review-backend-state VERSION_ID JSON prepares a state change; /backend-state-review REVIEW_ID reads it; /confirm-backend-state REVIEW_ID applies the exact review.
/backend-state-history PROJECT_ID lists applied snapshots; /export-backend-state SNAPSHOT_ID downloads one.
/restore-backend-state SNAPSHOT_ID reviews restoring its after state; /restore-backend-before SNAPSHOT_ID reviews its before state. Restoration requires confirmation.

Functions start private. Reviewed publication exposes a stateless JSON endpoint with no network or private data access. /configure-backend-form PROJECT_ID JSON reviews an input form; ask the agent to match its fields to your tested function. /backend-form PROJECT_ID reads status; /backend-form-review REVIEW_ID reads a review; /confirm-backend-form REVIEW_ID applies it. /disable-backend-form PROJECT_ID reviews hiding the form. Changing the website or backend requires reviewing the form again. Guided tests use no AI units but have a separate execution allowance.`,
 directories:`Directories and visitor messages
/directory PROJECT_ID shows private listings.
/directory-add PROJECT_ID | title | description | optional HTTPS link prepares an addition.
/directory-edit PROJECT_ID LISTING_ID | title | description | optional HTTPS link prepares an edit.
/directory-remove PROJECT_ID LISTING_ID prepares removal.
/directory-publish PROJECT_ID reviews a public snapshot; /directory-off PROJECT_ID reviews taking it offline.
/directory-history PROJECT_ID lists saved data; /directory-restore PROJECT_ID SNAPSHOT_ID reviews restoring a private draft; /directory-export PROJECT_ID SNAPSHOT_ID downloads its JSON.
Only /confirm-directory REVIEW_ID applies a reviewed directory change.

/inbox opens private visitor messages. /contact-on PROJECT_ID and /contact-off PROJECT_ID prepare contact form settings; /confirm-contact REVIEW_ID applies them.`,
 backups:`Source backups and exports
/export downloads saved website source; add VERSION_ID to choose a saved version.

For an authorized GitHub connection:
/backups lists backup reviews; /github-installations lists installations; /github-repos INSTALLATION_ID lists repositories.
/review-backup VERSION_ID OWNER/REPO REPO_ID prepares an exact source backup.
/confirm-backup REVIEW_ID authorizes it; /check-backup REVIEW_ID checks without resending.

A website source export is not a whole-account or CMS backup. CMS backup/restore is still being built. Directory data exports are in /help directories; private backend data exports are in /help backends.`
};
const menu=`What would you like to do?

Start a site: describe your idea, or use /new.
See your services: /projects. Check usage: /usage.

Choose a guide:
/help websites — drafts, previews, publishing and restoration
/help photos — uploads and website photos
/help cms — articles, live edits, publishing and discarding changes
/help domains — ownership, DNS and hosting
/help accounts — connected accounts, passkeys and recovery
/help billing — plans, usage and credits
/help backends — private functions and data
/help directories — listings and visitor messages
/help backups — source backups and exports

Use /help all for the complete guide. Help does not use AI units.`;
export function chatHelp(command:string,aiConnected:boolean):string|undefined{
 const match=command.trim().toLowerCase().match(/^\/?help(?:\s+(.*))?$/);if(!match)return;
 const topic=(match[1]??'').trim();
 // Ordinary requests such as ‘help me build a site’ still belong to the agent.
 if(topic&&!command.trim().startsWith('/')&&topic!=='all'&&!Object.hasOwn(guides,topic))return;
 if(!topic)return (aiConnected?'You can describe your idea or changes in ordinary language.':'AI is unavailable here. The guided commands below still work.')+'\n\n'+menu;
 if(topic==='all')return Object.values(guides).join('\n\n────────────────\n\n');
 return guides[topic]??`I don’t have a “${topic.slice(0,80)}” guide.\n\n${menu}`;
}
