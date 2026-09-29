import { attachPhoto } from './photo-versions';
import { publicationCommand, siteURL } from './publications';
import { renderLaunch, type LaunchConfig } from './components';
import { hashToken } from './security';
import { plans } from './plans';
import { ensureBilling, getBilling } from './billing';
import { reconcileChat, sendAIChat } from './ai-chat';
import type { AIConfig } from './ai';

type State = { revision: number; step: 'idea' | 'name' | 'ready'; idea: string };
export const greeting = "Hi, I’m your TellUmo guide. What would you like to put online? Tell me about your business, project, or idea. I can save your brief and set up a project with you.";
export async function chatState(db: D1Database, userId: string) {
  await db.prepare('INSERT OR IGNORE INTO workspace_state (user_id) VALUES (?)').bind(userId).run();
  const state = await db.prepare('SELECT revision, step, idea FROM workspace_state WHERE user_id = ?').bind(userId).first<State>();
  if (!state) throw new Error('Missing workspace state');
  return state;
}
export async function readChat(db: D1Database, userId: string, aiEnabled = false) {
  // Read revision and history together to avoid returning an old revision with newer turns.
  await chatState(db, userId);
  await reconcileChat(db, userId);
  const result = await db.batch([
    db.prepare('SELECT revision, step FROM workspace_state WHERE user_id = ?').bind(userId),
    db.prepare("SELECT t.id, t.revision, t.user_text, t.assistant_text, t.created_at, t.mode, t.status, COALESCE(v.id,a.version_id) AS version_id, CASE WHEN a.status = 'pending' AND a.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND a.expected_revision = s.revision THEN a.id ELSE NULL END AS confirmation_id, done.project_id AS published_project_id, done.kind AS publication_kind, e.version_id AS export_version_id FROM chat_turns t LEFT JOIN chat_exports e ON e.turn_id=t.id LEFT JOIN site_versions v ON v.id = t.id LEFT JOIN publication_actions a ON a.id = t.id AND a.user_id=t.user_id LEFT JOIN publications s ON s.project_id=a.project_id LEFT JOIN publication_actions done ON done.confirmed_by=t.id AND done.user_id=t.user_id WHERE t.user_id = ? ORDER BY t.revision DESC LIMIT 100").bind(userId),
    db.prepare("SELECT COUNT(*) AS projects, SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) AS live FROM projects WHERE owner_user_id = ?").bind(userId)
  ]);
  const billing = await getBilling(db, userId);
  return { mode: aiEnabled ? 'ai' : 'guided', greeting: aiEnabled ? greeting + ' After we save your brief, we can discuss your website with AI. Use /ask followed by a question at any time.' : greeting, state: result[0].results[0], turns: result[1].results.reverse(), stats: result[2].results[0], usage: { available: billing.quota.available, reserved: billing.quota.reserved, credits: billing.credits.available } };
}

export async function sendChat(db: D1Database, userId: string, input: Record<string, unknown>, ai?: AIConfig) {
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content || content.length > 1000 || !Number.isSafeInteger(input.revision) || typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.id))
    return { status: 400, error: 'Send a message of 1 to 1,000 characters with a valid request ID.' };
  const previous = await db.prepare('SELECT user_text FROM chat_turns WHERE id = ? AND user_id = ?').bind(input.id, userId).first<{ user_text: string }>();
  if (previous) return previous.user_text === content ? { status: 200 } : { status: 409, error: 'This request ID was already used for another message.' };
  const state = await chatState(db, userId);
  await reconcileChat(db, userId);
  if (await db.prepare("SELECT id FROM chat_turns WHERE user_id = ? AND status = 'pending' LIMIT 1").bind(userId).first()) return { status: 409, error: 'Your previous AI reply is still being prepared. Please wait a moment.' };
  if (state.revision !== input.revision) {
    // A simultaneous identical request may commit between the first read and state read.
    const committed = await db.prepare('SELECT user_text FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string}>();
    if (committed?.user_text === content) return {status:200};
    return { status: 409, error: 'Your conversation changed in another tab. Review the latest messages and send again.' };
  }
  if (state.revision >= 2000) return { status: 409, error: 'This test workspace has reached its conversation limit.' };
  let step = state.step;
  let idea = state.idea;
  let reply: string;
  let project: { id: string; name: string; purpose: string } | undefined;
  let overage: boolean | undefined;
  let exportId: string | undefined;
  let version: { projectId: string; config: LaunchConfig; html: string; digest: string } | undefined;
  const command = content.toLowerCase();
  const known = ['/projects','show my projects','my projects','show services','/plans','show plans','pricing','/usage','show usage','/credits','/credits on','/credits off','/activity','show activity','/domains','show domains','/connections','show connections','/security','/passkeys','/help','help','/new','/cancel','/files','show files','show photos','upload a photo','export my website','download my website'];
  if (ai && (command.startsWith('/ask ') || command.startsWith('/edit ') || (state.step === 'ready' && !content.startsWith('/') && !known.includes(command)))) return sendAIChat(db, userId, input.id, state.revision, content, ai);
  const photoCommand=command.match(/^\/photo\s+([0-9a-f-]{36})$/);
  const photoDraft=photoCommand?await attachPhoto(db,userId,input.id,photoCommand[1]):undefined;
  const publication = await publicationCommand(db,userId,input.id,command);
  if (photoDraft) reply = photoDraft.reply;
  else if (publication) reply = publication.reply;
  else if (/^\/export(?:\s|$)/.test(command) || ['export my website','download my website'].includes(command)) {
    const args=command.startsWith('/export')?command.split(/\s+/):['/export'];
    if(args.length>2 || (args[1]&&!/^[0-9a-f-]{36}$/.test(args[1])))return {status:400,error:'Use /export, optionally followed by a saved version ID from /versions.'};
    const saved=await db.prepare('SELECT v.id,p.name FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE p.owner_user_id=? AND (? IS NULL OR v.id=?) ORDER BY v.created_at DESC,v.id DESC LIMIT 1').bind(userId,args[1]??null,args[1]??null).first<{id:string;name:string}>();
    if(!saved)reply='No saved version found. Create a private draft first, or choose a version with /versions.';
    else {exportId=saved.id;reply=`Download the saved source for “${saved.name}” below. Version: ${saved.id}. The ZIP includes its HTML, styles and configuration. It contains no account credentials or chat history. This uses no AI units and does not change your live site.`;}
  }
  else if (/^\/build(?:\s|$)/.test(command)) {
    const args = command.split(/\s+/);
    const theme = args[1] || 'ocean';
    if (!['ocean','clay','forest'].includes(theme) || args.length > 3 || (args[2] && !/^[0-9a-f-]{36}$/.test(args[2]))) return {status:400,error:'Use /build ocean, /build clay, or /build forest, optionally followed by a project ID.'};
    const target = await db.prepare('SELECT id,name,purpose FROM projects WHERE owner_user_id = ? AND (? IS NULL OR id = ?) ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,args[2] ?? null,args[2] ?? null).first<{id:string;name:string;purpose:string}>();
    if (!target) reply = 'Create a project with /new first, or check its ID with /projects.';
    else {
      const config: LaunchConfig = {name:target.name,description:target.purpose,theme:theme as LaunchConfig['theme']};
      const html = renderLaunch(config);
      version = {projectId:target.id,config,html,digest:await hashToken(html)};
      reply = `I assembled a private first draft for “${target.name}” using the reusable launch-page layout (${theme}). Open the preview below. No AI units were used. This is a saved preview, not a published site. Try another theme with /build clay or /build forest.`;
    }
  } else if (['/projects', 'show my projects', 'my projects', 'show services'].includes(command)) {
    const { results } = await db.prepare('SELECT id, name, purpose, status FROM projects WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT 20').bind(userId).all<{ id: string; name: string; purpose: string; status: string }>();
    reply = results.length ? results.map(p => `${p.name} — ${p.status}\n${p.purpose}\nID: ${p.id}${p.status === 'live' ? '\n' + siteURL(p.id) : ''}`).join('\n\n') : 'No projects yet. Tell me your idea, or type /new to start.';
  } else if (['/usage', 'show usage', '/credits'].includes(command)) {
    const billing = await getBilling(db, userId);
    reply = `${billing.plan.name} · ${billing.period}\n${billing.quota.available} of ${billing.quota.allowance} monthly build units available. ${billing.quota.spent} used; ${billing.quota.reserved} held for pending work.\n${billing.credits.available} credits available; ${billing.credits.reserved} held.\nUsing existing credits after your monthly allowance is ${billing.credits.overageEnabled ? 'enabled' : 'disabled'}.\n\nGuided chat is free. Monthly units reset on the first day of each month (UTC); credits carry over. Use /credits on or /credits off to change overage use. Buying credits and paid upgrades are not enabled yet.`;
  } else if (['/credits on', '/credits off'].includes(command)) {
    await ensureBilling(db, userId);
    overage = command === '/credits on';
    reply = overage ? 'Existing credits may now cover build usage after your monthly allowance runs out. This does not buy credits or charge a payment method. You can turn this off with /credits off.' : 'Credit overage is off for new operations. Already reserved work can still settle against its existing hold.';
  } else if (['/plans', 'show plans', 'pricing'].includes(command)) {
    reply = 'Proposed plans (USD/month):\n' + plans.map(p => `${p.name}: $${p.monthlyCents / 100}, ${p.publishedSites} published site${p.publishedSites === 1 ? '' : 's'}, ${p.monthlyUnits} build units/month.`).join('\n') + '\n\nProposed extra credits: $5 for 100 units after your monthly allowance. Guided chat is free. Billing and paid upgrades are not enabled; no purchases or charges can be made here yet.';
  } else if (['/activity', 'show activity'].includes(command)) {
    const { results } = await db.prepare('SELECT summary, created_at FROM activity_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').bind(userId).all<{ summary: string; created_at: string }>();
    reply = results.map(event => `${event.created_at.slice(0, 10)}: ${event.summary}`).join('\n') || 'No activity yet.';
  } else if (['/files','show files','show photos','upload a photo'].includes(command)) {
    reply='Open Details → Project photos to upload a private photo or view existing files. Uploads use no AI units. Photos are not published automatically.';
  } else if (['/domains', 'show domains'].includes(command)) {
    reply = 'Custom domains are coming next. You’ll be able to connect a domain using DNS records, connect your own Cloudflare account, or review a domain purchase here. No domain has been connected or purchased.';
  } else if (['/connections', 'show connections'].includes(command)) {
    reply = 'Optional GitHub and Cloudflare account connections are being built. You’ll be able to start connection and disconnection here and authorize access on the provider’s website. Do not paste API keys or passwords into chat.';
  } else if (['/security', '/passkeys'].includes(command)) {
    reply = 'Open Details → Passkeys & recovery to add a passkey, remove one, or replace your recovery code. These actions require a recent sign-in and your device confirmation. Never share a recovery code in chat.';
  } else if (['/help', 'help'].includes(command)) {
    reply = ai ? 'AI is connected for website planning and private draft edits. Describe the page or change you want in ordinary language, or use /edit followed by your request. Describe your idea and choose a project name to save a brief. After that, we can discuss the website naturally, or use /ask followed by a question at any time. /new, /projects, /activity, /usage, /plans, /credits on, /credits off, and /security work without model charges. Use /build to assemble a private preview from a reusable layout; /build clay and /build forest change its theme. Use /files for private project photos; /photo PHOTO_ID adds a photo to a private website draft without AI units. Use /export to download the latest saved website source, optionally followed by a version ID. Use /versions to select a saved version, /publish to review making it public, /restore VERSION_ID to restore one, and /unpublish to take a site offline. Every publication change needs /confirm. The agent can change text, sections and themes using our reusable site component. Custom backend code, domains, and provider connections are still being built.' : 'AI is unavailable in this environment, so I’m running in guided mode. I can collect your idea, create a project, and show your workspace.\n\nTry /new, /projects, /activity, /plans, /usage, /domains, /connections, or /security. Use /cancel to stop an unfinished brief. Use /build to create a private preview from a reusable layout. Use /versions, /publish, /restore VERSION_ID, and /unpublish to review publication changes, then /confirm to apply them. Use /files for private project photos and /export to download saved website source. AI edits require a connected provider.';
  } else if (command === '/new') {
    step = 'idea'; idea = ''; reply = 'Let’s start something new. What would you like to put online, and who is it for?';
  } else if (command === '/cancel') {
    step = 'ready'; idea = ''; reply = 'I’ve cleared the unfinished brief. Your existing projects are unchanged. Type /new whenever you’re ready.';
  } else if (content.startsWith('/')) {
    reply = 'I don’t recognize that command yet. Type /help to see what I can do.';
  } else if (step === 'idea') {
    idea = content; step = 'name'; reply = 'I’ve saved that brief. What would you like to call the project? You can change direction with /cancel.';
  } else if (step === 'name') {
    if (content.length > 100) reply = 'Let’s use a shorter project name—100 characters or fewer.';
    else {
      project = { id: input.id, name: content, purpose: idea };
      step = 'ready'; idea = '';
      reply = `Your project “${content}” is saved with your brief. Use /build to assemble a private first draft from our reusable layout, without using AI units. You can also explore /plans or start another idea with /new.`;
    }
  } else {
    reply = 'I’ve kept your message in our conversation. In guided mode, use /new to turn an idea into a project, or /help to see the available actions. AI-generated changes are unavailable in this environment.';
  }
  const now = new Date().toISOString();
  const statements = [
    db.prepare("INSERT INTO chat_turns (id, user_id, revision, user_text, assistant_text, created_at) SELECT ?, user_id, revision + 1, ?, ?, ? FROM workspace_state WHERE user_id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM chat_turns WHERE user_id = ? AND status = 'pending')").bind(input.id, content, reply, now, userId, state.revision, userId),
    db.prepare('UPDATE workspace_state SET revision = revision + 1, step = ?, idea = ? WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?)').bind(step, idea, userId, state.revision, input.id, userId)
  ];
  if (publication) statements.push(...publication.statements);
  if (photoDraft) statements.push(...photoDraft.statements);
  if (exportId) statements.push(db.prepare("INSERT OR IGNORE INTO chat_exports(turn_id,version_id) SELECT id,? FROM chat_turns WHERE id=? AND user_id=?").bind(exportId,input.id,userId));
  if (version) {
    statements.push(db.prepare("INSERT INTO site_versions (id,project_id,component_id,config_json,html,digest,created_at) SELECT ?,?,'launch-page@1',?,?,?,? WHERE EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?) AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_user_id = ?)").bind(input.id,version.projectId,JSON.stringify(version.config),version.html,version.digest,now,input.id,userId,version.projectId,userId));
    statements.push(db.prepare("INSERT INTO activity_events (id,user_id,project_id,action,summary,created_at) SELECT ?,?,?, 'site.preview.created','Created a private preview with launch-page@1',? WHERE EXISTS (SELECT 1 FROM site_versions WHERE id = ?)").bind(`preview:${input.id}`,userId,version.projectId,now,input.id));
  }
  if (overage !== undefined) {
    statements.push(db.prepare('UPDATE billing_accounts SET overage_enabled = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?)').bind(overage ? 1 : 0, userId, input.id, userId));
    statements.push(db.prepare("INSERT INTO activity_events (id,user_id,action,summary,created_at) SELECT ?,user_id,'billing.preference',?,? FROM chat_turns WHERE id = ? AND user_id = ?").bind(`billing:${input.id}`, overage ? 'Enabled existing credits for quota overage' : 'Disabled credits for new operations', now, input.id, userId));
  }
  if (project) {
    statements.push(db.prepare("INSERT INTO projects (id, owner_user_id, name, purpose, status, created_at, updated_at) SELECT ?, ?, ?, ?, 'draft', ?, ? WHERE EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?)").bind(project.id, userId, project.name, project.purpose, now, now, input.id, userId));
    statements.push(db.prepare("INSERT INTO activity_events (id, user_id, project_id, action, summary, created_at) SELECT ?, ?, ?, 'project.created', ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_user_id = ?)").bind(crypto.randomUUID(), userId, project.id, `Created project ${project.name} through chat`, now, project.id, userId));
  }
  try {
    const results = await db.batch(statements);
    if (results[0].meta.changes !== 1) {
      const committed = await db.prepare('SELECT user_text FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string}>();
      if (committed?.user_text === content) return {status:200};
      return { status: 409, error: 'Your conversation changed. Review the latest messages and try again.' };
    }
  } catch (cause) {
    if (String(cause).includes('published_site_quota')) return {status:409,error:'Your plan’s live-site limit is reached. Unpublish another site before confirming this one.'};
    if (/publication_(changed|expired|version)/.test(String(cause))) return {status:409,error:'The reviewed publication is stale or expired. Request a fresh review before confirming.'};
    if (String(cause).includes('site_version_quota')) return {status:409,error:'This test project has reached its 25 saved preview limit.'};
    if (String(cause).includes('project_quota')) return { status: 409, error: 'The test platform allows 20 projects per account. Your brief is still saved.' };
    // A simultaneous retry can lose the primary-key race; verify ownership and payload.
    const retry = await db.prepare('SELECT user_text FROM chat_turns WHERE id = ? AND user_id = ?').bind(input.id, userId).first<{ user_text: string }>();
    if (retry?.user_text === content) return { status: 200 };
    throw cause;
  }
  return { status: 200 };
}
