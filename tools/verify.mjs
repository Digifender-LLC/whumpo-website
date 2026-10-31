import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const profiles={
 fast:['tests/android-assetlinks.mjs','tests/mobile-identity.mjs','tests/mobile-slice.mjs','tests/mobile-projects.mjs','tests/mobile-photos.mjs','tests/mobile-handoff.mjs','tests/mobile-push.mjs','tests/push-fcm.mjs','tests/ai.mjs','tests/prompt-data-boundaries.mjs','tests/ack-timing.mjs','tests/lifecycle-catalog.mjs','tests/connection-vault.mjs','tests/notifications-contract.mjs','tests/passkey-key-wrapping-contract.mjs','tests/email-change-contract.mjs','tests/review-retention-contract.mjs','tests/verification-profiles.mjs','tests/account-closure-contract.mjs'],
 protection:['tests/processing-boundaries.mjs','tests/deploy-ci.mjs','tests/secret-custody.mjs','tests/build-snapshot.mjs','tests/release-manifest.mjs','tests/release-provider.mjs','tests/connection-oauth-outcomes.mjs','tests/connection-key-backup.mjs','tests/restore-admission.mjs','tests/restore-inventory.mjs','tests/restore-inventory-freshness.mjs','tests/github-refresh-custody.mjs','tests/github-grant-revocation.mjs','tests/github-grant-chat.mjs','tests/boundary-audit.mjs'],
 site:['tests/customer-site-journey.mjs','tests/standard-service-no-maintainer.mjs','tests/request-path-inventory.mjs','tests/cost-events-acceptance.mjs',
  // Previously unprofiled fixture suites, each passing in under 60 s; kept out of fast/protection (deploy gate).
  'tests/account-closure-inventory.mjs','tests/app-authenticator.mjs','tests/backend-imports.mjs','tests/backend-nomination-intake.mjs','tests/backend-nominations.mjs','tests/boundary-app-challenge-capacity.mjs','tests/boundary-backend-digest.mjs','tests/boundary-billing-management.mjs','tests/boundary-contact-admission.mjs','tests/boundary-contact-delivery-health.mjs','tests/boundary-create-invite-default.mjs','tests/boundary-custom-domain-owner.mjs','tests/boundary-domain-proof-removal-sql.mjs','tests/boundary-guest-preview-race.mjs','tests/boundary-operator-freshness.mjs','tests/boundary-operator-target.mjs','tests/boundary-origin-routes.mjs','tests/boundary-owner-authority.mjs','tests/boundary-photo-route-held.mjs','tests/boundary-provider-reviews.mjs','tests/boundary-recent-auth.mjs','tests/boundary-review-capacity.mjs','tests/boundary-review-lifecycle.mjs','tests/boundary-site-isolation.mjs','tests/boundary-visitor-deletion-hold.mjs','tests/boundary-visitor-gateway-isolation.mjs','tests/build-jobs.mjs','tests/chat-announcements.mjs','tests/chat-inference-outage.mjs','tests/chat-interaction-client.mjs','tests/chat-interaction-photos.mjs','tests/chat-location.mjs','tests/chat-recovery-profile.mjs','tests/chat-recovery.mjs','tests/chat-task-connection-status.mjs','tests/cms-native-media-preview.mjs','tests/cms-native-media-upload.mjs','tests/comparison-page-http.mjs','tests/composition-planner.mjs','tests/connection-chat.mjs','tests/connection-discovery-context.mjs','tests/connection-handoff.mjs','tests/connection-keyrings.mjs','tests/connection-rotation-custody.mjs','tests/connection-rotation.mjs','tests/connection-sends.mjs','tests/connectors-contract.mjs','tests/content-policy.mjs','tests/content-risk-evidence.mjs','tests/content-risk-review.mjs','tests/content-risk.mjs','tests/content-screening-decisions.mjs','tests/content-screening.mjs','tests/cost-reconcile.mjs','tests/current-interfaces.mjs','tests/customer-eligibility.mjs','tests/digest-gap-direct.mjs','tests/digest-gap-modules.mjs','tests/digest-gap-site.mjs','tests/digest-gap-specification.mjs','tests/feature-identity.mjs','tests/feature-retention.mjs','tests/funnel-metrics.mjs','tests/guest-preview-bindings.mjs','tests/guest-previews.mjs','tests/identity-client-continuity.mjs','tests/job-envelope-contract.mjs','tests/job-journal-prototype.mjs','tests/job-journal.mjs','tests/job-registry.mjs','tests/schema-batch-3a.mjs','tests/schema-batch-3b.mjs','tests/schema-batch-3c.mjs','tests/schema-batch-3d.mjs','tests/schema-batch-3e.mjs','tests/schema-batch-4.mjs','tests/schema-confirm-triggers.mjs','tests/chat-reply.mjs','tests/notification-outbox.mjs','tests/form-attachments.mjs','tests/notification-recipients.mjs','tests/maintenance-inventory.mjs','tests/maintenance-scheduled.mjs','tests/maintenance.mjs','tests/mobile-v1-contract.mjs','tests/operator-containment.mjs','tests/operator-safety-review.mjs','tests/operator-session-revocation.mjs','tests/public-fairness.mjs','tests/recovery-drill.mjs','tests/release-lock.mjs','tests/review-receipts.mjs','tests/review-turnover.mjs','tests/roadmap-alignment.mjs','tests/safety-cases.mjs','tests/service-safety.mjs','tests/shared-modules-access.mjs','tests/shared-modules-collections.mjs','tests/shared-modules-contract.mjs','tests/shared-modules-records.mjs','tests/records-setup.mjs','tests/module-record-leads.mjs','tests/module-record-conversions.mjs','tests/shared-modules-registry.mjs','tests/site-safety.mjs','tests/sqlite-d1.mjs','tests/standard-ai-chat.mjs','tests/standard-ai-history.mjs','tests/standard-ai-recovery.mjs','tests/standard-ai-usage.mjs','tests/standard-service-runtime-execution.mjs','tests/task-cost-report.mjs','tests/task-list-app-journey.mjs','tests/visitor-data.mjs','tests/welcome-delivery.mjs','tests/workload-placement-prototype.mjs','tests/workspace-navigation.mjs','tests/resource-economics.mjs','tests/safety-case-operations.mjs','tests/backend-diff-http.mjs','tests/photo-handoff.mjs','tests/profile-http.mjs','tests/shared-modules-compositions.mjs','tests/shared-modules-files.mjs','tests/boundary-module-file-read.mjs','tests/boundary-guest-preview-read-pool.mjs','tests/guest-preview-photos.mjs','tests/photo-scan-results.mjs','tests/notification-configurations.mjs'],
 app:['tests/customer-app-journey.mjs'],
 // WH-004 R7: the boundary regressions that no other profile runs. Not the deploy gate (fast and protection stay as they are); run before a release that touches a boundary.
 security:['tests/boundary-apps-host-forwarding.mjs','tests/boundary-live-routing.mjs','tests/boundary-contact-notice-intake.mjs','tests/boundary-custom-domain-photo-route.mjs','tests/boundary-hosting-maintenance-stale.mjs','tests/boundary-operator-environment.mjs','tests/boundary-photo-route-admission.mjs','tests/boundary-visitor-shell-admission.mjs','tests/boundary-mobile-paths.mjs'],
};

// Deliberately allowlist environment inputs. In particular, no provider keys,
// optional live-test flags, NODE_OPTIONS, proxies or inherited Wrangler auth.
export function fixtureEnvironment(parent,home){
 const env={HOME:home,XDG_CONFIG_HOME:home,CI:'1',WRANGLER_SEND_METRICS:'false',WRANGLER_LOAD_DEV_VARS_FROM_DOT_ENV:'false'};
 for(const key of ['PATH','SystemRoot','WINDIR','TMPDIR','TEMP','TMP'])if(parent[key])env[key]=parent[key];
 // Python finds its user site (where Pillow lives) from HOME; keep it pointed at the real one despite the isolated HOME.
 const userBase=parent.PYTHONUSERBASE||(parent.HOME&&resolve(parent.HOME,'.local'));
 if(userBase)env.PYTHONUSERBASE=userBase;
 return env;
}

export function runProfile(name,{run=spawnSync,parent=process.env,cwd=root}={}){
 if(!Object.hasOwn(profiles,name))throw Error('Choose fast, protection, site, app or security.');
 if(Number(process.versions.node.split('.')[0])!==24)throw Error('Verification requires Node.js 24.');
 // Wrangler can read local secret files even with an empty credential environment.
 if(readdirSync(cwd).some(name=>/^\.(?:dev\.vars|env)(?:\.|$)/.test(name)))throw Error('Local .env/.dev.vars files exist. Use a checkout without them for fixture profiles.');
 const home=mkdtempSync(resolve(tmpdir(),'whumpo-verify-'));
 try{
  for(const script of profiles[name]){
   console.log(`Verifying ${name}: ${script}`);
   const result=run(process.execPath,[script],{cwd,env:fixtureEnvironment(parent,home),stdio:'inherit',timeout:300000});
   if(result.error||result.signal||result.status!==0)throw Error(`${script} failed (${result.error?.code??result.signal??result.status}).`);
  }
 }finally{rmSync(home,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length>3)throw Error('Usage: node tools/verify.mjs [fast|protection|site|app|security]');
  runProfile(process.argv[2]??'fast');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
