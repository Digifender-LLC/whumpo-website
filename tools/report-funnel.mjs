import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';

// WH-025 operator report: read-only, aggregate and small-count suppressed.
// It returns event names, enumerated dimensions, counts and durations only:
// never account IDs, source keys, emails, project text or receipt identifiers.
export const funnelFamilies=Object.freeze({
 activation:['welcome_completed','draft_created','edit_accepted','review_prepared','publication_confirmed','workspace_returned'],
 interaction:['interaction_started','interaction_draft_saved','interaction_resumed','interaction_submitted','interaction_canceled','interaction_expired','interaction_validation_failed','interaction_continued'],
 identity:['passkey_registered','recovery_kit_saved','enrollment_completed','enrollment_cancelled','recovery_started','recovery_secured','recovery_completed'],
});
const stages=[['welcome_completed',"e.event='welcome_completed'"],['first_draft',"e.event='draft_created'"],['accepted_edit',"e.event='edit_accepted'"],
 ['review_prepared',"e.event='review_prepared'"],['publication_confirmed',"e.event='publication_confirmed'"],
 ['returned_day_7',"e.event='workspace_returned' AND e.dimension='day_7'"],['returned_day_30',"e.event='workspace_returned' AND e.dimension='day_30'"]];
// Each comparison pairs consent-gated events with an independent count of the
// receipts they derive from: currently consenting accounts, receipt time at or after
// consent and inside retention (?1). Static SQL only.
const unix=column=>`strftime('%Y-%m-%dT%H:%M:%fZ',${column},'unixepoch')`;
const eligible=(user,time)=>`JOIN user_profiles a ON a.user_id=${user} AND a.measurement_consent=1 AND ${time}>=a.measurement_consented_at AND strftime('%Y-%m-%dT%H:%MZ',${time})>=?1`;
const reviewTime="strftime('%Y-%m-%dT%H:%M:%fZ',r.expires_at,'-10 minutes')";
const comparisons=[
 ['welcome_completed',"event='welcome_completed'",`SELECT count(*) FROM welcome_onboarding w ${eligible('w.user_id','w.completed_at')} WHERE w.completed_at IS NOT NULL`],
 ['draft_created/website',"event='draft_created' AND dimension='website'",`SELECT count(*) FROM project_spec_creations c ${eligible('c.user_id','c.created_at')}`],
 ['draft_created/application',"event='draft_created' AND dimension='application'",`SELECT count(*) FROM (SELECT p.owner_user_id AS owner,min(v.created_at) AS first FROM backend_versions v JOIN projects p ON p.id=v.project_id GROUP BY v.project_id) g ${eligible('g.owner','g.first')}`],
 ['edit_accepted/website_content',"event='edit_accepted' AND dimension='website_content'",`SELECT count(*) FROM project_spec_applies c ${eligible('c.user_id','c.created_at')}`],
 ['edit_accepted/website_services',"event='edit_accepted' AND dimension='website_services'",`SELECT count(*) FROM service_client_applies c ${eligible('c.user_id','c.created_at')}`],
 ['review_prepared/website',"event='review_prepared' AND dimension IN ('website_publish','website_restore')",`SELECT count(*) FROM publication_actions r ${eligible('r.user_id',reviewTime)} WHERE r.kind IN ('publish','restore')`],
 ['review_prepared/application_and_service',"event='review_prepared' AND dimension NOT IN ('website_publish','website_restore')",`SELECT count(*) FROM chat_review_receipts r JOIN chat_turns t ON t.id=r.turn_id ${eligible('r.user_id','t.created_at')} WHERE r.kind IN ('application','appPage','appRestore','backendPublication','backendForm')`],
 ['publication_confirmed',"event='publication_confirmed'",`SELECT count(*) FROM publication_actions r JOIN activity_events e ON e.id='publication:'||r.id ${eligible('r.user_id','e.created_at')} WHERE r.status='applied' AND r.kind IN ('publish','restore')`],
 ['interaction_started',"event='interaction_started'",`SELECT count(*) FROM chat_interactions i ${eligible('i.user_id','i.created_at')}`],
 ['interaction_draft_saved',"event='interaction_draft_saved'",`SELECT count(*) FROM chat_interaction_requests r ${eligible('r.user_id','r.created_at')} WHERE r.operation='save-draft'`],
 ['interaction_submitted',"event='interaction_submitted'",`SELECT count(*) FROM chat_interaction_submissions s ${eligible('s.user_id','s.created_at')}`],
 ['interaction_canceled',"event='interaction_canceled'",`SELECT count(*) FROM chat_interactions i ${eligible('i.user_id','i.removed_at')} WHERE i.removal_reason='discarded'`],
 ['interaction_expired',"event='interaction_expired'",`SELECT count(*) FROM chat_interactions i ${eligible('i.user_id','i.removed_at')} WHERE i.removal_reason='inactive'`],
 ['interaction_continued',"event='interaction_continued'",`SELECT count(*) FROM chat_interaction_continuations c JOIN chat_interaction_submissions s ON s.id=c.id ${eligible('s.user_id','c.finished_at')} WHERE c.state IN ('succeeded','failed')`],
 ['passkey_registered',"event='passkey_registered'",`SELECT count(*) FROM identity_ceremony_receipts r ${eligible('r.account_id',unix('r.created_at'))} WHERE r.kind IN ('signup','add')`],
 ['recovery_kit_saved',"event='recovery_kit_saved'",`SELECT count(*) FROM identity_effect_receipts r ${eligible('r.account_id',unix('r.created_at'))} WHERE r.kind='kit_save'`],
 ['enrollment_completed',"event='enrollment_completed'",`SELECT count(*) FROM identity_effect_receipts r ${eligible('r.account_id',unix('r.created_at'))} WHERE r.kind='enrollment_complete'`],
 ['recovery_started',"event='recovery_started'",`SELECT count(*) FROM identity_effect_receipts r ${eligible('r.account_id',unix('r.created_at'))} WHERE r.kind='recovery_start'`],
 ['recovery_completed',"event='recovery_completed'",`SELECT count(*) FROM identity_effect_receipts r ${eligible('r.account_id',unix('r.created_at'))} WHERE r.kind='recovery_complete'`],
];
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const minute=ms=>new Date(ms).toISOString().slice(0,16)+'Z';
function median(values){const v=[...values].sort((a,b)=>a-b),m=v.length>>1;return v.length%2?v[m]:(v[m-1]+v[m])/2;}

/** Owner-approved floor (October 8, 2026 UTC): a report cell never describes fewer than five accounts. Callers may only be stricter. */
export const funnelMinimumAccounts=5;
const usage='Usage: node tools/report-funnel.mjs [--days 1-180] [--minimum 5-50]';
/** Parses operator arguments with the same bounds funnelReport enforces. */
export function parseFunnelReportArguments(args){
 const options={};
 if(args.length%2)throw Error(usage);
 for(let i=0;i<args.length;i+=2){
  const [flag,value]=[args[i],Number(args[i+1])];
  if(flag==='--days'&&options.days===undefined&&Number.isSafeInteger(value)&&value>=1&&value<=180)options.days=value;
  else if(flag==='--minimum'&&options.minimumAccounts===undefined&&Number.isSafeInteger(value)&&value>=funnelMinimumAccounts&&value<=50)options.minimumAccounts=value;
  else throw Error(usage);
 }
 return options;
}

export async function funnelReport(db,{now=Date.now(),days=90,minimumAccounts=funnelMinimumAccounts}={}){
 if(!integer(now)||!Number.isSafeInteger(days)||days<1||days>180||!Number.isSafeInteger(minimumAccounts)||minimumAccounts<funnelMinimumAccounts||minimumAccounts>50)throw Error('Invalid funnel report window');
 const since=minute(now-days*86400000),cutoff=minute(now-180*86400000),k=minimumAccounts;
 const cell=(events,accounts)=>{if(!integer(events)||!integer(accounts))throw Error('Invalid funnel counts');return accounts>=k?{events,accounts}:{suppressed:true};};
 const reach=accounts=>{if(!integer(accounts))throw Error('Invalid funnel counts');return accounts>=k?{accounts}:{suppressed:true};};
 const coverage=await db.prepare('SELECT (SELECT count(*) FROM users) AS accounts,(SELECT count(*) FROM user_profiles WHERE measurement_consent=1) AS consenting').first();
 if(!coverage||!integer(coverage.accounts)||!integer(coverage.consenting))throw Error('Funnel report unavailable');
 const {results:rows}=await db.prepare('SELECT event,dimension,count(*) AS events,count(DISTINCT user_id) AS accounts FROM funnel_events WHERE occurred_at>=? GROUP BY event,dimension ORDER BY event,dimension').bind(since).all();
 const families=Object.fromEntries(Object.entries(funnelFamilies).map(([family,events])=>[family,rows.filter(r=>events.includes(r.event)).map(r=>({event:r.event,dimension:r.dimension,...cell(r.events,r.accounts)}))]));
 if(rows.some(r=>!Object.values(funnelFamilies).flat().includes(r.event)))throw Error('Unknown funnel event');
 // Activation cohort: consenting accounts whose welcome completed inside the window.
 const cohort="WITH cohort AS (SELECT user_id,occurred_at AS welcomed FROM funnel_events WHERE event='welcome_completed' AND occurred_at>=?1)";
 const funnel=await db.prepare(`${cohort} SELECT ${stages.map(([name,where])=>`(SELECT count(*) FROM cohort c WHERE EXISTS(SELECT 1 FROM funnel_events e WHERE e.user_id=c.user_id AND ${where})) AS ${name}`).join(',')}`).bind(since).first();
 const durations=async event=>(await db.prepare(`${cohort} SELECT (julianday(min(e.occurred_at))-julianday(c.welcomed))*1440 AS minutes FROM cohort c JOIN funnel_events e ON e.user_id=c.user_id AND e.event=?2 AND e.occurred_at>=c.welcomed GROUP BY c.user_id`).bind(since,event).all()).results.map(r=>r.minutes);
 const timing=values=>{if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))throw Error('Invalid funnel duration');return values.length>=k?{accounts:values.length,medianMinutes:Math.round(median(values))}:{suppressed:true};};
 const recovery=await db.prepare(`SELECT count(DISTINCT s.user_id) AS accounts FROM funnel_events s WHERE s.event='recovery_started' AND s.occurred_at>=?1 AND s.occurred_at<?2
  AND NOT EXISTS(SELECT 1 FROM funnel_events c WHERE c.user_id=s.user_id AND c.event='recovery_completed' AND c.occurred_at>=s.occurred_at)`).bind(since,minute(now-86400000)).first();
 const compared=await Promise.all(comparisons.map(async([metric,where,receiptSQL])=>{
  const row=await db.prepare(`SELECT (SELECT count(*) FROM funnel_events WHERE ${where}) AS events,(${receiptSQL}) AS receipts`).bind(cutoff).first();
  if(!row||!integer(row.events)||!integer(row.receipts))throw Error('Invalid receipt comparison');
  const status=row.events===row.receipts?'match':row.events<row.receipts?'events_below_receipts':'events_above_receipts';
  return coverage.consenting>=k?{metric,events:row.events,receipts:row.receipts,status}:{metric,status,suppressed:true};
 }));
 return {observedAt:new Date(now).toISOString(),window:{days,since},minimumAccounts:k,scope:'operator_aggregate',
  coverage:{accounts:coverage.accounts,consenting:reach(coverage.consenting)},
  activation:{stages:Object.fromEntries(stages.map(([name])=>[name,reach(funnel[name])])),
   timeToFirstDraft:timing(await durations('draft_created')),timeToFirstPublication:timing(await durations('publication_confirmed')),events:families.activation},
  interaction:{events:families.interaction,notMeasured:['client-side inline validation','required surface changes (no client beacons)','time from form start to submission']},
  identity:{events:families.identity,recoveryStartedWithoutCompletion:reach(recovery.accounts),
   notMeasured:['enrollment before measurement consent exists (signup happens before welcome)','unsupported or cancelled browser passkey prompts','recovery-kit print actions (and no proof of a printed or stored kit)']},
  receiptComparison:compared,
  limitations:['Consent-gated, opt-in counts: not a census of all accounts and not a measure of usefulness.','Receipts count only consenting accounts, after consent and inside 180-day retention. Events below receipts mean the hourly derivation has not run yet or an account reached its 2,000-row quota; events above receipts mean a source receipt was removed later (for example project or form removal) or need investigation.','Targets are proposed until the first cohort baseline; small cohorts carry wide uncertainty.','Read-only aggregate; no account, project, receipt or source identifiers are returned.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const options=parseFunnelReportArguments(process.argv.slice(2));
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const api=cloudflareClient(config.account_id,fetch,credentials);
  const db=remoteD1(api,config.d1_databases.find(b=>b.binding==='DB').database_id);
  console.log(JSON.stringify(await funnelReport(db,options),null,2));
 }catch{console.error('Funnel report unavailable. Check arguments, operator authorization and the complete current schema. Nothing was changed.');process.exitCode=1;}
}
